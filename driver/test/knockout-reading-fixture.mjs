// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A knockout's register moment, up to its record, over a stand-in register: the counts, the question plan, each name's
// own list and the record built from them, each through the real code. Shared by the tests that read that record. Not a
// test file itself. Names here and in its callers are invented.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { countRegisterHits } from "../register-count.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { executeQuestionsWithLister, knockoutAxis, knockoutBandBlocks, knockoutBandPath, knockoutProposals, knockoutQuestionPlan,
  knockoutRecordsDoc, openingQid, questionPlanPath } from "../knockout-register-read.mjs";

/**
 * @param lister   async (term, { classes, regions, matchMode, goods }) => { ok, records, total, ... } — the stand-in register
 * @param counter  the counts' own stand-in, where a test sets one; the lister answers them otherwise
 * @param execute  a real executor for the name's own list, where a test drives a provider's adapter
 * @param ask      async ({ runDir }) => void, run after the name's own list, for questions a test proposes itself
 * @param reading  the reading step's accepted record, or null for a step that did not finish
 */
export async function readingDoc({ marks, classes = null, jurisdictions = null, provider = "signa", capabilities = { id: provider }, lister, counter = null,
  execute = null, unreachable = [], variantCap = undefined, reading = null, ask = null, framedMarks = [], root = tmpdir() }) {
  const runDir = mkdtempSync(join(root, "ko-reading-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const counts = await countRegisterHits({ marks, classes, jurisdictions, provider, capabilities, unreachable,
    ...(variantCap !== undefined ? { variantCap } : {}),
    counter: counter ?? (async (term, p, { classes: cls, regions }) => {
      const r = await lister(term, { classes: cls, regions, matchMode: p.matchMode });
      if (!r?.ok) return { ok: false, total: null, reason: r?.reason };
      return r.approximate === true ? { ok: true, total: null, approximate: true, floor: r.floor } : { ok: true, total: Number.isFinite(r.total) ? r.total : (r.records ?? []).length };
    }) });
  writeFileSync(driverDir(runDir, "register-counts.json"), JSON.stringify(counts));
  writeFileSync(driverDir(runDir, "instructed-scope.json"), JSON.stringify({ marks: marks.map((m) => m.name) }));
  writeFileSync(questionPlanPath(runDir), JSON.stringify(knockoutQuestionPlan({ marks, classes, jurisdictions, capabilities, unreachable, framedMarks })));
  for (const m of counts.marks) {
    if (!(m?.counts?.identical?.total > 0 || m?.counts?.identical?.approximate === true)) continue;
    const params = { planPath: questionPlanPath(runDir), axis: knockoutAxis(m.name), outputPath: knockoutBandPath(runDir, m.name), qids: [openingQid(m.name, "identical")] };
    if (execute) await execute(params);
    else await executeQuestionsWithLister(lister, { plan_path: params.planPath, axis: params.axis, output_path: params.outputPath, qids: params.qids });
  }
  if (ask) await ask({ runDir });
  const doc = knockoutRecordsDoc({ marks, classes, jurisdictions, provider, capabilities, unreachable, counts, reading,
    readBlocks: (name) => knockoutBandBlocks(runDir, name), readProposals: (name) => knockoutProposals(runDir, name) });
  return { doc, counts, runDir };
}
