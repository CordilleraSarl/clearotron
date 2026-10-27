// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A QUESTION A CUT-OFF CALL ANSWERED IS NOT ASKED AGAIN WHEN THE WORKER RE-PROPOSES IT.
//
// The propose tool already keeps the answer to a question a worker re-proposes, when the band holds it. On a test run
// of a crowded matter the band did not: the call that asked the questions was cut off by the worker's time limit while
// it retried a search the register's gateway timed out, and its answers were never written. The worker's retry
// re-proposed them and the tool asked them again. With the executor keeping each answer as it lands, the re-proposal is
// held and the register is not asked. Driven through the propose tool and the real executor, against a stand-in
// register whose second question never answers. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { makeExecutePlan, KEEP_ANSWERS_AFTER_MS } from "../../providers/_shared/execute-plan.mjs";

const AXIS = "transliteration-numeric";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const never = new Promise(() => {});
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const proposal = (term) => ({ predicate: "default", term, nice_classes: [9], rationale: "a romanised spelling of the mark" });

test("a re-proposed question whose answer a cut-off call received is held, and the register is not asked again", async (t) => {
  const run = mkdtempSync(join(tmpdir(), "cut-off-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(driverDir(run, "register-plan.json"), JSON.stringify({ regions: ["JP", "KR"], nice_classes: ["9"], entries: [
    { qid: "primary-sweep:exact:qzorvak", axis: "primary-sweep", predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9] },
  ] }));
  const band = join(run, "register-units", `${AXIS}-band.json`);
  const asked = [];
  const answer = (p) => {
    asked.push(p.name);
    return p.name === "QZORVEK" ? never
      : ok({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: "/mark/jp/qzorva-1", mark_text: "QZORVA", classes: [9], status: "Registered" }] });
  };
  const real = makeExecutePlan({ search: async (_a, p) => answer(p), enumerate: async (_a, p) => answer(p), capabilities: { id: "a-register-that-needs-no-office" } });
  const executePlan = (params, tctx) => real("auth", params, tctx);
  const tctx = { kind: "propose_supplemental", sessionKey: "run-x" };

  proposeSupplemental({ axis: AXIS, output_path: band, proposals: [proposal("QZORVA"), proposal("QZORVEK")] }, tctx, { executePlan });   // cut off: never settles
  const deadline = Date.now() + KEEP_ANSWERS_AFTER_MS + 3000;
  while (!(readJson(band) ?? []).some((b) => String(b.qid).includes(":qzorva:")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  const askedBefore = asked.filter((n) => n === "QZORVA").length;
  assert.equal(askedBefore >= 1, true, "guard: the first call asked the question");

  const again = JSON.parse((await proposeSupplemental({ axis: AXIS, output_path: band, proposals: [proposal("QZORVA")] }, tctx, { executePlan })).text);
  assert.equal(again.reused?.length, 1, "guard: the re-proposal reuses the question's qid");
  assert.deepEqual(again.held_answer_kept, again.reused, "the re-proposed question was not held");
  assert.equal(asked.filter((n) => n === "QZORVA").length, askedBefore, "the register was asked the re-proposed question again");
});
