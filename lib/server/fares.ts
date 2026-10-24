// Market fare snapshots for the fare anomaly check. Network calls (SerpApi,
// Duffel) run outside any database transaction; each insert is idempotent per
// event, route, kind and day, so retries and concurrent searches are safe.
//
// - captureFareInsights: when an attendee searches flights from an origin,
//   store Google Flights price insights for that route once a day.
// - trackCheapestFares (nightly cron): for every origin seen in the event,
//   record today's cheapest economy fare until the event starts.
import { and, eq, isNotNull } from "drizzle-orm";

import { getDb, type Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { destinationFor } from "@/lib/flights";
import { getCheapestFare, getPriceInsights, type CheapestFare, type PriceInsights } from "@/lib/flights/price-insights";

import { loadOrgEvent, toEvent, type EventRow } from "./core";

export type SnapshotResult = "captured" | "exists" | "unavailable" | "event_started";

const today = (now: Date) => now.toISOString().slice(0, 10);
const AIRPORT = /^[A-Z]{3}$/;

async function hasSnapshot(db: Executor, eventId: string, origin: string, kind: "insights" | "cheapest", day: string) {
  const [row] = await db.select({ id: s.fareSnapshot.id }).from(s.fareSnapshot)
    .where(and(eq(s.fareSnapshot.eventId, eventId), eq(s.fareSnapshot.origin, origin), eq(s.fareSnapshot.kind, kind), eq(s.fareSnapshot.capturedOn, day)));
  return Boolean(row);
}

export function insightsRow(orgId: string, eventId: string, i: PriceInsights): typeof s.fareSnapshot.$inferInsert {
  return {
    id: newId("fare"), orgId, eventId, origin: i.origin, destination: i.destination, kind: "insights", capturedOn: i.capturedOn, source: i.source, truth: i.truth,
    typicalLowMinor: BigInt(i.typicalLowMinor), typicalHighMinor: BigInt(i.typicalHighMinor), lowestMinor: i.lowestMinor ? BigInt(i.lowestMinor) : null,
    priceLevel: i.priceLevel ?? null, history: i.history,
  };
}

function cheapestRow(orgId: string, eventId: string, c: CheapestFare): typeof s.fareSnapshot.$inferInsert {
  return { id: newId("fare"), orgId, eventId, origin: c.origin, destination: c.destination, kind: "cheapest", capturedOn: c.capturedOn, source: c.source, truth: c.truth, lowestMinor: BigInt(c.lowestMinor), history: [] };
}

/** Snapshot Google Flights price insights for one route of the org's current event, at most once a day. */
export async function captureFareInsights(orgId: string, rawOrigin: string, opts: { now?: Date; db?: Executor; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}): Promise<SnapshotResult> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const origin = rawOrigin.trim().toUpperCase();
  if (!AIRPORT.test(origin)) return "unavailable";
  const { event } = await loadOrgEvent(db, orgId);
  // Price history only exists for upcoming travel dates.
  if (event.startsAt <= now) return "event_started";
  const day = today(now);
  if (await hasSnapshot(db, event.id, origin, "insights", day)) return "exists";
  const insights = await getPriceInsights(origin, toEvent(event), day, opts.env, opts.fetchImpl);
  if (!insights) return "unavailable";
  const inserted = await db.insert(s.fareSnapshot).values(insightsRow(orgId, event.id, insights)).onConflictDoNothing().returning({ id: s.fareSnapshot.id });
  return inserted.length ? "captured" : "exists";
}

/** Origins attendees have searched or claimed for this event. */
async function eventOrigins(db: Executor, event: EventRow): Promise<string[]> {
  const [claims, snaps] = await Promise.all([
    db.selectDistinct({ origin: s.claim.origin }).from(s.claim).where(and(eq(s.claim.eventId, event.id), eq(s.claim.type, "travel"), isNotNull(s.claim.origin))),
    db.selectDistinct({ origin: s.fareSnapshot.origin }).from(s.fareSnapshot).where(eq(s.fareSnapshot.eventId, event.id)),
  ]);
  const home = destinationFor(event.venue).airport;
  return [...new Set([...claims, ...snaps].map((r) => r.origin?.trim().toUpperCase() ?? ""))].filter((o) => AIRPORT.test(o) && o !== home).sort();
}

/**
 * Nightly tracker: record today's cheapest economy fare for every origin in
 * the org's current event, until the event starts. Builds Eve's own price
 * history for routes Google has no insights for.
 */
export async function trackCheapestFares(orgId: string, opts: { now?: Date; db?: Executor; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; maxOrigins?: number } = {}) {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const { event } = await loadOrgEvent(db, orgId);
  const result = { recorded: 0, existing: 0, unavailable: 0, failed: 0 };
  if (event.startsAt <= now) return { ...result, eventStarted: true };
  const day = today(now);
  for (const origin of (await eventOrigins(db, event)).slice(0, opts.maxOrigins ?? 40)) {
    try {
      if (await hasSnapshot(db, event.id, origin, "cheapest", day)) { result.existing++; continue; }
      const fare = await getCheapestFare(origin, toEvent(event), day, opts.env, opts.fetchImpl);
      if (!fare) { result.unavailable++; continue; }
      const inserted = await db.insert(s.fareSnapshot).values(cheapestRow(orgId, event.id, fare)).onConflictDoNothing().returning({ id: s.fareSnapshot.id });
      if (inserted.length) result.recorded++; else result.existing++;
    } catch {
      // One route's provider failure must not stop the others; tomorrow's run retries.
      result.failed++;
    }
  }
  return { ...result, eventStarted: false };
}
