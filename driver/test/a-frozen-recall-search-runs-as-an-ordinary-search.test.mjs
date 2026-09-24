// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives the shared plan executor over a frozen plan, with the register stubbed
//
// A RUN FROZEN BEFORE THE RECALL STORE WAS REMOVED STILL CARRIES ITS RECALL SEARCHES. The recall lane
// folded `recall-*` entries into the run's frozen plan, and a plan is never re-planned on resume. So a
// run started before the removal and resumed after it holds entries no code mints any more. They must
// run as the ordinary searches they are: the lane is gone, not the questions it had already asked.
//
// BREAK MATRIX:
//   · the executor skips a `recall-*` entry on a whole-axis dispatch     → arm 1 red
//   · the repair path cannot target one by its qid                       → arm 2 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";

const entry = (qid, term) => ({
  qid, axis: "primary-sweep", predicate: "exact", term, nice_classes: [9], regions: ["CH"], expected_kind: "enumerate",
});
const FROZEN = [entry("primary-sweep:exact:novapulse", "NOVAPULSE"), entry("recall-novapulzo", "NOVAPULZO")];

/** One dispatch of the primary-sweep axis through the shared executor: the band it wrote, and every term that reached the wire. */
async function dispatch(params = {}) {
  const dir = mkdtempSync(join(tmpdir(), "frozen-recall-"));
  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify({ regions: ["CH"], entries: FROZEN }));
  const wire = [];
  const answer = { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) };
  const executePlan = makeExecutePlan({
    search: async (_a, p) => { wire.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { wire.push(p); return answer; },
  });
  try {
    const res = await executePlan("auth", { plan_path: planPath, axis: "primary-sweep", output_path: outPath, ...params }, {});
    assert.ok(!String(res.text).startsWith("ERROR"), res.text);
    const band = JSON.parse(readFileSync(outPath, "utf8"));
    return { band, terms: wire.map((p) => JSON.stringify(p)) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const qidsOf = (band) => band.map((b) => b.qid);

test("a whole-axis dispatch runs a frozen recall entry beside the ordinary one", async () => {
  const { band, terms } = await dispatch();
  assert.ok(terms.some((t) => t.includes("NOVAPULZO")), "the frozen recall search never reached the register");
  assert.ok(terms.some((t) => t.includes("NOVAPULSE")), "the ordinary search never reached the register");
  assert.ok(qidsOf(band).includes("recall-novapulzo"), `the band holds no block for the recall entry: ${JSON.stringify(qidsOf(band))}`);
  assert.ok(qidsOf(band).includes("primary-sweep:exact:novapulse"));
});

test("the repair path can still target a frozen recall entry by its qid", async () => {
  const { band, terms } = await dispatch({ qids: ["recall-novapulzo"] });
  assert.ok(terms.some((t) => t.includes("NOVAPULZO")), "a targeted re-run of the recall entry sent nothing");
  assert.ok(!terms.some((t) => t.includes("\"NOVAPULSE\"")), "a targeted re-run also sent an entry it was not asked for");
  assert.ok(qidsOf(band).includes("recall-novapulzo"));
});
