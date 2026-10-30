// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-resumed-run-keeps-the-order-it-was-accepted-on.test.mjs — a run keeps its order whole from intake, and a resume or a
// stage replay given no job file runs on that order: its routing, its stated facts and each mark's own entry.
//
// THE DEFECT. A job rebuilt from status.json carried the run's identity, the marks by name, the goods, the applicant,
// the territories, the account and the product, and nothing else of the order. A run that failed before delivering
// kept its forwarder address and its message id nowhere, so a repaired run's packet named neither. The stated use, the
// campaign facts and the requester's instructions survived only inside rendered text, so a replayed stage lost them.
// Measured 2026-10-30 over 313 saved test runs: 44 kept no forwarder address and 61 no message id.
//
// Every name, address, account and message here is invented.
//
// Run:  node --test driver/test/a-resumed-run-keeps-the-order-it-was-accepted-on.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACCEPTED_ORDER_FILE, ORDER_AMENDMENTS_FILE, ORDER_RECOVERY_FILE, ORDER_ONLY_FIELDS, orderSnapshot, retainAcceptedOrder,
  readAcceptedOrder, rebuildRunOrder } from "../accepted-order.mjs";
import { jobFromStatus, instructedScopeOf, resumeJobRefusal, buildFailurePacket } from "../pipeline.mjs";
import { STAGES, paths } from "../stages.mjs";
import { deriveSlug } from "../phase0.mjs";

const ORDER = {
  id: "job-1248", ref: "INV-1248", markName: "QUILLMERE", classes: [9, 42],
  marks: [{ name: "QUILLMERE", ref: "INV-1248-A", classes: [9] }, { name: "QUILLMERE NOVA", ref: "INV-1248-B", classes: [42] }],
  forwarder: "invented-forwarder", forwarderEmail: "requester@invented.example", msgId: "<msg-1248@invented.example>",
  conversationId: "conv-1248", clientPrincipal: true,
  goods: "planning software for invented gardens", customer: "Invented Holdings", jurisdictions: ["US", "EU"],
  geography: { mode: "named", origin: "request" }, profileKey: "invented-account", projectKey: "invented-project",
  priorUse: "Sold online in the US since 2024 under the invented name.",
  campaignShape: "A house-brand attachment for a two-year launch.",
  upfrontInstructions: "Leave the incumbent's own filings out of the summary.",
};
/** What seedRunStatus keeps of a job: its identity. */
const statusOf = (job) => ({ id: job.id, ref: job.ref, markName: job.markName, classes: job.classes, forwarder: job.forwarder });
const PROFILE = { profileKey: "invented-account", name: "Invented Holdings", projectKey: "invented-project" };

/** A run interrupted before delivery: its status, instructed scope and frozen profile on disk, and an empty queue. */
function aRun(t, { keepOrder = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "accepted-order-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, "studio", deriveSlug(ORDER), "run-1"), queueDir = join(root, "queue");
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  mkdirSync(queueDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify(statusOf(ORDER)));
  writeFileSync(join(runDir, "_driver", "instructed-scope.json"), JSON.stringify(instructedScopeOf(ORDER)));
  writeFileSync(join(runDir, "_driver", "profile.json"), JSON.stringify(PROFILE));
  // Intake keeps the order as it arrived; the run then changes its own job, as folding a saved search's scope does.
  const job = structuredClone(ORDER);
  const accepted = orderSnapshot(job);
  job.jurisdictions = ["US", "EU", "GB"];
  if (keepOrder) assert.equal(retainAcceptedOrder(runDir, accepted), "written");
  return { runDir, queueDir };
}
const rebuild = ({ runDir, queueDir }) => rebuildRunOrder({ runDir, queueDir, status: statusOf(ORDER),
  scope: instructedScopeOf(ORDER), profile: PROFILE, scopeOf: instructedScopeOf,
  fromStatus: () => jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER), { profile: PROFILE }) });
const recovery = (runDir) => JSON.parse(readFileSync(join(runDir, "_driver", ORDER_RECOVERY_FILE), "utf8"));

