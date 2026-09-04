// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner across the whole postpone lifecycle
// B1 identity handoff across the POSTPONE lifecycle (review fix). Two crash windows used to leave NO
// durable copy of a resumable run's codename — a SIGKILL inside either meant the next activation's
// legacy fresh re-claim minted a NEW codename over the run (re-buying every completed billable stage),
// while a surviving run-dir `.postponed` sentinel could self-resume the OLD codename in parallel (two
// runs of one matter, two deliveries):
//   (a) claimDuePostponed rm'd `.postponed.meta` at claim, but the codename only re-landed in
//       `.processing.meta` later, at dispatch inside runPrepared;
//   (b) runPrepared's postpone branch renamed to `.postponed` and cleaned `.processing.meta` BEFORE
//       writing `.postponed.meta`.
// The fix is ordering: persist the NEW durable copy before removing the old one. Every fs op involved
// is atomic under SIGKILL, so the crash-window simulation is op-level fault injection — make a LATER op
// fail and assert the EARLIER op's effect is already durable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimDuePostponed, parkPostponed, claimToken } from "../runner.mjs";

const MANIFEST = JSON.stringify({
  id: "pp-1", msgId: "<pp-1@x>", forwarder: "lawyer-a", forwarderDomain: "example.com",
  ref: "TMP9401", markName: "POSTPONE PROBE", classes: [9], provider: "corsearch",
});
const PAST = new Date(Date.now() - 3600000).toISOString();

test("claimDuePostponed persists the codename to .processing.meta AT CLAIM, before dropping .postponed.meta", () => {
  const Q = mkdtempSync(join(tmpdir(), "pp-claim-"));
  writeFileSync(join(Q, "job-p.postponed"), MANIFEST);
  writeFileSync(join(Q, "job-p.postponed.meta"), JSON.stringify({
    codename: "teal-otter", dateISO: "2026-07-10", resetsAt: PAST, fromStage: "register-unit:corsearch",
    agentId: "clawdi", postponedAt: PAST,
  }));

  const out = claimDuePostponed(Q);
  assert.equal(out.length, 1);
  assert.equal(out[0].meta.codename, "teal-otter", "the resume meta carries the codename");

  const proc = join(Q, "job-p.processing");
  assert.ok(existsSync(proc), "claimed to .processing");
  assert.equal(readFileSync(`${proc}.pid`, "utf8"), claimToken(), "claim token stamped");
  // THE invariant: the identity is durable the moment the claim exists — a SIGKILL anywhere between
  // this claim and runPrepared's dispatch re-persist must still find the codename on disk. The old
  // code wrote nothing here (it only rm'd .postponed.meta), so this assert catches the regression.
  const meta = JSON.parse(readFileSync(`${proc}.meta`, "utf8"));
  assert.deepEqual(meta, { codename: "teal-otter", dateISO: "2026-07-10", agentId: "clawdi" },
    "identity handed off to .processing.meta at claim time");
  assert.ok(!existsSync(join(Q, "job-p.postponed.meta")), "the postponed copy is dropped only after the handoff");
  assert.equal(readdirSync(Q).filter((f) => f.endsWith(".tmp")).length, 0, "atomic write left no tmp residue");
});

test("claimDuePostponed on a LEGACY bare .postponed (no meta) fail-opens with no bogus identity", () => {
  const Q = mkdtempSync(join(tmpdir(), "pp-legacy-"));
  writeFileSync(join(Q, "job-l.postponed"), MANIFEST);
  const out = claimDuePostponed(Q);
  assert.equal(out.length, 1, "fail-open: a meta hiccup never strands a parked run");
  assert.ok(existsSync(join(Q, "job-l.processing")));
  assert.ok(!existsSync(join(Q, "job-l.processing.meta")),
    "no codename to hand off → no meta (dispatch mints fresh and persists it there)");
});

test("parkPostponed: identity lands in .postponed.meta BEFORE the marker rename (crash-window ordering probe)", () => {
  const Q = mkdtempSync(join(tmpdir(), "pp-order-"));
  // Fault-inject the SECOND op: the marker is absent, so the rename to .postponed throws. Under the
  // fixed order the meta is ALREADY durable; under the old order (rename → cleanup → meta write) the
  // throw happened first and the codename evaporated with the cleaned .processing.meta.
  const proc = join(Q, "job-x.processing");   // never created — renameSync(proc, …) will ENOENT
  assert.throws(() => parkPostponed(proc, Q, "job-x", {
    resetsAt: null, codename: "amber-lynx", dateISO: "2026-07-11", fromStage: "report", agentId: "clawdi", postponedAt: PAST,
  }), "the marker rename fails (the injected crash point)");
  const meta = JSON.parse(readFileSync(join(Q, "job-x.postponed.meta"), "utf8"));
  assert.equal(meta.codename, "amber-lynx", "the identity was already durable when the crash hit");
});

test("parkPostponed happy path: postponed marker + meta present, claim sidecars swept, no tmp residue", () => {
  const Q = mkdtempSync(join(tmpdir(), "pp-park-"));
  const proc = join(Q, "job-y.processing");
  writeFileSync(proc, MANIFEST);
  writeFileSync(`${proc}.pid`, claimToken());
  writeFileSync(`${proc}.meta`, JSON.stringify({ codename: "amber-lynx", dateISO: "2026-07-11", agentId: "clawdi" }));
  writeFileSync(`${proc}.skips`, "2\n");

  parkPostponed(proc, Q, "job-y", {
    resetsAt: PAST, codename: "amber-lynx", dateISO: "2026-07-11", fromStage: "report", agentId: "clawdi", postponedAt: PAST,
  });
  assert.ok(existsSync(join(Q, "job-y.postponed")), "parked");
  const meta = JSON.parse(readFileSync(join(Q, "job-y.postponed.meta"), "utf8"));
  assert.equal(meta.codename, "amber-lynx");
  assert.equal(meta.dateISO, "2026-07-11", "the postponed meta now carries dateISO for the archive lookup");
  for (const s of [".pid", ".meta", ".skips"]) assert.ok(!existsSync(`${proc}${s}`), `claim sidecar ${s} swept`);
  assert.ok(!existsSync(proc), "the .processing marker is gone");
  assert.equal(readdirSync(Q).filter((f) => f.endsWith(".tmp")).length, 0, "atomic write left no tmp residue");
});
