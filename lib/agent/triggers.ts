import { start } from "workflow/api";

import { getChaseCandidates } from "@/lib/agent/automation";
import { taxChaseWorkflow } from "@/workflows/tax-chase";

/** Call after committing the source action. Hook tokens deduplicate concurrent starts. */
export async function startTaxChases(orgId: string, options: { personId?: string; acceleratedDemo?: boolean } = {}): Promise<string[]> {
  const targets = (await getChaseCandidates(orgId)).filter((target) => !options.personId || target.personId === options.personId);
  const runIds: string[] = [];
  for (let offset = 0; offset < targets.length; offset += 5) {
    const batch = await Promise.all(targets.slice(offset, offset + 5).map(async (target) => {
      const run = await start(taxChaseWorkflow, [target, options.acceleratedDemo === true]);
      return run.runId;
    }));
    runIds.push(...batch);
  }
  return runIds;
}
