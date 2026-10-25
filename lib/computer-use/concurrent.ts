/** Bounded, ordered work. Waits for every in-flight worker before propagating errors. */
export async function mapConcurrent<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency must be a positive integer.");
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await work(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  });
  const settled = await Promise.allSettled(workers);
  for (const result of settled) if (result.status === "rejected") throw result.reason;
  return results;
}
