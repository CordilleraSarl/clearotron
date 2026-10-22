// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOLLOW-UP ANSWERED BEFORE A PARK COUNTS ONCE AFTER THE RESUME.
//
// The safety net counts the follow-up searches a run sends, every worker and pass together, and keeps its count in the
// run's own file, so a resume, which is a new process, goes on from it. A question the run has asked and answered counts
// nothing when it is sent again, and one whose earlier send failed counts again. Whether it was answered is read from
// the axis's band. A unit whose pass is killed at its time limit is parked: its band is renamed so the resume runs the
// unit again, and the re-run sends the same follow-ups. Each of them was answered, and its answer is in the renamed
// band, so it still counts nothing. Driven through the real plan executor. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeExecutePlan } from "../execute-plan.mjs";
import { makeLedger } from "../ledger.mjs";
import { FOLLOW_UP_SEARCH_LIMIT, SEARCHES_FILE, followUpSearchesSent } from "../follow-up-searches.mjs";

const AXIS = "primary-sweep";
const LIMIT = FOLLOW_UP_SEARCH_LIMIT;
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const followUp = (qid, term) => ({ qid, axis: AXIS, origin: "supplemental", predicate: "default", term, nice_classes: [9], regions: [], expected_kind: "enumerate" });

function runFolder(t, { sent = 0 } = {}) {
  const run = mkdtempSync(join(tmpdir(), "follow-up-park-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const driver = join(run, "_driver");
  mkdirSync(driver, { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(join(driver, "register-plan.json"), JSON.stringify({ regions: [], entries: [
    { qid: `${AXIS}:exact:qzorvak`, axis: AXIS, predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9], expected_kind: "enumerate" },
  ] }));
  if (sent) writeFileSync(join(driver, SEARCHES_FILE), Array.from({ length: sent }, (_, i) => JSON.stringify({ qid: `earlier-${i}` })).join("\n") + "\n");
  return { run, driver, recordLog: join(driver, "register-record-bodies.jsonl"), band: join(run, "register-units", `${AXIS}-band.json`) };
}

/** A fresh executor, as a resumed pass's new process has, against a stand-in register that answers or fails. */
function executor({ fail = false } = {}) {
  const { logCall } = makeLedger("stand-in");
  const asked = [];
  const answer = (tctx, p) => {
    asked.push(p.name);
    logCall(tctx, fail ? { http_status: 400, ok: false } : { http_status: 200, ok: true });
    if (fail) throw new Error("400 the register refused the query");
    return ok({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: "/mark/jp/qzorva-1", mark_text: "QZORVA", classes: [9], status: "Registered" }] });
  };
  return { executePlan: makeExecutePlan({ search: async (_a, p, tctx) => answer(tctx, p), enumerate: async (_a, p, tctx) => answer(tctx, p),
    capabilities: { id: "a-register-that-needs-no-office" } }), asked };
}

async function send(executePlan, f, entries) {
  const planPath = join(f.run, "register-units", `${AXIS}-supplemental-plan.json`);
  writeFileSync(planPath, JSON.stringify({ regions: [], entries }));
  const res = await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: f.band }, { kind: "propose_supplemental", recordLog: f.recordLog });
  assert.ok(!String(res.text).startsWith("ERROR"), res.text);
  return JSON.parse(res.text);
}

/** The taint park: the band renamed, never deleted, so the resume runs the unit again. */
const park = (f, attempt = 0) => renameSync(f.band, `${f.band}.tainted-${attempt}`);

test("the count is the run's own and a resumed pass goes on from it", async (t) => {
  const f = runFolder(t);
  await send(executor().executePlan, f, [followUp("sup:a", "QZORVA"), followUp("sup:b", "QZORVEK")]);
  assert.equal(followUpSearchesSent(f.driver).sent, 2);
  await send(executor().executePlan, f, [followUp("sup:c", "QZORVIN")]);
  assert.equal(followUpSearchesSent(f.driver).sent, 3, "a new process started its own count");
});

test("a follow-up answered before a park is sent again after the resume and counts nothing, with the net full", async (t) => {
  const f = runFolder(t, { sent: LIMIT - 1 });
  const first = executor();
  await send(first.executePlan, f, [followUp("sup:a", "QZORVA")]);
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT, "guard: the first asking filled the net");
  park(f);

  const resumed = executor();
  const reply = await send(resumed.executePlan, f, [followUp("sup:a", "QZORVA")]);
  assert.equal(reply.outstanding, undefined, "a question answered before the park was held back as if it had never been answered");
  assert.deepEqual(resumed.asked, ["QZORVA"], "the re-run's question was not sent");
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT, "a question answered before the park counted again");
  assert.equal(readFileSync(join(f.driver, SEARCHES_FILE), "utf8").split("\n").filter(Boolean).length, LIMIT, "the resent question wrote a line of its own");
});

test("a follow-up that failed before a park still counts again after the resume, so the net still stops it", async (t) => {
  const f = runFolder(t, { sent: LIMIT - 2 });
  await send(executor({ fail: true }).executePlan, f, [followUp("sup:a", "QZORVA")]);
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT - 1, "guard: the failed asking counted once");
  park(f);
  await send(executor({ fail: true }).executePlan, f, [followUp("sup:a", "QZORVA")]);
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT, "a question that failed before the park was counted as answered");
  park(f, 1);
  const last = executor({ fail: true });
  assert.deepEqual((await send(last.executePlan, f, [followUp("sup:a", "QZORVA")])).outstanding, ["sup:a"], "the full net let a failing question through");
  assert.deepEqual(last.asked, [], "the register was asked past the full net");
});

test("the band the park renames is the one the net reads, under the name it reads", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "driver", "pipeline.mjs"), "utf8");
  assert.match(src, /for \(const f of \[P\.registerUnit\(a\), P\.registerBand\(a\)\]\)/, "the park no longer renames the axis's band");
  assert.match(src, /`\$\{f\}\.tainted-\$\{recoveryAttempts\}`/, "the park renames a band to something other than <band>.tainted-<n>");
});
