// Team prize splits. Parts always sum to the prize exactly; leftover cents go
// to members in the listed order (largest remainder first).
import { EngineError, allocate, parseNonNegativeMinor, toMinor } from "./money";

export interface SplitInput {
  amountMinor: string;
  memberIds: string[];
  /** Custom split as integer shares (e.g. basis points or percents). Even split when omitted. */
  shares?: Record<string, number>;
  /** Members who confirmed a custom split. Every member must confirm before it applies. */
  confirmedBy?: string[];
}

export interface SplitResult {
  parts: { personId: string; amountMinor: string }[];
  custom: boolean;
  confirmed: boolean;
  reason: string;
}

export function splitAward(input: SplitInput): SplitResult {
  const total = parseNonNegativeMinor(input.amountMinor, "amountMinor");
  const ids = input.memberIds;
  if (ids.length === 0) throw new EngineError("invalid_input", "a team needs at least one member");
  if (new Set(ids).size !== ids.length) throw new EngineError("invalid_input", "team members must be unique");

  const custom = Boolean(input.shares);
  let weights = ids.map(() => 1n);
  if (input.shares) {
    const extra = Object.keys(input.shares).filter((k) => !ids.includes(k));
    if (extra.length) throw new EngineError("invalid_input", `shares name non-members: ${extra.join(", ")}`);
    weights = ids.map((id) => {
      const s = input.shares![id] ?? 0;
      if (!Number.isSafeInteger(s) || s < 0) throw new EngineError("invalid_input", `share for ${id} must be a non-negative integer`);
      return BigInt(s);
    });
  }
  const confirmedSet = new Set(input.confirmedBy ?? []);
  const confirmed = !custom || ids.every((id) => confirmedSet.has(id));
  const parts = allocate(total, weights).map((p, i) => ({ personId: ids[i], amountMinor: toMinor(p) }));
  const missing = ids.filter((id) => !confirmedSet.has(id));
  return {
    parts,
    custom,
    confirmed,
    reason: !custom
      ? `Split evenly across ${ids.length} members.`
      : confirmed
        ? "Custom split confirmed by every member."
        : `Custom split waiting on ${missing.length} confirmation${missing.length === 1 ? "" : "s"}; hold payouts until all members confirm.`,
  };
}
