// Additive onboarding tables, kept apart from lib/db/schema.ts (owned by the
// financial fix worker). drizzle.config.ts lists both files.
//
// org_owner:      one self-created organization per Better Auth user; makes
//                 POST /api/onboarding/organization idempotent under retries/races.
// org_invitation: teammate invites. Only a SHA-256 hash of the random token is
//                 stored; the role is fixed at invite time and never read from
//                 the accepting request.

import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { authUser, orgMember, organization, roleEnum } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const orgOwner = pgTable("org_owner", {
  orgId: text("org_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_owner_user_uq").on(t.userId)]);

export const orgInvitation = pgTable("org_invitation", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  /** Lowercased. Acceptance requires the signed-in user's email to match. */
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status", { enum: ["pending", "accepted", "revoked"] }).notNull().default("pending"),
  invitedBy: text("invited_by").notNull().references(() => orgMember.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  acceptedByUserId: text("accepted_by_user_id").references(() => authUser.id, { onDelete: "set null" }),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_invitation_token_uq").on(t.tokenHash),
  uniqueIndex("org_invitation_pending_uq").on(t.orgId, t.email).where(sql`${t.status} = 'pending'`),
  index("org_invitation_org_idx").on(t.orgId),
]);
