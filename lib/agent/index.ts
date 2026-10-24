// Agent: typed tools, prompts, and per-job agent functions (AI SDK + Claude).
//
// Tools check permissions in code before doing anything: extractReceipt,
// checkPolicy, quoteFlights, computeWithholding, quotePayouts, proposePayout,
// requestApproval, messagePerson, postJournal. Every tool call and model
// response writes a decision_log row.
//
// There is no tool that approves or releases money. executePayout is only
// reachable from a controller-signed approval and is not an agent tool.

export {};
