// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MEMO IS OFFERED ONLY WHERE ONE CAN BE WRITTEN, AND IT IS GIVEN THE FRAMEWORK THE RUN FROZE (design, 2026-11-24).
//
// The planner called a memo on a delivered Knockout runnable, and the worker then refused it for want of the findings file
// it reads: the asker was promised a memo and got a refusal later (reproduced offline, 2026-11-24). A step re-run refused
// on a delivered report never mentioned the memo that was the answer. And the memo's manual promised the framework while
// the worker sent only a profile key. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { whatIfPlan, whatIfEnqueue } from "../../mcp-server/lib/whatif.mjs";
import { askArchivedRun, composeMemoMessage, parentFramework, MEMO_FAILS } from "../whatif-memo-run.mjs";
import { memoUnreadableReason } from "../whatif-queue.mjs";

const ASSUMPTION = "treat the earlier filing as abandoned";
function delivered({ knockout = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "memo-offered-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, knockout ? "knockout-findings.json" : "findings.json"), JSON.stringify({ findings: [] }));
  return { runId: "quillmere-2026-11-24-fen", runDir: dir, location: "archive", state: "delivered", P: {}, status: {} };
}

test("a memo on a delivered clearance plans; on a delivered Knockout it is refused at the plan, in the worker's terms", async () => {
  assert.equal(whatIfPlan({ run: delivered(), kind: "memo", instructions: ASSUMPTION }).runnable, true);
  const knockout = delivered({ knockout: true });
  const plan = whatIfPlan({ run: knockout, kind: "memo", instructions: ASSUMPTION });
  assert.equal(plan.runnable, false, "a memo the worker cannot write is still offered as runnable");
  assert.equal(plan.reason, `Run ${knockout.runId}: ${memoUnreadableReason(knockout.runDir)}.`);
  // A token minted before the plan refused is refused at the queue too, not left for the worker.
  const token = Buffer.from(JSON.stringify({ runId: knockout.runId, kind: "memo", instructions: ASSUMPTION })).toString("base64url");
  await assert.rejects(whatIfEnqueue({ run: knockout, confirmationToken: token }, { enqueueWhatIf: () => assert.fail("queued a memo the worker refuses") }),
    /no memo can be written for it/);
  const worker = await askArchivedRun({ runId: knockout.runId, question: ASSUMPTION }, { resolveRun: () => knockout, reason: async () => assert.fail("reasoned over nothing") });
  assert.equal(worker.fail, MEMO_FAILS.NO_EVIDENCE, "the worker and the planner disagree about which runs a memo can read");
});

test("a step re-run refused on a delivered report points at the memo, and only where a memo can be written", () => {
  const clearance = whatIfPlan({ run: delivered(), stage: "synthesis" });
  assert.match(clearance.reason, /no step of it re-runs; to ask what changes under an assumption, plan a memo instead: kind "memo", with the assumption in instructions/);
  const knockout = whatIfPlan({ run: delivered({ knockout: true }), stage: "synthesis" });
  assert.equal(knockout.runnable, false);
  assert.doesNotMatch(knockout.reason, /memo/, "a refusal offers a memo the planner would then refuse");
});

test("the memo is handed the bands and the table the run froze, and told the framework's text is not among them", () => {
  const run = delivered();
  writeFileSync(join(run.runDir, "_driver", "framework.json"), JSON.stringify({ bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] }));
  const table = { schema_version: 1, inputs: [{ label: "Similarity", values: ["close", "distant"] }], table: [{ band: "High", when: { Similarity: ["close"] } }] };
  writeFileSync(join(run.runDir, "_driver", "framework-method.json"), JSON.stringify(table));
  const framework = parentFramework(run.runDir);
  assert.deepEqual(framework, { bands: ["High", "Medium", "Low"], method: table });
  const message = composeMemoMessage({ assumption: ASSUMPTION, findings: {}, ratedUnder: "invented-profile", framework, replyPath: "/r/reply.json" });
  assert.ok(message.includes("Its bands, highest to lowest: High · Medium · Low."));
  assert.ok(message.includes(JSON.stringify(table, null, 2)), "the frozen rating table is not handed over");
  assert.ok(message.includes("The framework's full text is not given to you. Where the answer turns on how it defines a band, say so in the body."));
  assert.ok(message.includes("Write your reply to this ABSOLUTE path"), "the path line still opens on a dangling 'it'");
  assert.equal(parentFramework(delivered().runDir), null, "a run that froze no framework is handed one anyway");
  const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "whatif-memo", "SKILL.md"), "utf8");
  assert.match(manual.split("\n").join(" ").replace(/ +/g, " "), /its bands from highest to lowest, and its rating table where it has one/,
    "the memo's manual promises more of the framework than the worker hands over");
});
