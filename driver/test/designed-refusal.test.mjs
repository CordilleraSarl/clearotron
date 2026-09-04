// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// designed-refusal.test.mjs —. A REFUSAL THE PRODUCT IS DESIGNED TO MAKE IS NOT AN ENGINE FAILURE.
//
// The defect: `countPreflight` refuses an order this deployment cannot serve BEFORE any model spend —
// which is / working exactly as specified — and the record it left said `state=failed`,
// `failedStage=knockout-register-count`, with nothing anywhere saying the engine had not broken. The
// same answer given one layer earlier is `clarify` at the door: no run dir, no failure marker. Correct
// product behaviour was landing in the failure channel, so failure counts stopped meaning anything.
//
// The owner ruling (2026-08-13): such a refusal must be distinguishable from a failure IN EVERY SINK IT
// REACHES, must never feed failure statistics, and must never trigger recovery machinery.
//
// This file drives the REAL knockout terminal — the throw, the catch, the four run-dir records and the
// returned result — rather than asserting the source text of the writer. 's sweep is explicit about
// why: `failure-text-not-engine-string.test.mjs` pins a regex over pipeline.mjs that "would pass
// unchanged if pipeline-knockout.mjs, runner.mjs and buildFailurePacket all dropped the field, which is
// exactly what they do". A writer test that cannot see the writer is the shape of that mistake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, pinEnvAll } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";   //

// driver.config.mjs READS THE ENVIRONMENT AT IMPORT, and the knockout terminal writes an outbox packet
// to `config.outboxDir`. Set the sandbox BEFORE the first import or this test posts a run-failed packet
// into a real outbox and still passes green.
const ROOT = mkdtempSync(join(tmpdir(), "designed-refusal-"));
// — every spelling, not one. The current name resolves FIRST, so assigning only the legacy
// spelling loses to whatever the operator's shell carries and the file has chosen nothing. Measured:
// under CLEAROTRON_DATABASE=corsearch this suite ran as corsearch — the vendor the operator asked for
// and the file did not — and stayed green while doing it.
pinEnvAll(process.env, { "CLEAROTRON_WORK_DIR": ROOT, "CLEAROTRON_REPORTS_DIR": join(ROOT, "pool") });
process.env.CLEAROTRON_AGENT = "clawdi";
// The tier a stranger runs, and the one both refusals in came from. `capabilitiesFor` reads it
// through REGISTER_PROVIDER, another import-time const.
pinEnv(process.env, "CLEAROTRON_DATABASE", "free-tier");
// The house triage framework must resolve to the repo's own copy. A CLEAROTRON_INSTRUCTIONS_DIR inherited from the
// shell would point the run at a config store this test has no business reading.
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);

const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { buildFailurePacket } = await import("../pipeline.mjs");
const { REFUSAL_TERMINAL_KIND } = await import("../repairs.mjs");
const { countPreflight } = await import("../register-count.mjs");
const { capabilitiesFor } = await import("../register-capabilities.mjs");
const { failureEventsForRun, aggregateFailureRecurrence, renderFailureRecurrence } = await import("../repair-digest.mjs");

// ── the run under test ──────────────────────────────────────────────────────────────────────────────

// One knockout run, refused at countPreflight. Every executor is INJECTED, so nothing dials a provider
// and no model turn is reachable — which is also the point of the refusal: it lands before either.
async function refusedRun({ jurisdictions = ["JP"], id = "cli-refusal" } = {}) {
  const studioRoot = join(ROOT, "studio", id);
  const runDir = join(studioRoot, "prelim-search", "runs", "wanderer", "2026-08-13-teal-gantry");
  mkdirSync(driverDir(runDir), { recursive: true });
  const run = { runDir, studioRoot, slug: "wanderer", date: "2026-08-13", codename: "teal-gantry",
    archiveDir: join(studioRoot, "archive", "2026-08-13-teal-gantry") };
  const job = { id, markName: "WANDERER", marks: [{ name: "WANDERER" }], classes: [9], jurisdictions,
    forwarder: "jordan", msgId: `<${id}@x>`, ref: "E2E-848" };
  const ctx = {
    run, job, agent: "clawdi", paths: { runDir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } },
  };
  const res = await knockoutInner(ctx, job, {
    // a $0 sweep and a $0 counter — neither is ever called, and injecting them proves it
    sweepExecutor: async () => ({ ok: true, text: "unused", bytes: 6 }),
    countExecutor: async () => ({ ok: true, total: 0 }),
  });
  return { res, runDir, studioRoot };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ── 1 · the record, in every sink the run dir has ───────────────────────────────────────────────────

