// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner's matter-level dedup path end to end
// Matter-level dedup gate (the VELTRIPHEN "please proceed" double-enqueue, 2026-06-16). The queue dedups on
// the per-MESSAGE id, so a reply that re-runs intake on an already-handled thread enqueues the SAME matter
// under a new id — a second ~$40 search. This gate keys on the MATTER (forwarder+mark+classes+customer) via a
// tiny ledger and PARKS the duplicate (recoverable) instead of running it. Env is set BEFORE the (dynamic)
// runner import so driver.config captures this test's workspace root, and DEDUP_WINDOW_MS reads the default.
//
// The THREAD (conversationId) dimension additionally REQUIRES the mark to agree (2026-07-03): several
// distinct marks forwarded in ONE email share a conversationId but are SEPARATE matters and must all run;
// only a SAME-mark reply whose classes/customer drifted still dedups by thread. `dupOverride: true` is the
// explicit force-run past the gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, readdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
import { requiresTheSuiteRunner, refuseOnPreRunFailure } from "./precondition-refusal.mjs";
// — FIRST, before any env default below: those defaults make this file look
// runnable while the environment it actually needs is still absent.
requiresTheSuiteRunner("runner.dedup.test.mjs");

process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const root = mkdtempSync(join(tmpdir(), "prelim-dedup-"));
const callLog = join(root, "calls.jsonl");
for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  MOCK_CALL_LOG: callLog, CORSEARCH_SESSION_KEY: "test-offline",
})) pinEnv(process.env, k, v);

// ── THE CORPUS'S OWN REAL-CLIENT STAND-IN ──────────────────────────────────────
//
// The bundled roster's invented companies now carry `demoData: true`, and the runner's admission wall
// refuses a real clearance under one. This test STARTS RUNS, so it needs accounts that are not fiction.
//
// It plants its own store rather than any of the alternatives, and each alternative is worth naming:
//   - point the job at `generic`: `generic` IS the house default, and the profileKey tag exists
//     precisely so the job does NOT run on the house default scale. That silently narrows what this
//     test covers while leaving its name and comment intact.
//   - ship a fifth unmarked profile: an unmarked fiction account is exactly what 2012 forbids — fiction
//     the wall will not refuse, sitting in the roster inviting a real clearance.
//   - stop marking the fixtures: that is criterion 3, the half that closes the silent-fallback incident.
//
// COPY THE WHOLE ROSTER, NOT ONLY THE ACCOUNT THIS TEST NAMES. Measured: an overlay store holding two
// profiles REPLACES the roster rather than merging with the bundled four, so a partial copy silently
// removes the other accounts and the test then fails for a reason unrelated to the marker.
const customersDir = join(root, "customers");
mkdirSync(customersDir, { recursive: true });
cpSync(join(HERE, "..", "profiles"), customersDir, { recursive: true });
const copied = readdirSync(customersDir).filter((n) => n.endsWith(".json"));
// ASSERTED, NOT ASSUMED. An empty or partial copy strips nothing, and this test would then run against
// the MARKED roster — which is the exact state the store exists to avoid, reached silently. 's
// guard caught this loop for precisely that reason.
assert.ok(copied.length >= 2,
  `the stand-in store copied ${copied.length} profile(s) — it must hold the whole roster, or the account `
  + "this test names resolves to a marked record and the wall refuses the run");
let stripped = 0;
for (const f of copied) {
  const q = join(customersDir, f);
  const o = JSON.parse(readFileSync(q, "utf8"));
  if (o.demoData !== undefined) stripped++;
  delete o.demoData;   // the one difference, and the reason this directory exists
  writeFileSync(q, JSON.stringify(o, null, 2) + "\n");
}
assert.ok(stripped > 0,
  "no profile in the copied roster carried demoData, so this store is identical to the bundled one and "
  + "proves nothing. Either the marker moved or the copy did not reach the roster.");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", customersDir);

// Dynamic import AFTER env is set (driver.config captures workspaceRoot at module load).
const { main, matterSignature, findDuplicateMatter, recordMatter, dropMatter } = await import("../runner.mjs");

function enqueue(q, base, { msgId, mark, classes, customer, profileKey, forwarder = "sam", conversationId, dupOverride }) {
  writeFileSync(join(q, `${base}.markName.md`), mark + "\n");           // prose sidecar
  writeFileSync(join(q, `${base}.json`), JSON.stringify({              // scalar manifest (undefined convId is dropped)
    id: base, msgId, conversationId, forwarder, forwarderDomain: "example.com", provider: "corsearch", classes, customer,
    ...(profileKey ? { profileKey } : {}),
    ...(dupOverride ? { dupOverride: true } : {}),
  }));
}

