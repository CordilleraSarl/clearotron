// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CALL CUT OFF MID-WAY KEEPS THE ANSWERS IT HAD.
//
// The plan executor wrote the band once, when the call ended. On a test run of a crowded matter a follow-up call
// answered four questions, then kept retrying a search the register's gateway timed out until the worker's time limit
// ended it: the four answers never reached the band, and the worker's retry asked the four again. The executor now
// writes each answer to the band shortly after it lands, while the call goes on. Driven through the real executor
// against a stand-in register whose second question never answers. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeExecutePlan, KEEP_ANSWERS_AFTER_MS } from "../execute-plan.mjs";

const AXIS = "primary-sweep";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const question = (qid, term) => ({ qid, axis: AXIS, origin: "supplemental", predicate: "default", term, nice_classes: [9], regions: [], expected_kind: "enumerate" });
const never = new Promise(() => {});
const readBand = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

test("an answer already received reaches the band while a later question in the same call never comes back", async (t) => {
  const run = mkdtempSync(join(tmpdir(), "keep-answers-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "register-units"), { recursive: true });
  const planPath = join(run, "register-units", `${AXIS}-supplemental-plan.json`);
  const outPath = join(run, "register-units", `${AXIS}-band.json`);
  writeFileSync(planPath, JSON.stringify({ regions: [], entries: [question("sup:a", "QZORVA"), question("sup:b", "QZORVEK")] }));
  writeFileSync(outPath, JSON.stringify([{ qid: "other:x", state: "enumerated", total_hits: 0, count: 0, records: [] }]));
  const answer = (p) => (p.name === "QZORVEK" ? never
    : ok({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: "/mark/jp/qzorva-1", mark_text: "QZORVA", classes: [9], status: "Registered" }] }));
  const executePlan = makeExecutePlan({
    search: async (_a, p) => answer(p), enumerate: async (_a, p) => answer(p), capabilities: { id: "a-register-that-needs-no-office" },
  });
  executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: outPath, qids: ["sup:a", "sup:b"] }, {});   // never settles
  const deadline = Date.now() + KEEP_ANSWERS_AFTER_MS + 3000;
  let band = readBand(outPath);
  while (!band?.some((b) => b.qid === "sup:a") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    band = readBand(outPath);
  }
  const a = band?.find((b) => b.qid === "sup:a");
  assert.ok(a, "the answer the call had received never reached the band while the call was cut off");
  assert.equal(a.state, "enumerated");
  assert.notEqual(a.error, true);
  assert.ok(band.some((b) => b.qid === "other:x"), "keeping an answer early dropped another question's block");
  assert.equal(band.some((b) => b.qid === "sup:b"), false, "a question with no answer must have no block");
});