const frame = (job) => String(STAGES["matter-frame"].message({ paths: { inboundRequest: "/dev/null" }, job, customerUnknown: true, profile: {}, exclusionSeed: [] }));
const blind = (job, runDir) => String(STAGES["blind-frame"].message({ paths: paths(runDir), job }));
const packet = (job) => buildFailurePacket({ runId: "run-1", agent: "invented-agent", job, failedStage: "synthesis",
  shortReason: "the writer stopped", reasonVerbatim: "invented failure", sig: "invented", failClass: "transient", terminalKind: "failed" });

test("a resume with its queue entry gone runs on the order as accepted: its marks, stated facts and routing", (t) => {
  const run = aRun(t);
  const { job, source, unrecovered } = rebuild(run);
  assert.equal(source, "accepted-order");
  assert.deepEqual(unrecovered, []);
  assert.deepEqual(job, ORDER, "the resumed job is not the order the run was accepted on");
  assert.equal(resumeJobRefusal(job, deriveSlug(ORDER)), null);

  // The stage instructions carry the stated facts and each mark's own entry, as on the run's first pass.
  const msg = frame(job);
  for (const fact of [ORDER.priorUse, ORDER.campaignShape, ORDER.upfrontInstructions]) assert.ok(msg.includes(fact), `the frame lost: ${fact}`);
  assert.ok(blind(job, run.runDir).includes(`Mark(s): ${JSON.stringify(ORDER.marks)}`), "the blind frame's marks are not the order's entries");
  // The packet names whom the order came from and which message it answers, without sending anything.
  const p = packet(job);
  assert.deepEqual([p.forwarderEmail, p.msgId, p.conversationId], [ORDER.forwarderEmail, ORDER.msgId, ORDER.conversationId]);

  // What status alone gives, for the contrast this closes.
  const fromStatus = jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER), { profile: PROFILE });
  assert.ok(!frame(fromStatus).includes(ORDER.priorUse));
  assert.equal(packet(fromStatus).forwarderEmail, undefined);
});

test("the order is written once: a later job, a rebuilt one included, never replaces it, and an explicit one is kept beside it", (t) => {
  const { runDir } = aRun(t);
  const rebuilt = jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER), { profile: PROFILE });
  assert.equal(retainAcceptedOrder(runDir, rebuilt, { rebuilt: true }), "kept");
  assert.equal(retainAcceptedOrder(runDir, { ...ORDER, priorUse: "changed" }), "kept", "a job not given explicitly became an amendment");
  const amended = { ...ORDER, upfrontInstructions: "Include the incumbent's filings after all." };
  assert.equal(retainAcceptedOrder(runDir, amended, { explicit: true }), "amended");
  assert.equal(retainAcceptedOrder(runDir, amended, { explicit: true }), "kept", "the same amendment was kept twice");
  assert.deepEqual(readAcceptedOrder(runDir), ORDER, "the original order was replaced");
  const lines = readFileSync(join(runDir, "_driver", ORDER_AMENDMENTS_FILE), "utf8").split("\n").filter(Boolean);
  assert.deepEqual(lines.map((l) => JSON.parse(l).order), [amended]);
  // A run whose order is not on file never keeps a rebuilt job as its order.
  const bare = aRun(t, { keepOrder: false });
  assert.equal(retainAcceptedOrder(bare.runDir, rebuilt, { rebuilt: true }), "not-kept");
  assert.equal(existsSync(join(bare.runDir, "_driver", ACCEPTED_ORDER_FILE)), false);
});

test("an older run takes its order from its own retained queue entry, and keeps it from then on", (t) => {
  const run = aRun(t, { keepOrder: false });
  writeFileSync(join(run.queueDir, `${ORDER.id}.failed`), JSON.stringify(ORDER));
  const first = rebuild(run);
  assert.equal(first.source, "queue-order");
  assert.deepEqual(first.job, ORDER);
  assert.deepEqual(readAcceptedOrder(run.runDir), ORDER, "the queue entry was not kept as the run's order");
  rmSync(join(run.queueDir, `${ORDER.id}.failed`));
  const again = rebuild(run);
  assert.equal(again.source, "accepted-order", "the run still depends on its queue entry");
  assert.deepEqual(again.job, ORDER);
});

