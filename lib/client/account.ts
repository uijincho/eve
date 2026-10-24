// Real accounts, organizations and invitations (lib/server/ONBOARDING.md).
// Demo personas never pass through here; see switchPersona in ./api.
import { errorFrom } from "./api";

export type StaffRole = "organizer" | "controller" | "auditor";

export type Onboarding = {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  memberships: { memberId: string; orgId: string; orgName: string; role: string; isDemo: boolean }[];
  ownedOrgId: string | null;
  pendingInvitations: { id: string; orgId: string; orgName: string; role: string; expiresAt: string; invitedByName: string }[];
  needsSetup: boolean;
  canCreateOrganization: boolean;
};

export type InviteLookup = { orgName: string; role: string; emailMasked: string; status: string; expiresAt: string };

export type Invitation = {
  id: string; email: string; role: string; invitedBy: string; createdAt: string; expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired"; acceptedAt?: string | null;
};

export type CreatedInvite = {
  invitation: { id: string; email: string; role: string; status: string; expiresAt: string };
  person?: { id: string; name: string };
  token: string;
  acceptPath: string;
  acceptUrl: string;
  delivery: { channel: string; sent: boolean; detail: string };
};

export type Member = {
  memberId: string; name: string; email: string; role: string; personId: string | null;
  hasAccount: boolean; demoPersona: boolean; isYou: boolean; createdAt: string;
};

export type NewOrganization = {
  org: { name: string; country: "US" | "CA"; currency?: string; mode?: "direct" | "sponsor" | "hybrid"; sponsorName?: string; sponsorTurnaroundDays?: number; feesPaidBy?: "org" | "recipient"; agentLimitMinor?: string; organizerLimitMinor?: string };
  event: { name: string; startsAt: string; endsAt: string; checkInAt: string; closingAt: string; bookingDeadline: string; venue: string; expectedHeadcount: number; travelCapMinor: string; economyOnly: boolean };
};

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    cache: "no-store",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

/** Better Auth email + password. Passwords need at least 12 characters. */
export const auth = {
  signIn: (email: string, password: string) => call<unknown>("/api/auth/sign-in/email", { body: { email, password } }),
  signUp: (name: string, email: string, password: string) => call<unknown>("/api/auth/sign-up/email", { body: { name, email, password } }),
  signOut: () => call<unknown>("/api/auth/sign-out", { body: {} }),
};

export const onboarding = {
  get: () => call<Onboarding>("/api/onboarding"),
  createOrganization: (body: NewOrganization) => call<{ created: boolean; orgId: string }>("/api/onboarding/organization", { body }),
  setActiveOrg: (orgId: string) => call<{ orgId: string; role: string }>("/api/onboarding/active-org", { body: { orgId } }),
};

export const invitations = {
  list: () => call<{ invitations: Invitation[] }>("/api/invitations"),
  create: (email: string, role: StaffRole) => call<CreatedInvite>("/api/invitations", { body: { email, role } }),
  inviteAttendee: (personId: string) => call<CreatedInvite>("/api/invitations/attendee", { body: { personId } }),
  revoke: (id: string) => call<{ status: string }>(`/api/invitations/${encodeURIComponent(id)}/revoke`, { body: {} }),
  lookup: (token: string) => call<InviteLookup>(`/api/invitations/lookup?token=${encodeURIComponent(token)}`),
  accept: (token: string) => call<{ orgId: string; role: string; personId?: string | null; alreadyAccepted: boolean }>("/api/invitations/accept", { body: { token } }),
};

export const members = {
  list: () => call<{ members: Member[] }>("/api/members"),
};

/** Where a member lands after signing in or accepting an invite. */
export function homeFor(role?: string | null): string {
  return role === "attendee" ? "/portal" : "/overview";
}
