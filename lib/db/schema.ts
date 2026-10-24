// Drizzle schema. Empty for now.
//
// Core tables to come (PRD, "Data model and ledger"):
//   org, event, person, tax_profile, payout_method, claim, prize_award,
//   payout, approval, rule, decision_log, journal_entry, journal_line, filing,
//   vault (pgcrypto-encrypted TIN/SSN/SIN/bank numbers; the app and the agent
//   only ever see tokens and last 4 digits)
// plus the Better Auth tables (user, session, account, verification).
//
// Money rules: amounts are bigint integer minor units with a currency code;
// FX rates are numeric(18,8). Never floats.
//
// The ledger balance check (a deferred constraint trigger: debits = credits per
// entry at commit) and the append-only grants on journal tables ship as a
// custom raw SQL migration: `pnpm db:generate --custom`.

export {};
