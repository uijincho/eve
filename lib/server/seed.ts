// Synthetic demo organization: a compact demo with 15 release-ready payments.
// The optional benchmark preset retains 300 people, 160 claims and 40
// planted errors. The answer key is written to its own table and is never read
// by checks; claims are evaluated by the real engine and payouts go through
// the real services, so the scoreboard measures actual behavior.
//
// All data is fictional. Ids for the org, event, personas and characters are
// stable so demo sessions survive a reset.

import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import { getDb, type Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";

import { agentActor, convertMinor, decisionRow, isAdultAt, type ClaimRow, type PersonRow } from "./core";
import { evaluate, toMarketSnapshots } from "./claims";
import { changeBankDetails, buildPayout, proposePayout, releasePayout, sourceFromClaim } from "./payouts";
import { DEMO_ORG_ID } from "./http";
import { recommendFulfillment, startingRules, w8ExpiresAt } from "./engines";
import { purgeOrg } from "./reset";
import { reconcilePacketSeed, sponsorSeed } from "./seed-sponsor";
import { sealRow } from "./vault";
import { toAward, toPerson } from "./core";

export const DEMO_EVENT_ID = "evt_demo_bluehour";
const ORG = DEMO_ORG_ID;

// ------------------------------------------------------------ randomness

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- reference

const COUNTRIES: { code: string; count: number; currency: string; city: string; airports: string[]; first: string[]; last: string[] }[] = [
  { code: "US", count: 100, currency: "USD", city: "Austin, TX", airports: ["JFK", "SEA", "ORD", "BOS", "AUS", "DEN"], first: ["Alex", "Jamie", "Taylor", "Morgan", "Riley", "Casey", "Jordan", "Avery", "Quinn", "Drew", "Hayden", "Reese"], last: ["Nguyen", "Garcia", "Smith", "Johnson", "Brown", "Miller", "Davis", "Wilson", "Moore", "Clark", "Hall", "Young"] },
  { code: "CA", count: 40, currency: "CAD", city: "Toronto, ON", airports: ["YYZ", "YVR", "YUL"], first: ["Liam", "Olivia", "Noah", "Emma", "Ethan", "Chloe", "Owen", "Maya"], last: ["Tremblay", "Roy", "Gagnon", "Wong", "MacDonald", "Singh", "Martin", "Leblanc"] },
  { code: "IN", count: 34, currency: "INR", city: "Bengaluru", airports: ["BLR", "DEL", "BOM"], first: ["Aarav", "Diya", "Ishaan", "Ananya", "Kabir", "Meera", "Rohan", "Sanya"], last: ["Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Rao", "Menon"] },
  { code: "DE", count: 20, currency: "EUR", city: "Munich", airports: ["MUC", "FRA", "BER"], first: ["Lena", "Felix", "Mia", "Jonas", "Hannah", "Paul"], last: ["Schmidt", "Fischer", "Weber", "Wagner", "Hoffmann", "Koch"] },
  { code: "GB", count: 20, currency: "GBP", city: "London", airports: ["LHR", "MAN"], first: ["Oliver", "Amelia", "Harry", "Isla", "George", "Ava"], last: ["Taylor", "Evans", "Thomas", "Roberts", "Walker", "Wright"] },
  { code: "BR", count: 15, currency: "BRL", city: "São Paulo", airports: ["GRU", "GIG"], first: ["Lucas", "Beatriz", "Gabriel", "Julia", "Mateus", "Larissa"], last: ["Silva", "Santos", "Oliveira", "Pereira", "Costa", "Almeida"] },
  { code: "MX", count: 15, currency: "MXN", city: "Mexico City", airports: ["MEX", "GDL"], first: ["Diego", "Valeria", "Santiago", "Camila", "Emiliano", "Regina"], last: ["Hernández", "López", "Martínez", "González", "Ramírez", "Flores"] },
  { code: "JP", count: 14, currency: "JPY", city: "Tokyo", airports: ["NRT", "HND"], first: ["Haruto", "Yui", "Sota", "Hina", "Ren", "Aoi"], last: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito"] },
  { code: "AU", count: 12, currency: "AUD", city: "Sydney", airports: ["SYD", "MEL"], first: ["Jack", "Charlotte", "William", "Matilda", "Lachlan", "Ruby"], last: ["Kelly", "Ryan", "Murphy", "Campbell", "Stewart", "Bennett"] },
  { code: "KR", count: 12, currency: "KRW", city: "Seoul", airports: ["ICN"], first: ["Minjun", "Seoyeon", "Jiho", "Hayoon", "Doyun", "Jiwoo"], last: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang"] },
  { code: "FR", count: 10, currency: "EUR", city: "Paris", airports: ["CDG"], first: ["Louis", "Chloé", "Hugo", "Léa", "Arthur", "Manon"], last: ["Martin", "Bernard", "Dubois", "Durand", "Moreau", "Laurent"] },
  { code: "CH", count: 8, currency: "CHF", city: "Zurich", airports: ["ZRH"], first: ["Noah", "Mia", "Luca", "Lina", "Elias"], last: ["Müller", "Meier", "Keller", "Huber", "Frei"] },
];

/** USD per one unit of the currency (claims convert at the purchase-date rate). */
const FX: Record<string, string> = {
  CAD: "0.72876000", EUR: "1.11930000", GBP: "1.33683000", INR: "0.01053300", BRL: "0.19816000", MXN: "0.05324200",
  JPY: "0.00637755", AUD: "0.70225000", KRW: "0.00075503", CHF: "1.21308000",
};
const EXP: Record<string, number> = { JPY: 0, KRW: 0 };

/** Local minor amount that converts to roughly `usdCents`. */
function localFromUsd(usdCents: number, currency: string): bigint {
  if (currency === "USD") return BigInt(usdCents);
  const exp = EXP[currency] ?? 2;
  return BigInt(Math.max(1, Math.round((usdCents / 100 / Number(FX[currency])) * 10 ** exp)));
}

const D = (iso: string) => new Date(iso);

/** Typical economy fare to SFO by origin, in USD cents. Clean claims vary ±10% around it, so a route has a real "usual" price. */
const ROUTE_FARE_CENTS: Record<string, number> = { YYZ: 30000, SEA: 17000 };
function routeFareCents(airport: string): number {
  if (ROUTE_FARE_CENTS[airport]) return ROUTE_FARE_CENTS[airport];
  let h = 0;
  for (const ch of airport) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 16000 + (h % 19) * 1000;
}

// --------------------------------------------------------------- seeding

interface Planted { scenario: string; objectType: "claim" | "person" | "packet"; objectId: string; expected: "flag" | "hold" | "freeze" | "exception" | "reportable"; code?: string; description: string }

export type DemoSeedPreset = "demo" | "benchmark";

export async function seedDemoOrg(tx: Executor, preset: DemoSeedPreset = "demo"): Promise<void> {
  const benchmark = preset === "benchmark";
  const countryCount = (c: typeof COUNTRIES[number]) => benchmark ? c.count : c.code === "US" ? 12 : c.code === "CA" ? 8 : 4;
  const rand = rng(20261024);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const planted: Planted[] = [];
  const startsAt = D("2026-10-24T16:00:00Z");

  await tx.insert(s.organization).values({
    id: ORG, slug: "blue-hour-demo", name: "Bayview Hacks (demo)", country: "US", mode: "hybrid", currency: "USD",
    agentLimitMinor: 30000n, organizerLimitMinor: 200000n, controllerThresholdMinor: 200000n, sponsorName: "Bayview Community Foundation",
    sponsorTurnaroundDays: 10, feesPaidBy: "org", notificationChannel: "#finance",
    policyNotes: "Synthetic demo organization. Travel: economy only, $500 cap, book by Oct 10. Auto-approve up to $300.", isDemo: true,
  });
  await tx.insert(s.event).values({
    id: DEMO_EVENT_ID, orgId: ORG, name: "Bayview Hacks 2026", startsAt, endsAt: D("2026-10-25T22:00:00Z"), venue: "Pier 48, San Francisco (fictional)",
    expectedHeadcount: COUNTRIES.reduce((sum, c) => sum + countryCount(c), 0), travelCapMinor: 50000n, economyOnly: true, bookingDeadline: D("2026-10-10T23:59:00Z"),
    checkInAt: D("2026-10-24T20:30:00Z"), closingAt: D("2026-10-25T22:00:00Z"),
  });
  await tx.insert(s.taxRule).values(startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
  await tx.insert(s.fxRate).values(Object.entries(FX).map(([base, rate]) => ({ rateDate: "2026-09-01", base, quote: "USD", rate, source: "Seeded reference rate" }))).onConflictDoNothing();
  await tx.insert(s.budgetLine).values([
    { id: "bud_demo_travel", orgId: ORG, eventId: DEMO_EVENT_ID, name: "Travel", category: "travel", capMinor: 4_500_000n, fundingSource: "Sponsor grant" },
    { id: "bud_demo_ground", orgId: ORG, eventId: DEMO_EVENT_ID, name: "Ground transport", category: "ground_transport", capMinor: 300_000n, fundingSource: "General fund" },
    { id: "bud_demo_supplies", orgId: ORG, eventId: DEMO_EVENT_ID, name: "Team supplies", category: "supplies", capMinor: 250_000n, fundingSource: "General fund" },
    { id: "bud_demo_prizes", orgId: ORG, eventId: DEMO_EVENT_ID, name: "Prizes", category: "prizes", capMinor: 2_500_000n, fundingSource: "Sponsor prizes" },
  ]);

  // ---- people
  type P = PersonRow & { airport: string; form: "valid" | "missing" | "expired" | "w9foreign" | "treaty"; tin?: string };
  const people: P[] = [];
  const used = new Set<string>();
  const add = (p: Omit<P, "orgId" | "eventId" | "adult" | "chaseCount" | "lastChasedAt" | "createdAt" | "projectStatus" | "projectUrl" | "projectSource" | "projectUpdatedAt">) => {
    const hacker = p.role.trim().toLowerCase() === "hacker";
    const row: P = {
      ...p, orgId: ORG, eventId: DEMO_EVENT_ID, adult: isAdultAt(p.dateOfBirth, startsAt), chaseCount: 0, lastChasedAt: null, createdAt: D("2026-09-01T00:00:00Z"),
      // Hackers are submitted so seeded travel claims keep today's outcomes. Mentors and judges are unknown; the check skips them.
      projectStatus: hacker ? "submitted" : "unknown", projectUrl: null, projectSource: hacker ? "organizer" : null, projectUpdatedAt: hacker ? D("2026-09-01T00:00:00Z") : null,
    };
    used.add(row.email);
    people.push(row);
    return row;
  };
  const character = (id: string, name: string, country: string, city: string, airport: string, form: P["form"], role = "hacker", dob = "1998-05-14") =>
    add({ id, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`, country, citizenship: country, dateOfBirth: dob, address: `${city} (synthetic)`, role, payoutCurrency: COUNTRIES.find((c) => c.code === country)!.currency, airport, form });

  const priya = character("per_demo_priya", "Priya Raman", "CA", "Toronto, ON", "YYZ", "missing");
  const jordan = character("per_demo_jordan", "Jordan Okafor", "CA", "Vancouver, BC", "YVR", "valid");
  const marcus = character("per_demo_marcus", "Marcus Lee", "CA", "Toronto, ON", "YYZ", "valid");
  const lukas = character("per_demo_lukas", "Lukas Becker", "DE", "Munich", "MUC", "expired", "judge", "1984-02-03");
  const ana = character("per_demo_ana", "Ana Souza", "BR", "São Paulo", "GRU", "valid");
  const sam = character("per_demo_sam", "Sam Ortiz", "US", "Oakland, CA", "OAK", "valid");
  const wei = character("per_demo_wei", "Wei Zhang", "US", "Seattle, WA", "SEA", "valid");
  // Priya is the attendee persona used to file a claim. She is kept out of the
  // claim pool, so `none` demos the escalation without changing seeded claims.
  // Her First Overall prize is an item, not a travel payout. Persona ids stay put.
  priya.projectStatus = "none";
  // Wei's only seeded claim is an expense, so unknown is visible and does not change a travel decision.
  wei.projectStatus = "unknown";
  wei.projectSource = null;
  wei.projectUpdatedAt = null;

  for (const c of COUNTRIES) {
    const existing = people.filter((p) => p.country === c.code).length;
    for (let i = existing; i < countryCount(c); i++) {
      let name = "";
      let email = "";
      for (let tries = 0; tries < 50; tries++) {
        name = `${pick(c.first)} ${pick(c.last)}`;
        email = `${name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, ".")}.${c.code.toLowerCase()}${i}@example.com`;
        if (!used.has(email)) break;
      }
      const year = 1980 + Math.floor(rand() * 26);
      add({ id: `per_demo_${c.code.toLowerCase()}${i}`, name, email, country: c.code, citizenship: c.code, dateOfBirth: `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`, address: `${c.city} (synthetic)`, role: rand() < 0.06 ? "mentor" : "hacker", payoutCurrency: c.currency, airport: pick(c.airports), form: rand() < 0.06 && benchmark ? "missing" : "valid" });
    }
  }
  const byCountry = (code: string, skip: Set<string>) => people.filter((p) => p.country === code && !skip.has(p.id) && p.form === "valid" && p.adult);
  const reserved = new Set([priya.id, jordan.id, marcus.id, lukas.id, ana.id, sam.id, wei.id]);
  const take = (code: string) => { const p = byCountry(code, reserved)[0]; reserved.add(p.id); return p; };

  // Planted person scenarios.
  const minors = [take("US"), take("CA")];
  minors[0].dateOfBirth = "2009-03-02"; minors[1].dateOfBirth = "2008-12-01";
  for (const m of minors) m.adult = isAdultAt(m.dateOfBirth, startsAt);
  const expired = [lukas, take("IN"), take("GB")];
  for (const p of expired) p.form = "expired";
  const w9foreign = [take("MX"), take("JP")];
  for (const p of w9foreign) p.form = "w9foreign";
  const treaty = take("CA");
  treaty.form = "treaty";
  const threshold = [take("US"), take("US")];
  const bankSecond = take("AU");
  for (const m of minors) planted.push({ scenario: "Attendee under 18", objectType: "person", objectId: m.id, expected: "hold", description: `${m.name} is under 18 at the event start; nothing may be paid.` });
  for (const p of expired) planted.push({ scenario: "Expired W-8BEN", objectType: "person", objectId: p.id, expected: "hold", description: `${p.name}'s W-8BEN lapsed Dec 31, 2025.` });
  for (const p of w9foreign) planted.push({ scenario: "W-9 from a foreign address", objectType: "person", objectId: p.id, expected: "hold", description: `${p.name} submitted a W-9 with a non-US address and citizenship.` });
  planted.push({ scenario: "Unverified treaty claim", objectType: "person", objectId: treaty.id, expected: "hold", description: `${treaty.name} claimed the Canada treaty rate, which is not verified.` });
  for (const p of threshold) planted.push({ scenario: "Crosses $2,000 across two payments", objectType: "person", objectId: p.id, expected: "reportable", code: "1099-MISC", description: `${p.name} was paid $1,500 earlier this year; a $600 prize crosses the 1099-MISC threshold.` });
  for (const p of [jordan, bankSecond]) planted.push({ scenario: "Bank details changed before payout", objectType: "person", objectId: p.id, expected: "freeze", description: `${p.name}'s bank details change after a payout was proposed.` });

  await tx.insert(s.person).values(people.map((p) => { const row: Partial<P> = { ...p }; delete row.airport; delete row.form; delete row.tin; return row as PersonRow; }));

  // ---- members (personas)
  await tx.insert(s.orgMember).values([
    { id: "mem_demo_dana", orgId: ORG, role: "organizer", name: "Dana Whitfield", email: "dana@bayview.example", demoPersona: true },
    { id: "mem_demo_ari", orgId: ORG, role: "controller", name: "Ari Novak", email: "ari@bayview.example", demoPersona: true },
    { id: "mem_demo_mei", orgId: ORG, role: "auditor", name: "Mei Tanaka", email: "mei@bayview.example", demoPersona: true },
    { id: "mem_demo_priya", orgId: ORG, role: "attendee", name: priya.name, email: priya.email, personId: priya.id, demoPersona: true },
    { id: "mem_demo_jordan", orgId: ORG, role: "attendee", name: jordan.name, email: jordan.email, personId: jordan.id, demoPersona: true },
  ]);

  // ---- vault, tax profiles, payout methods (bulk)
  const vaultRows: (typeof s.vaultSecret.$inferInsert)[] = [];
  const profiles: (typeof s.taxProfile.$inferInsert)[] = [];
  const methods: (typeof s.payoutMethod.$inferInsert)[] = [];
  for (const p of people) {
    const digits = String(Math.floor(rand() * 1e10)).padStart(10, "0");
    const bankId = `vlt_demo_bank_${p.id}`;
    vaultRows.push(sealRow({ id: bankId, orgId: ORG, personId: p.id, kind: "bank_account", value: `00${digits}` }));
    methods.push({ id: `pm_demo_${p.id}`, orgId: ORG, personId: p.id, provider: "simulated", currency: p.payoutCurrency, last4: p.id === jordan.id ? "4471" : digits.slice(-4), vaultId: bankId, status: "active", version: 1, requestedVia: "portal", requestedBy: "seed", verifiedAt: D("2026-09-15T00:00:00Z"), verifiedBy: "seed" });
    if (p.form === "missing" || !p.adult) continue;
    const us = p.country === "US";
    const signedAt = p.form === "expired" ? D("2022-03-10T00:00:00Z") : D("2026-06-01T00:00:00Z");
    let tinVaultId: string | null = null, tinLast4: string | null = null;
    if (us || p.form === "w9foreign") {
      const tin = `9${String(Math.floor(rand() * 1e8)).padStart(8, "0")}`;
      tinVaultId = `vlt_demo_tin_${p.id}`;
      tinLast4 = tin.slice(-4);
      vaultRows.push(sealRow({ id: tinVaultId, orgId: ORG, personId: p.id, kind: "tin", value: tin }));
    }
    const form = us || p.form === "w9foreign" ? "W-9" : "W-8BEN";
    profiles.push({
      id: `tax_demo_${p.id}`, orgId: ORG, personId: p.id, form, status: p.form === "w9foreign" ? "review" : "valid",
      statusReason: p.form === "w9foreign" ? "A W-9 was submitted by someone with a non-US address and citizenship; a W-8BEN is expected." : "",
      signatureName: p.name, signedAt, expiresAt: form === "W-8BEN" ? D(`${w8ExpiresAt(signedAt.toISOString())}T23:59:59Z`) : null,
      tinVaultId, tinLast4, treatyCountry: p.form === "treaty" ? "CA" : null, treatyArticle: p.form === "treaty" ? "XXII" : null,
    });
  }
  for (let i = 0; i < vaultRows.length; i += 200) await tx.insert(s.vaultSecret).values(vaultRows.slice(i, i + 200));
  for (let i = 0; i < profiles.length; i += 200) await tx.insert(s.taxProfile).values(profiles.slice(i, i + 200));
  for (let i = 0; i < methods.length; i += 200) await tx.insert(s.payoutMethod).values(methods.slice(i, i + 200));

  // ---- claims
  const [org] = await tx.select().from(s.organization).where(eq(s.organization.id, ORG));
  const [event] = await tx.select().from(s.event).where(eq(s.event.id, DEMO_EVENT_ID));
  const claims: ClaimRow[] = [];
  let seq = 2100;
  let minute = 0;
  const claimRow = (p: P, c: Partial<ClaimRow> & { usdCents: number; type: "travel" | "expense" }): ClaimRow => {
    seq += 1;
    minute += 7;
    const currency = c.currency ?? (c.type === "travel" ? p.payoutCurrency : "USD");
    const amountMinor = c.amountMinor ?? localFromUsd(c.usdCents, currency);
    const fxRate = currency === "USD" ? "1.00000000" : FX[currency];
    const id = `C-${seq}`;
    const row: ClaimRow = {
      id, orgId: ORG, eventId: DEMO_EVENT_ID, personId: p.id, budgetLineId: null, type: c.type, merchant: c.merchant ?? (c.type === "travel" ? pick(["Air Canada", "United", "Delta", "Lufthansa", "British Airways", "LATAM", "Aeromexico", "ANA", "Qantas", "Korean Air", "Air France", "Swiss"]) : pick(["Lyft", "Uber", "BART", "Staples", "Best Buy"])),
      description: c.description ?? (c.type === "travel" ? `${p.airport} → SFO` : "Ground transport to venue"), category: c.category ?? (c.type === "travel" ? "travel" : "ground_transport"),
      amountMinor, currency, usdMinor: currency === "USD" ? amountMinor : convertMinor(amountMinor, currency, fxRate), fxRate,
      fxSource: currency === "USD" ? "No conversion" : "Seeded reference rate, 2026-09-01",
      purchasedAt: c.purchasedAt ?? D(`2026-09-${String(5 + Math.floor(rand() * 25)).padStart(2, "0")}T18:00:00Z`),
      travelDate: c.type === "travel" ? (c.travelDate === undefined ? D(rand() < 0.5 ? "2026-10-23T15:00:00Z" : "2026-10-24T08:00:00Z") : c.travelDate) : null,
      cabin: c.type === "travel" ? (c.cabin ?? "economy") : null, origin: c.type === "travel" ? p.airport : null,
      nameOnReceipt: c.nameOnReceipt === undefined ? p.name : c.nameOnReceipt, receiptName: c.receiptName === undefined ? `${id}-receipt.pdf` : c.receiptName,
      documentId: null, receiptHash: c.receiptHash === undefined ? createHash("sha256").update(`receipt:${id}`).digest("hex") : c.receiptHash,
      extracted: { source: "trusted_fixture", corroborated: true, mismatches: [] }, status: c.status ?? "processing", checks: [], reason: "",
      dueAt: D("2026-10-27T16:00:00Z"), requestedBy: `mem_person_${p.id}`, reviewedBy: null, idempotencyKey: null,
      createdAt: new Date(D("2026-10-20T16:00:00Z").getTime() + minute * 60_000),
    };
    claims.push(row);
    return row;
  };
  const plant = (row: ClaimRow, scenario: string, code: string, description: string) => planted.push({ scenario, objectType: "claim", objectId: row.id, expected: "flag", code, description });

  const pool = people.filter((p) => p.adult && !reserved.has(p.id) && p.id !== priya.id);
  let poolIdx = 0;
  const next = () => pool[poolIdx++ % pool.length];

  // Characters from the mockup.
  const marcusClaim = claimRow(marcus, { type: "travel", usdCents: 0, amountMinor: 67940n, currency: "CAD", merchant: "Air Canada", description: "YYZ → SFO", purchasedAt: D("2026-10-03T14:00:00Z") });
  plant(marcusClaim, "Cap-hugging fare", "cap_hugging", "CA$679.40 converts to $495.12 against a $500 cap.");
  plant(marcusClaim, "Unusually expensive fare", "fare_peer", "$495.12 for YYZ → SFO, where other attendees paid about $300.");
  const anaClaim = claimRow(ana, { type: "travel", usdCents: 61840, currency: "USD", merchant: "LATAM", description: "GRU → SFO" });
  plant(anaClaim, "Over cap", "cap", "GRU → SFO at $618.40 exceeds the $500 cap.");
  const samFirst = claimRow(sam, { type: "expense", usdCents: 3820, merchant: "Lyft", description: "Lyft to venue", purchasedAt: D("2026-10-19T15:10:00Z") });
  const samDup = claimRow(sam, { type: "expense", usdCents: 3820, merchant: "Lyft", description: "Lyft to venue", purchasedAt: D("2026-10-19T15:10:00Z"), receiptHash: samFirst.receiptHash });
  plant(samDup, "Duplicate receipt", "duplicate", "Sam submitted the same Lyft receipt twice.");
  claimRow(wei, { type: "expense", usdCents: 3500, merchant: "United", description: "Checked bag", category: "baggage" });

  if (benchmark) {
    // Planted claim errors.
    for (let i = 0; i < 4; i++) { const p = next(); const a = claimRow(p, { type: i < 2 ? "travel" : "expense", usdCents: 12000 + i * 900 }); plant(claimRow(p, { type: a.type, usdCents: 12000 + i * 900, merchant: a.merchant, receiptHash: a.receiptHash, currency: a.currency, amountMinor: a.amountMinor }), "Duplicate receipt", "duplicate", "Same receipt submitted twice."); }
    for (let i = 0; i < 5; i++) plant(claimRow(next(), { type: "travel", usdCents: 28000 + i * 1500, travelDate: D(`2026-10-0${2 + i}T10:00:00Z`) }), "Flight on the wrong dates", "travel_dates", "Travel date is weeks before the event.");
    for (let i = 0; i < 3; i++) plant(claimRow(next(), { type: "travel", usdCents: 26000 + i * 2000, cabin: "business" }), "Business-class ticket", "cabin", "Policy is economy only.");
    for (let i = 0; i < 2; i++) { const p = people.filter((x) => (x.country === "DE" || x.country === "FR") && x.adult && !reserved.has(x.id))[i]; reserved.add(p.id); plant(claimRow(p, { type: "travel", usdCents: 0, currency: "EUR", amountMinor: 49500n + BigInt(i) * 1000n }), "EUR receipt above the cap after conversion", "cap", "€495+ converts to more than $500."); }
    for (let i = 0; i < 4; i++) plant(claimRow(next(), { type: "travel", usdCents: 24000 + i * 1000, nameOnReceipt: pick(["J. Doe", "Alex Rivera", "Kim Morales", "Pat Chen"]) }), "Name mismatch", "name_match", "Name on the ticket differs from the profile.");
    plant(claimRow(next(), { type: "travel", usdCents: 48900, currency: "USD" }), "Cap-hugging fare", "cap_hugging", "$489 against a $500 cap.");
    for (let i = 0; i < 3; i++) plant(claimRow(next(), { type: "expense", usdCents: 4500 + i * 700, receiptName: null, receiptHash: null }), "Missing receipt", "receipt", "No receipt attached.");
    for (let i = 0; i < 2; i++) plant(claimRow(next(), { type: "travel", usdCents: 23000 + i * 1500, purchasedAt: D(`2026-10-1${4 + i}T12:00:00Z`) }), "Booked after the deadline", "booking_deadline", "Booked after the Oct 10 deadline.");
    for (const m of minors) claimRow(m, { type: "travel", usdCents: 21000 });

    // Peer fares for the fare check: enough clean YYZ and SEA claims to say what those routes usually cost.
    for (const airport of ["YYZ", "SEA"]) {
      const base = routeFareCents(airport);
      pool.filter((p) => p.airport === airport).slice(0, 6).forEach((p, i) => claimRow(p, { type: "travel", usdCents: Math.round(base * (0.92 + i * 0.03)) }));
    }
    // Well under the cap and the auto-approve limit, so only the peer comparison catches it.
    const seaPricey = pool.filter((p) => p.airport === "SEA")[6];
    plant(claimRow(seaPricey, { type: "travel", usdCents: 28500, currency: "USD", merchant: "Alaska Airlines", description: "SEA → SFO" }), "Unusually expensive fare", "fare_peer", "$285 for SEA → SFO, where other attendees paid about $170.");

    // Clean claims up to 120 travel / 40 expense.
    while (claims.filter((c) => c.type === "travel").length < 120) {
      const p = next();
      rand(); // Kept so the rest of the seeded sequence does not shift.
      claimRow(p, { type: "travel", usdCents: Math.round(routeFareCents(p.airport) * (0.9 + 0.2 * rand())) });
    }
    while (claims.filter((c) => c.type === "expense").length < 40) {
      const p = next();
      const kind = pick([{ merchant: "Lyft", category: "ground_transport", d: "Ride to venue" }, { merchant: "BART", category: "ground_transport", d: "Transit" }, { merchant: "Staples", category: "supplies", d: "Team supplies" }, { merchant: "United", category: "baggage", d: "Checked bag" }]);
      claimRow(p, { type: "expense", usdCents: 1500 + Math.floor(rand() * 9000), merchant: kind.merchant, category: kind.category, description: kind.d });
    }
  } else {
    // Seven approved reimbursements: Sam and Wei above, four flights in
    // different currencies, and team supplies. These join eight cash prizes.
    for (const code of ["CA", "DE", "IN", "JP"]) {
      const p = byCountry(code, reserved)[0];
      claimRow(p, { type: "travel", usdCents: Math.min(25000, routeFareCents(p.airport)), purchasedAt: D("2026-09-15T12:00:00Z") });
    }
    claimRow(byCountry("GB", reserved)[0], { type: "expense", usdCents: 6400, merchant: "Staples", category: "supplies", description: "Team supplies" });
    // Two pending failures let the live review show useful work without
    // expanding the release batch. Keep the named duplicate and cap cases.
    plant(claimRow(byCountry("FR", reserved)[0], { type: "travel", usdCents: 24000, travelDate: D("2026-10-04T10:00:00Z") }), "Flight on the wrong dates", "travel_dates", "Travel date is weeks before the event.");
    plant(claimRow(byCountry("AU", reserved)[0], { type: "travel", usdCents: 26000, cabin: "business" }), "Business-class ticket", "cabin", "Policy is economy only.");
  }

  // Leave policy failures for the live review; benchmark also includes clean travel.
  const ordered = [...claims].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const plantedIds = new Set(planted.filter((x) => x.objectType === "claim").map((x) => x.objectId));
  const liveIds = new Set(planted.filter((x) => x.scenario === "Flight on the wrong dates" || x.scenario === "Business-class ticket").map((x) => x.objectId));
  // Originals of planted duplicates stay in the seeded pass, so the copy is the one checked against them.
  const plantedHashes = new Set(claims.filter((c) => plantedIds.has(c.id) && c.receiptHash).map((c) => c.receiptHash));
  for (const c of ordered) if (benchmark && liveIds.size < 30 && c.type === "travel" && !plantedIds.has(c.id) && !plantedHashes.has(c.receiptHash) && rand() < 0.3 && c.personId !== marcus.id) liveIds.add(c.id);
  const personById = new Map(people.map((p) => [p.id, p]));
  const names = new Map(people.map((p) => [p.id, p.name]));
  const processed: ClaimRow[] = [];
  // Every seeded travel claim is on file when the seed checks them, like a live check sees the claims already submitted.
  const travelByOrigin = new Map<string, ClaimRow[]>();
  for (const c of claims) if (c.type === "travel" && c.origin) travelByOrigin.set(c.origin, [...(travelByOrigin.get(c.origin) ?? []), c]);
  // Simulated market snapshots, as if each route had been searched on Sep 1, before the booking window.
  const fareRows = [...travelByOrigin.keys()].sort().map((origin) => {
    const base = routeFareCents(origin);
    const history = Array.from({ length: 60 }, (_, i) => ({ date: new Date(D("2026-07-04T00:00:00Z").getTime() + i * 86_400_000).toISOString().slice(0, 10), minor: String(Math.round(base * (0.88 + 0.04 * Math.sin(i / 5)))) }));
    return {
      id: `fare_demo_${origin}`, orgId: ORG, eventId: DEMO_EVENT_ID, origin, destination: "SFO", kind: "insights" as const, capturedOn: "2026-09-01", source: "fixture", truth: "Simulated",
      typicalLowMinor: BigInt(Math.round(base * 0.85)), typicalHighMinor: BigInt(Math.round(base * 1.2)), lowestMinor: BigInt(Math.round(base * 0.85)), priceLevel: "typical", history,
    };
  });
  await tx.insert(s.fareSnapshot).values(fareRows);
  const snapshotsByOrigin = new Map(fareRows.map((r) => [r.origin, toMarketSnapshots([{ ...r, createdAt: new Date() }])]));
  const decisions: (typeof s.decisionLog.$inferInsert)[] = [];
  const approvals: (typeof s.approval.$inferInsert)[] = [];
  const fareNotices: (typeof s.notice.$inferInsert)[] = [];
  const agent = agentActor(ORG);
  const seedRun = "run_demo_seed";
  for (const c of ordered) {
    if (liveIds.has(c.id)) { c.status = "submitted"; continue; }
    const farePeers = c.type === "travel" ? travelByOrigin.get(c.origin ?? "") : undefined;
    const fareSnapshots = c.type === "travel" ? snapshotsByOrigin.get(c.origin ?? "") : undefined;
    const r = evaluate({ claim: c, person: personById.get(c.personId)!, org, event, existing: processed, personNames: names, farePeers, fareSnapshots });
    c.status = r.status; c.checks = r.checks; c.reason = r.reason; c.reviewedBy = r.status === "approved" ? "agent" : null;
    if (r.fareReview) {
      c.extracted = { ...(c.extracted ?? {}), fareReview: r.fareReview };
      fareNotices.push({ id: newId("ntc"), orgId: ORG, personId: c.personId, channel: "portal", title: `A question about your ${r.fareReview.route} fare`, body: `${r.fareReview.question} Answer on your claim in the portal.`, status: "simulated" });
    }
    processed.push(c);
    decisions.push(decisionRow({ orgId: ORG, runId: seedRun, objectType: "claim", objectId: c.id, personId: c.personId, personName: names.get(c.personId), action: "claim.check", summary: r.status === "approved" ? "Auto-approved: all checks passed within the agent limit." : r.fareReview ? `Asked about the fare: ${r.fareReview.question}` : `${r.status === "needs_info" ? "Asked for info" : "Escalated"}: ${r.reason}`, actor: agent, status: r.status === "approved" ? "done" : "escalated", tool: "checkPolicy", checks: r.checks, facts: { usdMinor: c.usdMinor.toString(), fxRate: c.fxRate, fxSource: c.fxSource } }));
    if (r.status === "approved") approvals.push({ id: newId("apr"), orgId: ORG, objectType: "claim", objectId: c.id, requestedBy: c.requestedBy, approverId: "agent", approverRole: "agent", decision: "approved", reason: "Within policy and the agent limit" });
  }
  for (let i = 0; i < claims.length; i += 100) await tx.insert(s.claim).values(claims.slice(i, i + 100));

  // Payouts for auto-approved claims (agent-requested, awaiting controller release).
  const profileByPerson = new Map(profiles.map((p) => [p.personId!, p as unknown as typeof s.taxProfile.$inferSelect]));
  const methodByPerson = new Map(methods.map((m) => [m.personId, m as unknown as typeof s.payoutMethod.$inferSelect]));
  const rules = startingRules;
  const payoutRows = processed.filter((c) => c.status === "approved").map((c) => buildPayout({
    org, event, person: personById.get(c.personId)!, profile: profileByPerson.get(c.personId), active: methodByPerson.get(c.personId), payments: [], rules, now: new Date(),
  }, sourceFromClaim(c), "agent").row);
  if (payoutRows.length) await tx.insert(s.payout).values(payoutRows);
  for (let i = 0; i < decisions.length; i += 100) await tx.insert(s.decisionLog).values(decisions.slice(i, i + 100));
  if (approvals.length) await tx.insert(s.approval).values(approvals);
  if (fareNotices.length) await tx.insert(s.notice).values(fareNotices);

  // ---- awards (25)
  const dana: ActorContext = { memberId: "mem_demo_dana", orgId: ORG, role: "organizer", name: "Dana Whitfield", email: "dana@bayview.example", personId: null, demo: true, userId: null };
  const ari: ActorContext = { memberId: "mem_demo_ari", orgId: ORG, role: "controller", name: "Ari Novak", email: "ari@bayview.example", personId: null, demo: true, userId: null };
  const awardRows: (typeof s.award.$inferInsert)[] = [];
  const now = new Date();
  const award = (p: P, track: string, title: string, kind: "cash" | "item", amount: bigint, extra: Partial<typeof s.award.$inferInsert> = {}) => {
    const profile = profileByPerson.get(p.id);
    const valid = profile?.status === "valid" && (!profile.expiresAt || profile.expiresAt > now);
    const id = `awd_demo_${awardRows.length + 1}`;
    const base = { id, orgId: ORG, eventId: DEMO_EVENT_ID, personId: p.id, track, title, kind, amountMinor: amount, currency: "USD", fulfillment: kind === "cash" ? "cash" as const : "undecided" as const, status: valid ? "ready" as const : "needs_form" as const, dueAt: event.closingAt, requestedBy: dana.memberId, teamId: null, splitBps: 10000, splitConfirmed: true, ...extra };
    const rec = recommendFulfillment(toAward({ ...base, recommendation: "", shippingMinor: 0n, localMinor: 0n, createdAt: now, teamId: base.teamId ?? null, splitBps: base.splitBps ?? 10000, splitConfirmed: base.splitConfirmed ?? true, fulfillment: base.fulfillment, status: base.status } as never, p.name), toPerson(p, { profile: profile as never, paidYtdMinor: 0n, outstandingMinor: 0n, now }));
    awardRows.push({ ...base, recommendation: rec.recommendation, shippingMinor: BigInt(rec.shippingMinor), localMinor: BigInt(rec.localMinor) });
    return id;
  };
  award(priya, "First Overall", "MacBook Air", "item", 129900n);
  const jordanAward = award(jordan, "Best Hardware Hack", "2nd place", "cash", 150000n);
  award(lukas, "Judge stipend", "Judge stipend", "cash", 25000n);
  for (const p of expired.slice(1)) award(p, "Best Social Impact", "Runner-up", "cash", 50000n);
  for (const p of w9foreign) award(p, "Best Design", "Honorable mention", "cash", 50000n);
  award(treaty, "Best Developer Tool", "1st place", "cash", 100000n);
  const thresholdEarly = threshold.map((p) => award(p, "Spring Build Night", "Spring Build Night prize", "cash", 150000n));
  for (const p of threshold) award(p, "Best Use of Data", "Track prize", "cash", 60000n);
  const bankAward = award(bankSecond, "Best Mobile App", "1st place", "cash", 100000n);
  const team = [take("US"), take("IN"), take("GB")];
  const teamId = "team_demo_ai";
  for (const p of team) award(p, "Best Use of AI", "1st place (team)", "cash", 100000n, { teamId, splitBps: 3333, splitConfirmed: false });
  const sponsorPerson = take("US");
  const sponsorAward = award(sponsorPerson, "Best Civic Hack", "1st place", "cash", 100000n);
  const cleanAwardIds: string[] = [];
  const cleanPeople = [take("US"), take("US"), take("CA"), take("DE"), take("BR"), take("KR"), take("US"), take("GB")];
  const cleanAmounts = [75000n, 50000n, 50000n, 40000n, 25000n, 25000n, 30000n, 20000n];
  const cleanTracks = ["Best Beginner Hack", "Best Hack for Education", "Best Climate Hack", "Best Fintech Hack", "Best Health Hack", "Best Game", "Best Accessibility Hack", "Best Open Source Hack"];
  cleanPeople.forEach((p, i) => cleanAwardIds.push(award(p, cleanTracks[i], "1st place", "cash", cleanAmounts[i])));
  await tx.insert(s.award).values(awardRows);

  // Earlier-in-year payments for the threshold scenario: proposed by Dana, released by Ari.
  for (const id of thresholdEarly) {
    const p = await proposePayout(tx, dana, { sourceType: "award", sourceId: id });
    await releasePayout(tx, ari, p.id!);
  }
  // Batch for controller release (requested by Dana), plus scenarios.
  for (const id of [...cleanAwardIds, jordanAward, bankAward, sponsorAward]) await proposePayout(tx, dana, { sourceType: "award", sourceId: id });
  for (const a of awardRows.filter((x) => x.status === "needs_form" && x.kind === "cash")) await proposePayout(tx, dana, { sourceType: "award", sourceId: a.id! });

  // Bank detail changes arrive by email before release: payouts freeze.
  await changeBankDetails(tx, dana, { personId: jordan.id, last4: "9902", currency: "CAD", requestedVia: "email" });
  await changeBankDetails(tx, dana, { personId: bankSecond.id, last4: "5531", currency: "AUD", requestedVia: "email" });

  // Fiscal sponsor paid $970.00 on a $1,000.00 request.
  const packetId = await sponsorSeed(tx, dana, ari, sponsorAward);
  await reconcilePacketSeed(tx, packetId, 97000n);
  planted.push({ scenario: "Sponsor short-paid", objectType: "packet", objectId: packetId, expected: "exception", description: "Remittance shows $970.00 on a $1,000.00 request (wire fee deducted)." });

  await tx.insert(s.answerKey).values(planted.map((p, i) => ({ id: `key_demo_${String(i + 1).padStart(2, "0")}`, orgId: ORG, scenario: p.scenario, objectType: p.objectType, objectId: p.objectId, expected: p.expected, expectedCode: p.code ?? null, description: p.description })));
  await tx.insert(s.notice).values({ id: newId("ntc"), orgId: ORG, personId: priya.id, channel: `email p•••@example.com`, title: "You won First Overall: MacBook Air", body: "Congratulations! Complete your W-8BEN in the Eve portal so we can deliver your prize.", status: "simulated" });
}

/** Deletes and re-seeds only the demo org. */
export async function resetDemoOrg(tx: Executor, preset: DemoSeedPreset = "demo") {
  await purgeOrg(tx, ORG, { deleteOrg: true });
  await seedDemoOrg(tx, preset);
}

/** Seeds the demo org once (serialized with a transaction-scoped advisory lock). */
export async function ensureDemoOrg(db = getDb(), preset: DemoSeedPreset = "demo") {
  const [exists] = await db.select({ id: s.organization.id }).from(s.organization).where(eq(s.organization.id, ORG));
  if (exists) return false;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('eve-demo-seed'))`);
    const [again] = await tx.select({ id: s.organization.id }).from(s.organization).where(eq(s.organization.id, ORG));
    if (again) return false;
    await seedDemoOrg(tx, preset);
    return true;
  });
}
