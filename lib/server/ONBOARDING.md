# Onboarding and invitations API

Real Better Auth accounts only (`/api/auth/*`, email + password). Demo persona cookies never count. All errors are `{ ok: false, code, message }`. Mutations reject cross-site `Origin`.

## Session states for the UI

`GET /api/app`:
- 200 snapshot: signed in with a membership (or anonymous demo bootstrap in demo mode).
- 403 `{ code: "setup_required" }`: signed in, no organization yet. Send the user to setup.
- 401 `{ code: "unauthenticated" }`: no session (outside demo mode).

## Endpoints

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/onboarding` | none | `{ ok, user: { id, name, email, emailVerified }, memberships: [{ memberId, orgId, orgName, role, isDemo }], ownedOrgId, pendingInvitations: [{ id, orgId, orgName, role, expiresAt, invitedByName }], needsSetup, canCreateOrganization }` |
| POST | `/api/onboarding/organization` | see below | 201 (created) or 200 (already created; same org returned) `{ ok, created, orgId, eventId, memberId }`; sets the active-org cookie |
| POST | `/api/onboarding/active-org` | `{ orgId }` | `{ ok, orgId, role, orgName }`; sets the active-org cookie (membership required) |
| GET | `/api/invitations` | none | `{ ok, orgId, invitations: [{ id, email, role, invitedBy, createdAt, expiresAt, status: "pending"\|"accepted"\|"revoked"\|"expired", acceptedAt }] }` (organizer/controller/auditor of the active org) |
| POST | `/api/invitations` | `{ email, role: "organizer"\|"controller"\|"auditor" }` | 201 `{ ok, invitation: { id, email, role, status, expiresAt }, token, acceptPath: "/invite/<token>", acceptUrl, delivery: { channel: "copy_link", sent: false, detail } }`. Organizers only. Shown once; re-inviting the same email rotates the token. |
| POST | `/api/invitations/:id/revoke` | none | `{ ok, id, status: "revoked" }` (organizers) |
| GET | `/api/invitations/lookup?token=` | none | `{ ok, orgName, role, emailMasked, status, expiresAt }` (no session needed; for the invite page) |
| POST | `/api/invitations/accept` | `{ token }` | `{ ok, orgId, memberId, role, alreadyAccepted }`; sets the active-org cookie |

### `POST /api/onboarding/organization` body

```json
{
  "org": { "name": "Bayview Hacks", "country": "US", "currency": "USD", "mode": "hybrid", "sponsorName": "", "sponsorTurnaroundDays": 10, "feesPaidBy": "org", "agentLimitMinor": "30000", "organizerLimitMinor": "200000" },
  "event": { "name": "Bayview Hacks 2026", "startsAt": "2026-10-24T16:00:00Z", "endsAt": "2026-10-25T22:00:00Z", "checkInAt": "2026-10-24T20:30:00Z", "closingAt": "2026-10-25T22:00:00Z", "bookingDeadline": "2026-10-10T23:59:00Z", "venue": "Pier 48", "expectedHeadcount": 300, "travelCapMinor": "50000", "economyOnly": true },
  "budgets": [{ "name": "Travel", "category": "travel", "capMinor": "4500000", "fundingSource": "Sponsor grant" }]
}
```

Only `org.name`, `org.country` (US or CA) and the `event` fields are required. Date-times need `Z` or an offset. Check-in and closing must fall within the event, and the booking deadline must be before it starts. If `budgets` is omitted, four starting lines are created: Travel (cap × a third of headcount), plus Ground transport, Team supplies and Prizes at $0, all with funding source "To confirm". One current event per org.

## Error codes

`unauthenticated` 401 · `setup_required` 403 · `not_member` / `forbidden` / `demo_org` / `email_mismatch` 403 · `not_found` 404 · `already_member` / `self_invite` / `used` / `not_pending` 409 · `expired` / `revoked` 410 · `invalid` 400.

## Notes

- No email provider is configured, so invites are delivered by copy-link. The invitee also sees pending invites in `GET /api/onboarding`, but still needs the link token to accept.
- The token is 256 bits of randomness; only its SHA-256 is stored. It expires after 7 days and works once. Possessing it together with a matching signed-in email is the proof of invitation (accounts are not email-verified).
- Attendees are not invited here; they come from `people.import`.
