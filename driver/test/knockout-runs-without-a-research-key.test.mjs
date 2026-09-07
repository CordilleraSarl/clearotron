// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// acceptance 6 — NO CAPABILITY REFUSES THE SCREEN FOR WANT OF A KEY.
//
// A knockout screen used to die at `knockout-preflight` when the deployment held no research
// credential. It now launches, delivers the half it can, and says which half it did not run.
//
// WHY DELETING THE THROW WOULD HAVE BEEN THE WRONG FIX, and why these tests pin a SKIP rather than an
// absence of refusal: the comment at that throw recorded what it was protecting — without it "the
// cred-guard degrades every mark per-call and the batch dies all-failed only AFTER the paid frame
// turn." A run that attempts a sweep it cannot make is worse than one that refuses, and it costs money
// to reach. So the sweep must be NOT ATTEMPTED, which is a different state from attempted-and-failed
// and is what `resolveSweepExecutor` now returns.
//
// ADR-0003 is the authority the change rests on: "Refusing at preflight and degrading with a
// disclosure are both acceptable; degrading in silence is not. Which one applies is per component."
// This moves the research sweep from the first column to the second. The silence half is what the
// disclosure assertions below exist for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));

// driver.config.mjs READS THE ENVIRONMENT AT IMPORT — the sandbox goes up before the first import or a
// real outbox receives this test's packets and it still passes green.
const ROOT = mkdtempSync(join(tmpdir(), "ko-no-research-key-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_AGENT = "clawdi";
// THE PRE-ALIAS SPELLING, DELIBERATELY. `CLEAROTRON_DATABASE` is the current name, but the translation
// runs in `applyEnvAliases` at the CLI entry gates — `driver.config.mjs` never calls it and reads this
// name straight off the environment. A test setting only the current spelling configures nothing and
// then proves whatever a null provider does. (driver/test/enqueue-cli.test.mjs records the same trap.)
pinEnv(process.env, "CLEAROTRON_DATABASE", "free-tier");
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
// The frame turn is a MODEL DISPATCH and it sits BEFORE the sweep — which is exactly why the refusal
// this change removes was placed where it was ("fail fast BEFORE any model spend"). To observe the
// sweep at all, the run has to get through that turn, so it runs on the repo's mock CLI at $0. The
// mock is the same one runner.knockout-e2e.test.mjs drives.
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

const { resolveSweepExecutor, knockoutInner } = await import("../pipeline-knockout.mjs");
const { CAPABILITY_SKIPPED_NOTE, CAPABILITY_SKIPPED_CAUSE } = await import("../search-policy.mjs");

const withoutKey = async (fn) => {
  const real = process.env.PERPLEXITY_API_KEY;
  const fix = process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES;
  try { return await fn(); } finally {
    if (real !== undefined) process.env.PERPLEXITY_API_KEY = real;
    if (fix !== undefined) process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES = fix;
  }
};

// ── 1 · the resolver: which of the four states a deployment lands in ────────────────────────────────

test("#1223 with no research credential the sweep resolves to a SKIP, and holds no executor to call", async () => {
  await withoutKey(() => {
    const s = resolveSweepExecutor({});
    assert.equal(s.skipped, "common-law-no-credential");
    assert.equal(s.exec, null,
      "a skip that still carried an executor is one refactor away from being called — the point is that "
      + "there is nothing to call");
    assert.equal(s.source, "perplexity", "the source still names what WOULD have run, for the ledger");
  });
});

test("#1223 a credential, a fixtures dir, or an injected executor each beat the skip", async () => {
  await withoutKey(() => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    const live = resolveSweepExecutor({});
    assert.equal(live.skipped, undefined, "a configured deployment must not skip");
    assert.equal(typeof live.exec, "function");
    delete process.env.PERPLEXITY_API_KEY;

    process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES = join(ROOT, "fixtures");
    const fix = resolveSweepExecutor({});
    assert.equal(fix.skipped, undefined, "the $0 offline guarantee must still run rather than skip");
    assert.match(fix.source, /^fixtures:/);
    delete process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES;

    const injected = resolveSweepExecutor({ sweepExecutor: async () => ({ ok: true, text: "x" }) });
    assert.equal(injected.skipped, undefined, "an injected executor is a real sweep — tests drive it");
    assert.equal(injected.source, "injected");
  });
});

// ── 2 · the disclosure, and the rules it inherits from its sibling ──────────────────────────────────

test("#1223 every skip cause has a client sentence and an internal cause, and they cannot drift apart", () => {
  assert.deepEqual(Object.keys(CAPABILITY_SKIPPED_NOTE).sort(), Object.keys(CAPABILITY_SKIPPED_CAUSE).sort(),
    "a cause with no sentence discloses nothing to a client; a sentence with no cause can never fire");
  assert.ok(Object.keys(CAPABILITY_SKIPPED_NOTE).length > 0, "an empty map discloses nothing at all");
});

test("#1223 the client sentence names no vendor and carries no environment-variable name", () => {
  // The same two rules UNAVAILABLE_NOTE states for itself, checked rather than trusted. CI greps the
  // built portal bundle and the MCP response for `CLEAROTRON_`; this catches it one layer earlier, at the
  // only place these words are written.
  for (const [cause, sentence] of Object.entries(CAPABILITY_SKIPPED_NOTE)) {
    assert.doesNotMatch(sentence, /CLEAROTRON_|API_KEY/,
      `${cause}: a client is being shown an environment-variable name`);
    assert.doesNotMatch(sentence, /perplexity|corsearch|clarivate|signa/i,
      `${cause}: names a vendor — the research provider is a deployment's choice, never a baked-in name`);
  }
});

test("#1223 the sentence says what IS still true, not only what is missing", () => {
  // A screen that reports "something did not run" and stops there reads as a broken run. The reader is
  // holding half a product and needs to know which half.
  const s = CAPABILITY_SKIPPED_NOTE["common-law-no-credential"];
  assert.match(s, /register/i, "it must say the register half is unaffected, or the report reads as broken");
  assert.match(s, /unscreened|not.*screened/i, "and it must say plainly what has NOT been checked");
});

// ── 3 · the run: it launches, and the skip is on the record ─────────────────────────────────────────

test("#1223 a keyless screen LAUNCHES — it passes the preflight that used to kill it, and records the skip", async () => {
  await withoutKey(async () => {
    const id = "cli-no-research-key";
    const studioRoot = join(ROOT, "studio", id);
    const runDir = join(studioRoot, "prelim-search", "runs", "wanderer", "2026-08-20-teal-gantry");
    mkdirSync(driverDir(runDir), { recursive: true });
    const run = { runDir, studioRoot, slug: "wanderer", date: "2026-08-20", codename: "teal-gantry",
      archiveDir: join(studioRoot, "archive", "2026-08-20-teal-gantry") };
    const job = { id, markName: "WANDERER", marks: [{ name: "WANDERER" }], classes: [9],
      jurisdictions: ["EU"], forwarder: "jordan", msgId: `<${id}@x>`, ref: "E2E-1223" };
    const ctx = { run, job, agent: "clawdi", paths: { runDir }, profile: {},
      searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register",
        components: { registerProbe: true } } };

    // NO sweepExecutor injected — that is the whole point: the lane must reach the real resolver and
    // find the skip. The counter IS injected, so the register half runs at $0 and the screen has
    // something to deliver, which is what makes this a degrade rather than an empty result.
    const RES = await knockoutInner(ctx, job, { countExecutor: async () => ({ ok: true, total: 0 }) })
      .catch((e) => { console.error("DEBUG threw:", e && e.stack ? e.stack.slice(0,1200) : String(e)); return null; });

    // What is asserted is that the run got PAST the preflight and recorded a not-attempted sweep. The
    // old behaviour threw at `knockout-preflight`, before any of this existed.
    // IT DELIVERS. That is the acceptance, not merely "it did not refuse": a screen with no research
    // credential returns a report with a band. The run dir is the ARCHIVE path by now — publish moves
    // it — so the log is read from where the run actually ended, not where it started.
    assert.equal(RES?.ok, true, "the keyless screen did not deliver — acceptance 6 asks for a run that "
      + `launches and skips, not one that survives the preflight and dies later. Got ${JSON.stringify(RES)}`);
    assert.ok(RES.verdict, "delivered without a verdict — an empty result is what the ruling rejects");

    const log = join(driverDir(RES.runDir), "run.jsonl");
    assert.ok(existsSync(log), `the run left no log at ${log}`);
    const events = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const skip = events.find((e) => e.event === "knockout-sweep-skipped");
    assert.ok(skip, "no knockout-sweep-skipped event — the lane either refused, or attempted a sweep it "
      + `has no credential for. Events seen: ${JSON.stringify(events.map((e) => e.event))}`);
    assert.equal(skip.cause, "common-law-no-credential");
    assert.equal(skip.marks, 1);

    assert.ok(!events.some((e) => e.event === "knockout-sweep-start"),
      "the sweep STARTED — a skip must not be attempted-and-failed, which is what costs the frame turn");

    // ── the disclosure, on the artifact rather than in a log ────────────────────────────────────────
    //
    // ADR-0003's rule is "a component that cannot run must say so ON THE ARTIFACT", so a run.jsonl
    // event is not enough on its own — `_driver/` is not what a client reads. Both halves are checked:
    // the per-mark degrade that the renderers turn into a manual-verification note, and the run-level
    // sentence that says which capability did not run at all.
    const findings = JSON.parse(readFileSync(join(RES.runDir, "knockout-findings.json"), "utf8"));
    const caveats = (findings.batch?.standardCaveats ?? []).map(String);
    assert.ok(caveats.includes(CAPABILITY_SKIPPED_NOTE["common-law-no-credential"]),
      `the skipped-capability sentence never reached the artifact. Caveats: ${JSON.stringify(caveats)}`);
    assert.ok(caveats.length > 1 && caveats[0] !== CAPABILITY_SKIPPED_NOTE["common-law-no-credential"],
      "it was PREPENDED — publish/knockout.mjs's email takes standardCaveats[0], so leading with this "
      + "silently replaces the standing caveat in the requester's inbox");

    // TRUTHY, not a pinned shape. `degraded` is the assessing model's own field — a boolean on one
    // schema and `{reason}` on another — and it is the VALIDATOR (verify-knockout.mjs) that owns the
    // invariant: a row with no payload on disk and no degrade is refused there, in both directions.
    // Pinning the shape here would pin the mock's output rather than the rule.
    assert.ok((findings.marks ?? []).length > 0, "no marks on the artifact — nothing was delivered");
    for (const m of findings.marks ?? []) {
      assert.ok(m.degraded,
        `mark ${m.name} is not marked degraded, but no research payload was ever fetched for it — `
        + "the null-results doctrine forbids a silently clean row");
    }
  });
});