test("matterSignature normalizes casing / spacing / class-order; different mark ⇒ different sig", () => {
  const a = matterSignature({ forwarder: "sam", markName: "VELTRIPHEN", classes: [1, 5, 42, 44], customer: "Petcary" });
  const b = matterSignature({ forwarder: "Sam", markName: " veltriphen ", classes: [44, 5, 1, 42], customer: "petcary" });
  assert.equal(a, b, "casing/spacing/class-order drift between an original and its reply must collide");
  const c = matterSignature({ forwarder: "sam", markName: "AURALITH", classes: [1, 5, 42, 44], customer: "Petcary" });
  assert.notEqual(a, c, "a different mark is a different matter");
});

// PINNED, byte for byte, because a signature is a STORED key: every ledger row written before a change to
// this composition stops matching after it, and dedup then silently stops firing for matters already in
// flight — no error, no marker, just a second ~$40 search. The literals below say what a production
// matter's signature IS: forwarder|mark|classes|customer|ref, each lowercased and whitespace-collapsed,
// classes deduped and sorted numerically, plus a |level:<lvl> suffix when the resolved level is neither
// empty nor "prelim", and with mark becoming the sorted deduped mark SET for a multi-mark knockout batch.
//
// Added by, whose fix makes a TEST scenario's signature unique per round by suffixing a token onto
// the harness's own REFS (scripts/e2e.mjs refForRun). That is harness-side by construction — runner.mjs is
// not edited — and this test is the wall that keeps it that way: a later attempt to solve a test-only
// problem inside matterSignature fails here, loudly, instead of quietly changing how real matters are
// identified.
test("the production matter signature composition is PINNED", () => {
  assert.equal(matterSignature({ forwarder: "Sam", markName: " Veltriphen ", classes: [44, 5, 1, 42], customer: "Petcary" }),
    "sam|veltriphen|1,5,42,44|petcary|", "refless, no level — the pre-spine string every legacy ledger row carries");
  assert.equal(matterSignature({ forwarder: "Sam", markName: " Veltriphen ", classes: [44, 5, 1, 42], customer: "Petcary", ref: "TMP-2201" }),
    "sam|veltriphen|1,5,42,44|petcary|tmp-2201", "the ref is the last field, lowercased");
  assert.equal(matterSignature({ forwarder: "sam", markName: "VELTRIPHEN", classes: [9], customer: "Petcary", ref: "TMP-2201" }, { product: "global-preliminary-search" }),
    "sam|veltriphen|9|petcary|tmp-2201", "an explicit prelim adds NOTHING — it still collides with a legacy no-field job");
  assert.equal(matterSignature({ forwarder: "sam", markName: "VELTRIPHEN", classes: [9], customer: "Petcary", ref: "TMP-2201" }, { product: "knockout-search" }),
    "sam|veltriphen|9|petcary|tmp-2201|level:knockout-search", "any other resolved level is a signature dimension, so an escalation never dedups");
  assert.equal(matterSignature({ forwarder: "sam", marks: [{ name: "ZED" }, { name: "ALPHA" }], classes: [9], customer: "Acme", ref: "TMP-9" }, { product: "knockout-search" }),
    "sam|alpha + zed|9|acme|tmp-9|level:knockout-search", "a knockout BATCH keys on the sorted mark set, so a reordered re-send still collides");
});

