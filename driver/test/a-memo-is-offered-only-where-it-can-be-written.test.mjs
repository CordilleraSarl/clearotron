// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MEMO IS OFFERED ONLY WHERE ONE CAN BE WRITTEN, AND IT IS GIVEN THE FRAMEWORK THE RUN FROZE (design, 2026-11-24).
//
// The planner called a memo on a delivered Knockout runnable, and the worker then refused it for want of the findings file
// it reads: the asker was promised a memo and got a refusal later (reproduced offline, 2026-11-24). A live run's findings
// file passed the same test, though it is an intermediate one. A memo is written over a delivered clearance report whose
// findings can be read, and the plan, the queue, the run and the worker now ask that one question before any session.
// And the memo's manual promised the framework while the worker sent only a profile key. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { whatIfPlan, whatIfEnqueue, whatIfRun } from "../../mcp-server/lib/whatif.mjs";
import { askArchivedRun, composeMemoMessage, parentFramework, MEMO_FAILS, MEMO_RULES_LINE } from "../whatif-memo-run.mjs";
import { memoEligibility } from "../whatif-queue.mjs";

const ASSUMPTION = "treat the earlier filing as abandoned";
/** A run on disk. `files` are written at its root; `state` is what its status records. */
function runOf({ state = "delivered", location = "archive", files = { "findings.json": "{\"findings\":[]}" } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "memo-offered-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  return { runId: "quillmere-2026-11-24-fen", runDir: dir, location, state, P: {}, status: {} };
}
const token = (run) => Buffer.from(JSON.stringify({ runId: run.runId, kind: "memo", instructions: ASSUMPTION })).toString("base64url");

/** Every door's answer for one run: the plan, the queue, the run and the worker. */
async function doors(run) {
  const plan = whatIfPlan({ run, kind: "memo", instructions: ASSUMPTION });
  const queue = await whatIfEnqueue({ run, confirmationToken: token(run) }, { enqueueWhatIf: () => ({ id: "x", queuedAt: 0 }) })
    .then(() => null, (e) => e.message);
  let seated = false;
  const reason = async () => { seated = true; return { body: "A reading.", limits: [] }; };
  const ran = await whatIfRun({ confirmationToken: token(run) }, { resolveRun: () => run, askArchivedRun: async () => ({ ok: true }) })
    .then(() => null, (e) => e.message);
  const worker = await askArchivedRun({ runId: run.runId, question: ASSUMPTION }, { resolveRun: () => run, reason });
  return { plan, queue, ran, worker, seated };
}

test("a delivered clearance with readable findings is offered a memo at every door", async () => {
  const d = await doors(runOf());
  assert.equal(d.plan.runnable, true, d.plan.reason);
  assert.equal(d.queue, null);
  assert.equal(d.ran, null);
  assert.equal(d.seated, true, "the worker refused a memo the plan offered");
});

test("every run a memo is not written over is refused by name at the plan, the queue, the run and the worker, before a session", async () => {
  const cases = {
    "a delivered Knockout": [runOf({ files: { "knockout-findings.json": "{}", "knockout-plan.json": "{}" } }), "knockout", MEMO_FAILS.NOT_ELIGIBLE],
    "a live run with an intermediate findings file": [runOf({ state: "running", location: "in-flight" }), "not_delivered", MEMO_FAILS.NOT_ELIGIBLE],
    "an archived run that never completed": [runOf({ state: "failed" }), "not_delivered", MEMO_FAILS.NOT_ELIGIBLE],
    "a cancelled run": [runOf({ state: "cancelled" }), "stopped", MEMO_FAILS.NOT_ELIGIBLE],
    "a delivered clearance whose findings cannot be read": [runOf({ files: { "findings.json": "{not json" } }), "unreadable", MEMO_FAILS.NO_EVIDENCE],
  };
  for (const [label, [run, fail, code]] of Object.entries(cases)) {
    const why = memoEligibility(run);
    assert.equal(why?.fail, fail, `${label}: ${JSON.stringify(why)}`);
    const d = await doors(run);
    assert.equal(d.plan.runnable, false, `${label}: the plan offered it`);
    assert.equal(d.plan.reason, `Run ${run.runId}: ${why.reason}.`, `${label}: the plan gave another reason`);
    assert.ok(d.queue?.includes(why.reason), `${label}: the queue took it (${d.queue})`);
    assert.ok(d.ran?.includes(why.reason), `${label}: the run took it (${d.ran})`);
    assert.equal(d.worker.fail, code, `${label}: the worker answered ${d.worker.fail}`);
    assert.equal(d.seated, false, `${label}: a model session was started`);
  }
  // The Knockout is refused for what it is, never as a search with nothing in it.
  const knockout = memoEligibility(cases["a delivered Knockout"][0]).reason;
  assert.match(knockout, /Knockout/);
  assert.doesNotMatch(knockout, /no findings|none for it|nothing/, "the refusal says the Knockout has no findings");
});

test("delivered is read from the run's state or its marker, never from the archive alone", () => {
  assert.equal(memoEligibility(runOf({ state: null, files: { "findings.json": "{}", ".delivered": "" } })), null);
  assert.equal(memoEligibility(runOf({ state: null, location: "archive" }))?.fail, "not_delivered");
});

test("a step re-run refused on a delivered report points at the memo, and only where a memo can be written", () => {
  const clearance = whatIfPlan({ run: runOf(), stage: "synthesis" });
  assert.match(clearance.reason, /no step of it re-runs; to ask what changes under an assumption, plan a memo instead: kind "memo", with the assumption in instructions/);
  const knockout = whatIfPlan({ run: runOf({ files: { "knockout-findings.json": "{}" } }), stage: "synthesis" });
  assert.equal(knockout.runnable, false);
  assert.doesNotMatch(knockout.reason, /memo/, "a refusal offers a memo the planner would then refuse");
});

test("the memo is handed the bands and the table the run froze, and design's line for a rule that is missing", () => {
  const run = runOf();
  writeFileSync(join(run.runDir, "_driver", "framework.json"), JSON.stringify({ bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] }));
  const table = { schema_version: 1, inputs: [{ label: "Similarity", values: ["close", "distant"] }], table: [{ band: "High", when: { Similarity: ["close"] } }] };
  writeFileSync(join(run.runDir, "_driver", "framework-method.json"), JSON.stringify(table));
  const framework = parentFramework(run.runDir);
  assert.deepEqual(framework, { bands: ["High", "Medium", "Low"], method: table });
  const message = composeMemoMessage({ assumption: ASSUMPTION, findings: {}, ratedUnder: "invented-profile", framework, replyPath: "/r/reply.json" });
  assert.ok(message.includes("Its bands, highest to lowest: High · Medium · Low."));
  assert.ok(message.includes(JSON.stringify(table, null, 2)), "the frozen rating table is not handed over");
  assert.ok(message.includes(MEMO_RULES_LINE), "the memo is not told what to do where a rule it needs is missing");
  assert.equal(MEMO_RULES_LINE, "Use the original report's findings and the rating rules supplied here. If a band change depends on a rule that is missing, keep the reported band and explain the limit.");
  assert.ok(message.includes("Write your reply to this ABSOLUTE path"), "the path line still opens on a dangling 'it'");
  assert.equal(parentFramework(runOf().runDir), null, "a run that froze no framework is handed one anyway");
  const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "whatif-memo", "SKILL.md"), "utf8").split("\n").join(" ").replace(/ +/g, " ");
  assert.match(manual, /its bands from highest to lowest, and its rating table where it has one/, "the memo's manual promises more of the framework than the worker hands over");
  assert.ok(manual.includes(MEMO_RULES_LINE), "the memo's manual and its message state the limit differently");
});
