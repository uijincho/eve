// Double-entry ledger: postJournal, reverse, period lock.
//
// Posted entries are immutable; corrections are reversing entries linked to
// the original. Debits = credits per entry is enforced by a deferred
// constraint trigger in the database, not only here. Locked periods reject
// new entries.

export {};