test("#848 a designed refusal is recorded as a refusal in status.json, the .failed sentinel, run.jsonl and failure.json", async () => {
  const { res, runDir } = await refusedRun();
  assert.equal(res.ok, false);
  assert.equal(res.failedStage, "knockout-register-count", "the refusal is still terminal — it did not run");

  const status = readJson(join(runDir, "status.json"));
  assert.equal(status.state, "failed", "the STATE is unchanged: nothing was delivered, and every surface "
    + "switches on this closed vocabulary — a fifth state would make the run invisible, not honest");
  assert.equal(status.terminalKind, REFUSAL_TERMINAL_KIND, "and the kind says the engine did not break");

  const marker = readJson(join(runDir, ".failed"));
  assert.equal(marker.terminalKind, REFUSAL_TERMINAL_KIND, "the sentinel repair-digest falls back to");

  const rows = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const failedRow = rows.filter((r) => r.event === "failed").pop();
  assert.equal(failedRow.terminalKind, REFUSAL_TERMINAL_KIND, "the append-only spine");

  const packet = readJson(driverDir(runDir, "failure.json"));
  assert.equal(packet.terminalKind, REFUSAL_TERMINAL_KIND, "the terminal packet");
  assert.equal(packet.refused, true);
});

// THE SECOND WRITER. The run dir is not the only sink: runner.mjs's queue terminal stringifies this
// returned object into `<base>.failed.result`, and that sidecar is what scripts/e2e.mjs reads when it
// cannot resolve the run dir (`st?.terminalKind ?? result?.terminalKind`). The evidence on is a
// marker line — `marker: cli-….failed` — so this is the record the round actually read.
test("#848 the returned result carries the kind, so the queue marker's own record names the refusal", async () => {
  const { res } = await refusedRun({ id: "cli-refusal-return" });
  assert.equal(res.terminalKind, REFUSAL_TERMINAL_KIND);
  // and it survives the trip through the runner's writer, which is a plain JSON.stringify of `res`
  assert.equal(JSON.parse(JSON.stringify(res)).terminalKind, REFUSAL_TERMINAL_KIND);
});

// ── 2 · E11 — the reason reaches the sink instead of being computed and dropped ──────────────────────

// fixed this on the clearance terminal and its own issue records that the fix "does not reach the
// pre-spend refusal path". This is that path. The refusal's LAST sentence is the remedy, and the bare
// 200-char slice deleted all of it.
test("#848 · E11 the refusal's remedy reaches status.json — the 200-char cut is stated and the tail kept", async () => {
  const { runDir } = await refusedRun({ id: "cli-refusal-e11" });
  const status = readJson(join(runDir, "status.json"));

  assert.equal(status.reason.length, 200, "`reason` keeps its cap — it rides the ping");
  assert.equal(status.reasonTruncated, true, "the cut is STATED, never inferred from a missing key");
  assert.ok(status.reasonFull, "and the tail is kept beside it");
  assert.ok(status.reasonFull.length > status.reason.length);

  // The half the cut removed, named: what the operator is supposed to DO about it.
  const remedy = /Name a territory free-tier covers, or switch the register provider/;
  assert.doesNotMatch(status.reason, remedy, "this is the defect — the remedy does not survive 200 chars");
  assert.match(status.reasonFull, remedy, "and this is the fix — it survives to the field the taxonomy names");

  // failure.json's own carrier was already wide enough; assert it rather than assume it.
  const packet = readJson(driverDir(runDir, "failure.json"));
  assert.match(packet.reasonVerbatim, remedy, "the packet's verbatim reason carries the remedy too");
});

