// Tax engine: rules table loader, withholding, thresholds, filings.
//
// Rates, thresholds, and forms come from the versioned `rule` table (with
// effective dates and a source link), never from the model or hardcoded
// constants. This is plain, tested code; the LLM only picks which facts apply.

export {};