test("ledger: reply dedups; same-msgId/different-matter/stale do NOT; a failed run's drop unblocks a re-send", () => {
  const q = join(mkdtempSync(join(tmpdir(), "ledger-")), "queue");
  mkdirSync(q, { recursive: true });
  const sig = matterSignature({ forwarder: "sam", markName: "VELTRIPHEN", classes: [1, 5, 42, 44], customer: "Petcary" });
  const other = matterSignature({ forwarder: "sam", markName: "AURALITH", classes: [9], customer: "Acme" });
  const now = 1_700_000_000_000;
  recordMatter(q, { sig, conversationId: "CONV-A", msgId: "<orig@x>", ts: now });

  // matter-signature dimension
  assert.ok(findDuplicateMatter(q, { sig, msgId: "<reply@x>" }, now + 60_000), "same matter, different msgId, within window ⇒ duplicate");
  assert.equal(findDuplicateMatter(q, { sig, msgId: "<orig@x>" }, now + 60_000), null, "same msgId (crash re-claim/resume) never self-dedups");
  assert.equal(findDuplicateMatter(q, { sig: other, msgId: "<z@x>" }, now + 60_000), null, "a different matter (no thread match) is not deduped");
  assert.equal(findDuplicateMatter(q, { sig, msgId: "<reply@x>" }, now + 25 * 3600_000), null, "beyond the 24h window is not deduped");

  // thread (conversationId) dimension — catches a SAME-MARK reply whose classes/customer DRIFTED, but a
  // DIFFERENT mark in the same thread is a DISTINCT matter and must NOT collapse (three-marks-in-one-email).
  const velDrift = matterSignature({ forwarder: "sam", markName: "VELTRIPHEN", classes: [9], customer: "PetCary Ltd" });
  assert.notEqual(velDrift, sig, "drifted classes/customer make a different signature — only the thread+mark can match");
  assert.ok(findDuplicateMatter(q, { sig: velDrift, conversationId: "CONV-A", msgId: "<reply@x>" }, now + 60_000), "same thread, SAME mark, drifted classes/customer ⇒ duplicate (thread dimension)");
  assert.equal(findDuplicateMatter(q, { sig: other, conversationId: "CONV-A", msgId: "<reply@x>" }, now + 60_000), null, "same thread but a DIFFERENT mark ⇒ distinct matter, NOT deduped");
  assert.equal(findDuplicateMatter(q, { sig: other, conversationId: "CONV-B", msgId: "<reply@x>" }, now + 60_000), null, "different thread AND different matter ⇒ not deduped");

  dropMatter(q, "<orig@x>"); // a FAILED run drops its entry
  assert.equal(findDuplicateMatter(q, { sig, conversationId: "CONV-A", msgId: "<reply@x>" }, now + 60_000), null, "a dropped entry no longer blocks a re-send (neither matter nor thread)");
});