// The fixtures are the REAL refusal strings, not hand-written ones of a convenient length — and they
// are measured rather than assumed, because the interesting fact is WHICH arms outrun the cap. Three of
// the four do, and each of those three puts its remedy in the half that a bare slice(0,200) deletes. The
// fourth is 125 characters and survives whole: the fix must not report a cut on it (that is the reading
// was filed for, inverted), which is what the control at the bottom of this file pins.
test("#848 · E11 three of countPreflight's four refusals outrun the 200-char cap, and each loses its remedy", () => {
  const caps = capabilitiesFor("free-tier");
  const NO_US = [{ office: "US", memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] }];
  const cut = (s) => s.slice(0, 200);
  const overrun = {
    // E2E-821-JPONLY, one of the two refusals on
    "uncovered territory (#821)": [countPreflight({ capabilities: caps, jurisdictions: ["JP"] }),
      /Name a territory free-tier covers, or switch the register provider/],
    // E2E-790-USONLY — the other, and the one quotes: status.json ended on "There is no off"
    "unreachable register (#790)": [countPreflight({ capabilities: caps, jurisdictions: ["US"], unreachable: NO_US }),
      /Set the variable and re-run, order a search this deployment covers/],
    "provider cannot count": [countPreflight({ capabilities: caps, jurisdictions: ["EU"], hasAdapter: false }),
      /Run the plain "knockout" level, or switch the register provider/],
  };
  for (const [arm, [refusal, remedy]] of Object.entries(overrun)) {
    assert.ok(refusal, `${arm}: this arm must still refuse`);
    assert.ok(refusal.length > 200, `${arm}: ${refusal.length} chars`);
    assert.match(refusal, remedy, `${arm}: the remedy is in the refusal`);
    assert.doesNotMatch(cut(refusal), remedy, `${arm}: and a bare slice(0,200) is where it was lost`);
  }
  // The one that fits. Named, so nobody later "fixes" it into the list above.
  const credential = countPreflight({ capabilities: caps, jurisdictions: ["EU"], credentialPresent: false, missing: ["EUIPO_CLIENT_SECRET"] });
  assert.ok(credential.length <= 200, `the credential arm is ${credential.length} chars — it survives the cap whole`);
  assert.match(cut(credential), /Set it, or run the plain "knockout" level/);
});

// ── 3 · the notice an operator reads ────────────────────────────────────────────────────────────────

test("#848 the failure packet's copy says REFUSED, not FAILED, and never calls it a technical failure", () => {
  const base = { runId: "wanderer-2026-08-13-teal-gantry", agent: "clawdi", job: { markName: "WANDERER" },
    failedStage: "knockout-register-count", shortReason: "this run names one territory (JP), which free-tier does not cover",
    reasonVerbatim: "this run names one territory (JP), which free-tier does not cover, so there is no scope left to count in." };

  const refused = buildFailurePacket({ ...base, terminalKind: REFUSAL_TERMINAL_KIND });
  assert.equal(refused.refused, true);
  assert.match(refused.subject, /REFUSED/);
  assert.doesNotMatch(refused.subject, /FAILED/);
  assert.match(refused.whatsappText, /REFUSED at knockout-register-count/);
  assert.doesNotMatch(refused.whatsappText, /FAILED/);
  assert.match(refused.emailBodyHtml, /Nothing failed\./, "the kind sentence has to say nothing broke");
  assert.doesNotMatch(refused.emailBodyHtml, /technical failure/);
  assert.match(refused.emailBodyHtml, /before any work was done/);

  // CONTROL — an ordinary failure's copy is untouched, which is what makes the change a discriminator
  // rather than a rewording.
  const failed = buildFailurePacket({ ...base, terminalKind: "deterministic" });
  assert.equal(failed.refused, false, "written false, never omitted (#755's rule: absence must not be the signal)");
  assert.match(failed.subject, /run FAILED, nothing delivered/);
  assert.match(failed.whatsappText, /❌ Prelim search for WANDERER FAILED at knockout-register-count/);
  assert.match(failed.emailBodyHtml, /FAILED at stage/);

  // and a client-started refusal still gets the redacted copy — no machine reason to a client
  const client = buildFailurePacket({ ...base, job: { markName: "WANDERER", clientPrincipal: true }, terminalKind: REFUSAL_TERMINAL_KIND });
  assert.match(client.subject, /not started/);
  assert.doesNotMatch(client.emailBodyHtml, /free-tier/, "the verbatim machine reason stays off the client surface");
});