test("a queue entry that disagrees with the run is refused whole, and the run says what it could not recover", (t) => {
  for (const [other, why] of [
    [{ ...ORDER, marks: [{ name: "ANOTHER MARK", ref: "X", classes: [9] }] }, /marks/],
    [{ ...ORDER, jurisdictions: ["JP"] }, /jurisdictions/],
    [{ ...ORDER, profileKey: "another-account" }, /account/],
  ]) {
    const run = aRun(t, { keepOrder: false });
    writeFileSync(join(run.queueDir, `${ORDER.id}.done`), JSON.stringify(other));
    const out = rebuild(run);
    assert.equal(out.source, "status");
    assert.match(out.conflict, why);
    assert.deepEqual(out.unrecovered, [...ORDER_ONLY_FIELDS]);
    assert.equal(out.job.forwarderEmail, undefined, "a field was taken from the refused entry");
    assert.equal(readAcceptedOrder(run.runDir), null, "a refused entry was kept as the run's order");
  }
  // A file under the order's name that holds another order is no match.
  const run = aRun(t, { keepOrder: false });
  writeFileSync(join(run.queueDir, `${ORDER.id}.done`), JSON.stringify({ ...ORDER, id: "job-other" }));
  assert.equal(rebuild(run).source, "status");
});

test("with no order anywhere, nothing is invented: no address, no message, and the replay is not called faithful", (t) => {
  const run = aRun(t, { keepOrder: false });
  const out = rebuild(run);
  assert.equal(out.source, "status");
  assert.equal(out.conflict, null);
  for (const k of ["forwarderEmail", "msgId", "conversationId", "clientPrincipal", "priorUse", "campaignShape", "upfrontInstructions"])
    assert.equal(out.job[k], undefined, `${k} was filled in`);
  const p = packet(out.job);
  assert.equal(p.forwarderEmail, undefined, "the packet names an address the order never gave");
  assert.equal(p.msgId, undefined);
  // What the status rebuild can still read from the frozen profile: the project the order named.
  assert.equal(out.job.projectKey, ORDER.projectKey);
  const rec = recovery(run.runDir);
  assert.deepEqual([rec.source, rec.faithful, rec.unrecovered], ["status", false, [...ORDER_ONLY_FIELDS]]);
  const text = readFileSync(join(run.runDir, "_driver", ORDER_RECOVERY_FILE), "utf8");
  for (const v of [ORDER.forwarderEmail, ORDER.msgId, ORDER.customer]) assert.ok(!text.includes(v), "the recovery record holds a value");
  // A whole order is a faithful one.
  const whole = aRun(t);
  rebuild(whole);
  assert.equal(recovery(whole.runDir).faithful, true);
});

test("a Generic run's organisation comes back from its frozen profile", () => {
  const job = jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER), { profile: { profileKey: "generic", organisation: "invented-org" } });
  assert.equal(job.tenant, "invented-org");
  assert.equal(jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER), { profile: { profileKey: "invented-account", organisation: "invented-org" } }).tenant, undefined);
});

test("a stage replay reads the run's order and writes nothing into the run it studies", (t) => {
  const run = aRun(t, { keepOrder: false });
  writeFileSync(join(run.queueDir, `${ORDER.id}.done`), JSON.stringify(ORDER));
  const out = rebuildRunOrder({ ...run, status: statusOf(ORDER), scope: instructedScopeOf(ORDER), profile: PROFILE, scopeOf: instructedScopeOf,
    fromStatus: () => assert.fail("the queue entry was not used"), write: false });
  assert.equal(out.source, "queue-order");
  assert.deepEqual(out.job, ORDER);
  for (const f of [ACCEPTED_ORDER_FILE, ORDER_RECOVERY_FILE]) assert.equal(existsSync(join(run.runDir, "_driver", f)), false, `the replay wrote ${f}`);
});