test("integration: signature + same-mark-thread dedup park .duplicate; distinct-mark thread + dupOverride run", async () => {
  const q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
  mkdirSync(q, { recursive: true });
  // (1) SAME matter, two messages (original + "please proceed"), casing/class-order drift, NO conversationId
  //     — exercises the MATTER-SIGNATURE dimension.
  // profileKey is set because "Petcary" IS an account on the roster: an untagged job naming a customer we
  // hold now clarifies at intake rather than running on the house default scale, so a job shaped like this
  // one would never reach the dedup logic under test. Tagging it is what a correctly-composed request for
  // that customer looks like, and it leaves every matter-signature input untouched.
  enqueue(q, "vel-orig",  { msgId: "<vel-orig@x>",  mark: "VELTRIPHEN", classes: [1, 5, 42, 44], customer: "Petcary", profileKey: "petcary" });
  enqueue(q, "vel-reply", { msgId: "<vel-reply@x>", mark: "veltriphen", classes: [42, 1, 44, 5], customer: "Petcary ", profileKey: "petcary" });
  // (2) SAME thread, DIFFERENT marks (two marks in one forwarded email) — must BOTH run (the 2026-07-03 fix).
  enqueue(q, "thr-orig",  { msgId: "<thr-orig@x>",  mark: "ZEDMARK", classes: [9], customer: "Zed", conversationId: "CONV-T" });
  enqueue(q, "thr-reply", { msgId: "<thr-reply@x>", mark: "YEDMARK", classes: [9], customer: "Zed", conversationId: "CONV-T" });
  // (2b) SAME thread, SAME mark, DRIFTED classes/customer — the "please proceed" drift-catch still parks one.
  enqueue(q, "drf-orig",  { msgId: "<drf-orig@x>",  mark: "DRIFTMARK", classes: [9],     customer: "Zed",     conversationId: "CONV-D" });
  enqueue(q, "drf-reply", { msgId: "<drf-reply@x>", mark: "DRIFTMARK", classes: [9, 42], customer: "Zed Inc", conversationId: "CONV-D" });
  // (3) DISTINCT matter + distinct thread — must run.
  enqueue(q, "other", { msgId: "<other@x>", mark: "AURALITH", classes: [9], customer: "Acme", conversationId: "CONV-O" });
  // (4) dupOverride: a job whose matter MATCHES a pre-seeded prior still runs (the explicit force-run path).
  const ovrSig = matterSignature({ forwarder: "sam", markName: "OVERMARK", classes: [9], customer: "Ovr" });
  recordMatter(q, { sig: ovrSig, conversationId: "", msgId: "<ovr-prior@x>", id: "ovr-prior", ts: Date.now() });
  assert.ok(findDuplicateMatter(q, { sig: ovrSig, msgId: "<ovr-force@x>" }, Date.now()), "the seeded prior really would dedup — so a successful run proves dupOverride bypassed it");
  enqueue(q, "ovr-force", { msgId: "<ovr-force@x>", mark: "OVERMARK", classes: [9], customer: "Ovr", dupOverride: true });

  await main({ once: true });
  // — BEFORE the assertions below. If the runner refused before any run
  // started, every count below is 0 for a reason that has nothing to do with what is under test,
  // and the packets beside the queue already say what it was.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.dedup.test.mjs");

  // (1) matter-signature dedup: exactly one VELTRIPHEN ran, the other parked BY SIGNATURE.
  const velDone = ["vel-orig", "vel-reply"].filter((b) => existsSync(join(q, `${b}.done`)));
  const velDup = ["vel-orig", "vel-reply"].filter((b) => existsSync(join(q, `${b}.duplicate`)));
  assert.equal(velDone.length, 1, `exactly one VELTRIPHEN ran (got ${velDone})`);
  assert.equal(velDup.length, 1, `exactly one VELTRIPHEN parked (got ${velDup})`);
  const velReason = readFileSync(join(q, `${velDup[0]}.duplicate.reason`), "utf8");
  assert.match(velReason, /duplicate prelim/);
  assert.match(velReason, /matched by: matter signature/);
  assert.match(velReason, /to force .*"dupOverride": true/, "reason explains how to force a run (dupOverride)");
  assert.match(velReason, /notify: packet /);
  // handoff default: the duplicate-skip notice is a self-contained outbox event packet, not a gateway ping.
  const dupPacket = JSON.parse(readFileSync(join(root, "prelim-outbox", `intake-${velDup[0]}.duplicate.pending`), "utf8"));
  assert.equal(dupPacket.kind, "duplicate-skipped");
  assert.match(dupPacket.text, /looks like a duplicate/);

  // (2) distinct marks in ONE thread: BOTH run, neither parks (no thread-collapse of distinct matters).
  const thrDone = ["thr-orig", "thr-reply"].filter((b) => existsSync(join(q, `${b}.done`)));
  const thrDup = ["thr-orig", "thr-reply"].filter((b) => existsSync(join(q, `${b}.duplicate`)));
  assert.equal(thrDone.length, 2, `both distinct marks in one thread ran (got ${thrDone})`);
  assert.equal(thrDup.length, 0, `no distinct mark parked on the shared thread (got ${thrDup})`);

  // (2b) same-mark drifted reply in one thread: exactly one ran, the other parked BY THREAD.
  const drfDone = ["drf-orig", "drf-reply"].filter((b) => existsSync(join(q, `${b}.done`)));
  const drfDup = ["drf-orig", "drf-reply"].filter((b) => existsSync(join(q, `${b}.duplicate`)));
  assert.equal(drfDone.length, 1, `exactly one same-mark drifted job ran (got ${drfDone})`);
  assert.equal(drfDup.length, 1, `exactly one same-mark drifted job parked (got ${drfDup})`);
  assert.match(readFileSync(join(q, `${drfDup[0]}.duplicate.reason`), "utf8"), /matched by: thread/);

  // (3) distinct matter ran.
  assert.ok(existsSync(join(q, "other.done")), "the distinct matter must run");

  // (4) dupOverride forced a run past a matching prior.
  assert.ok(existsSync(join(q, "ovr-force.done")), "a dupOverride job runs even though its matter matches a prior ledger entry");
  assert.ok(!existsSync(join(q, "ovr-force.duplicate")), "a dupOverride job is never parked as a duplicate");

  // Ledger records the seeded prior + every RUN matter (vel 1, thr 2, drf 1, other 1, ovr-force 1), never the
  // three parked dups (vel, drf).
  const ledgerPath = join(root, "workspace-clawdi", "studio", "prelim-search", ".matter-ledger.jsonl");
  const ledger = readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(ledger.length, 7, `ledger has the seeded prior + six runs (got ${ledger.length})`);

  // One duplicate event packet per parked dup (vel + drf = 2), with the duplicate-skip wording; no
  // intake-rejected packets; and NO gateway calls at all (handoff default — no gateway is ever invoked, so
  // the call log never even comes into existence).
  const outbox = join(root, "prelim-outbox");
  const dupPackets = readdirSync(outbox).filter((f) => f.startsWith("intake-") && f.endsWith(".duplicate.pending"));
  assert.equal(dupPackets.length, 2, "one duplicate packet per parked dup");
  for (const f of dupPackets) {
    const pk = JSON.parse(readFileSync(join(outbox, f), "utf8"));
    assert.equal(pk.kind, "duplicate-skipped");
    assert.match(pk.text, /duplicate of a matter/);
  }
  assert.equal(readdirSync(outbox).filter((f) => f.endsWith(".failed.pending") && f.startsWith("intake-")).length, 0,
    "no intake-rejected packets");
  assert.ok(!existsSync(callLog), "no gateway invocation of any kind");
});