// ── 4 · it must never feed failure statistics ───────────────────────────────────────────────────────

const runRow = (runId, status) => ({ runId, state: status.state, status, runDir: null });

test("#848 the ops recurrence digest counts a designed refusal OUT of the defect groups — and says so", () => {
  const ts = "2026-08-13T10:00:00.000Z";
  const refusal = runRow("wanderer-2026-08-13-teal-gantry", {
    state: "failed", updatedAt: ts, failedStage: "knockout-register-count", terminalKind: REFUSAL_TERMINAL_KIND,
    reason: "this run names one territory (JP), which free-tier does not cover",
  });
  const breakage = runRow("teal-gantry-2026-08-13-copper-bastion", {
    state: "failed", updatedAt: ts, failedStage: "fan-in", terminalKind: "deterministic",
    reason: "collapsed named band — a clean can never ship over a collapsed slice",
  });

  const events = failureEventsForRun(refusal, { sinceMs: 0, readJson: () => null });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "refusal", "not a terminal event — a terminal event is what groups by signature");
  assert.equal(events[0].sig, null, "nothing recurred: two refusals are two orders, not one defect");

  const agg = aggregateFailureRecurrence({
    enumerate: () => [refusal, breakage], now: Date.parse(ts) + 1000, days: 7, readJson: () => null,
  });
  assert.equal(agg.refusals.count, 1);
  assert.deepEqual(agg.refusals.stages, ["knockout-register-count"]);
  assert.equal(agg.groups.length, 1, "only the real defect groups");
  assert.equal(agg.groups[0].stage, "fan-in");

  // AND IT IS NOT SILENT. "No refusals" and "refusals hidden" must not read the same — that is the same
  // absence-reads-as-a-pass mistake one layer up.
  const text = renderFailureRecurrence(agg);
  assert.match(text, /1 designed refusal in this window \(knockout-register-count\)/);
  assert.match(text, /Not a defect class, not counted below/);
  assert.match(text, /runs: wanderer-2026-08-13-teal-gantry/, "and WHICH run — a count with no name is unactionable");

  // CONTROL — with no refusals in the window the digest says nothing about them, and the defect still
  // reports exactly as it did.
  const only = aggregateFailureRecurrence({ enumerate: () => [breakage], now: Date.parse(ts) + 1000, days: 7, readJson: () => null });
  assert.equal(only.refusals.count, 0);
  assert.doesNotMatch(renderFailureRecurrence(only), /designed refusal/);
  assert.equal(only.groups.length, 1);
});

// A REFUSAL MUST NOT BE INFERRED FROM A FILE THAT MIGHT NOT BE THERE. The `.failed` sentinel carries the
// kind too, and reading it here would mean an unreadable sentinel silently re-admits a refusal to the
// statistics — the zero taking the failure path.
test("#848 the digest reads the kind off status.json, so an unreadable sentinel cannot re-admit a refusal", () => {
  const row = runRow("wanderer-2026-08-13-teal-gantry", {
    state: "failed", updatedAt: "2026-08-13T10:00:00.000Z", failedStage: "knockout-register-count",
    terminalKind: REFUSAL_TERMINAL_KIND, reason: "JP is not covered",
  });
  row.runDir = "/nonexistent/run/dir";   // every sidecar read returns null
  const events = failureEventsForRun(row, { sinceMs: 0, readJson: () => null });
  assert.equal(events[0].kind, "refusal");
});

// ── 5 · it must never trigger recovery machinery ────────────────────────────────────────────────────

// The knockout lane has no recovery ladder at all (module header: "no auto-recovery ladder — a knockout
// re-run is ~$2"). That is the ruling's second half satisfied by construction rather than by a branch,
// and this pins it as an observed fact about the refusal rather than a claim about the code.
test("#848 a designed refusal parks nothing — no .postponed, no recovery history, no resume clock", async () => {
  const { runDir } = await refusedRun({ id: "cli-refusal-park" });
  assert.equal(existsSync(join(runDir, ".postponed")), false, "a refusal is terminal on sight");
  const status = readJson(join(runDir, "status.json"));
  assert.equal(status.recoveryHistory, undefined, "no park was ever charged");
  assert.equal(status.recoveryAttempts, undefined);
  assert.equal(status.recoveryResumesAt, undefined);
  assert.equal(status.resetsAt, undefined);
});

// ── 6 · the control: an ordinary knockout failure is unchanged ──────────────────────────────────────

// Everything above would also be satisfied by stamping every knockout terminal as a refusal. This is the
// assertion that says the discriminator discriminates.
test("#848 an ordinary knockout failure carries terminalKind null and reads exactly as it did", async () => {
  const studioRoot = join(ROOT, "studio", "cli-plain-failure");
  const runDir = join(studioRoot, "prelim-search", "runs", "wanderer", "2026-08-13-copper-bastion");
  mkdirSync(driverDir(runDir), { recursive: true });
  const run = { runDir, studioRoot, slug: "wanderer", date: "2026-08-13", codename: "copper-bastion",
    archiveDir: join(studioRoot, "archive", "2026-08-13-copper-bastion") };
  // Two marks whose research keys collide — the `knockout-scope` throw, which is NOT a countPreflight
  // refusal and carries no stamp.
  const job = { id: "cli-plain-failure", marks: [{ name: "WANDERER" }, { name: "wanderer!" }], classes: [9],
    jurisdictions: ["EU"], forwarder: "jordan", msgId: "<plain@x>" };
  const ctx = { run, job, agent: "clawdi", paths: { runDir }, profile: {},
    searchPolicy: { level: "knockout", stageLabel: "Knockout", components: {} } };
  const res = await knockoutInner(ctx, job, { sweepExecutor: async () => ({ ok: true, text: "u", bytes: 1 }) });

  assert.equal(res.ok, false);
  assert.equal(res.failedStage, "knockout-scope");
  assert.equal(res.terminalKind, null, "an ordinary failure carries no kind on this lane — unchanged");
  const status = readJson(join(runDir, "status.json"));
  assert.equal(status.state, "failed");
  assert.equal(status.terminalKind, null);
  const packet = readJson(driverDir(runDir, "failure.json"));
  assert.equal(packet.refused, false);
  assert.match(packet.whatsappText, /FAILED at knockout-scope/);
  // 's fields land here too, and on a SHORT reason the answer is "nothing was cut" — never a missing key
  assert.equal(status.reasonTruncated, false);
  assert.equal(status.reasonFull, null);
});

// Nothing above may have written outside the sandbox. `config.outboxDir` is derived from
// CLEAROTRON_WORK_DIR at import; if the ordering at the top of this file ever breaks, the packets land
// somewhere real and every assertion above still passes.
test("#848 the harness stayed inside its sandbox — the outbox packets are under the temp root", () => {
  const outbox = join(ROOT, "prelim-outbox");
  assert.ok(existsSync(outbox), "the refusals' notices went somewhere, and it was here");
  const packets = readdirSync(outbox).filter((n) => n.endsWith(".pending"));
  assert.ok(packets.length > 0, "an absent packet would mean the notice went to a real outbox, not that none was sent");
});
