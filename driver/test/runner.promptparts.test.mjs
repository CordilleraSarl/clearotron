// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner from a hand-emitted job file to a run
// Prose-out-of-JSON intake (the "unparseable job file" fix, 2026-06-16). The email-loop agent can only `write`
// files, not `exec` a serializer, so it used to hand-emit the whole job as one JSON literal — and an unescaped
// `"` inside the `brief` prose (TONICA/Zephyr `running as project ref "awesome-drinks"`) made JSON.parse throw
// at intake, parking the job with NOTHING searched. The fix carries every prose field as a raw plain-text
// SIDECAR (`<base>.brief.md`, …); runner.assembleJob() overlays them onto a scalar-only `<base>.json` manifest,
// so prose is never parsed and can never break intake. This file is a SEPARATE test file (not a 2nd test() in
// intake-reject.test.mjs) on purpose: driver.config.mjs captures workspaceRoot at module-load, and `?bust` only
// re-instantiates runner.mjs — a fresh root only takes effect in a fresh process, which `node --test` gives per file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROSE_PARTS } from "../queue-markers.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline"; // offline mock: no /mark/ citations ⇒ no record fetch
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
import { requiresTheSuiteRunner, refuseOnPreRunFailure } from "./precondition-refusal.mjs";
// — FIRST, before any env default below: those defaults make this file look
// runnable while the environment it actually needs is still absent.
requiresTheSuiteRunner("runner.promptparts.test.mjs");

process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

// The cleanup/residue assertions key on these. They used to be MIRRORED here, which made this the third
// copy of the list; sourced it, so a tenth prose field is covered by these assertions the day it
// lands rather than the day someone remembers to retype it.
const PROSE_SUFFIXES = Object.values(PROSE_PARTS);

test("prose sidecars assemble + run; legacy inline still works; missing-subject & broken-manifest park + ping + cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-promptparts-"));
  const callLog = join(root, "calls.jsonl");
  const claudeLog = join(root, "claude-calls.jsonl");   // {argv, prompt} rows — the stage prompts ride stdin
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_CALL_LOG: callLog, MOCK_CLAUDE_CALL_LOG: claudeLog,
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

  const q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
  mkdirSync(q, { recursive: true });

  // (1) THE regression: prose with unescaped quotes + newline + backslash — the exact shape that broke
  // JSON.parse when hand-emitted as one JSON file. As raw sidecars it needs zero escaping.
  const BRIEF = 'Confirmation brief — running as project ref "awesome-drinks".\n'
    + 'Marketed as "ZEPHYR TONICA" but TONICA is the mark. Path: C:\\runs\\tonica — done.';
  // prose files FIRST...
  writeFileSync(join(q, "tonica.markName.md"), "TONICA\n");
  writeFileSync(join(q, "tonica.brief.md"), BRIEF);
  writeFileSync(join(q, "tonica.rawRequest.txt"), 'Forwarded: please clear "TONICA" worldwide.\n');
  // P2-C (§8a): campaign-shape FACTS ride a prose sidecar exactly like priorUse — asserted below to reach
  // the matter-frame prompt verbatim (the frame records them instead of inventing a launch shape).
  const CAMPAIGN = 'Seasonal limited flavour drop under the "ZEPHYR TONICA" house mark; 12-week summer program.\n';
  writeFileSync(join(q, "tonica.campaignShape.txt"), CAMPAIGN);
  // ...manifest (scalars only) LAST.
  writeFileSync(join(q, "tonica.json"), JSON.stringify({
    id: "tonica", msgId: "<tonica@x>", forwarder: "jordan", forwarderDomain: "example.com",
    provider: "corsearch", classes: [5, 30, 32], profileKey: "zephyr", customer: "Zephyr Beverages", promptParts: true,
  }));

  // (2) Back-compat: a self-contained legacy job (prose inline, properly escaped, no sidecars) must still run.
  writeFileSync(join(q, "legacy.json"), JSON.stringify({
    id: "legacy", msgId: "<legacy@x>", forwarder: "jordan", forwarderDomain: "example.com",
    provider: "corsearch", markName: 'LEGACY "INLINE" MARK', classes: [9],
    brief: 'inline brief with a "quote" — escaped by JSON.stringify', rawRequest: "inline raw request",
  }));

  // (3) Optional prose omitted: manifest + markName sidecar but NO brief sidecar — must still run (brief absent).
  writeFileSync(join(q, "partial.markName.md"), "PARTIAL PROBE\n");
  writeFileSync(join(q, "partial.json"), JSON.stringify({
    id: "partial", msgId: "<partial@x>", forwarder: "jordan", forwarderDomain: "example.com",
    provider: "corsearch", classes: [9],
  }));

  // (4) Subject lives ONLY in a sidecar that was never written: scalar manifest, no markName.md, no classes,
  // no goods → assembled object fails validateJob → parks "clarify" + ping. Proves the subject truly depends
  // on the sidecar (a scalar-only manifest is not a runnable job on its own).
  writeFileSync(join(q, "nosubject.json"), JSON.stringify({
    id: "nosubject", msgId: "<nosubject@x>", forwarder: "jordan", provider: "corsearch",
  }));

  // (5) Unparseable MANIFEST (+ a stray prose sidecar) → parks with the new "unparseable manifest" reason, and
  // the stray sidecar must be swept by cleanupProseParts (no residue).
  writeFileSync(join(q, "brokenman.brief.md"), "orphan prose that must be cleaned up");
  writeFileSync(join(q, "brokenman.json"), "not json {{{");

  // (6) THE VELTRIPHEN regression (2026-06-19): the manifest is mis-named `<id>.manifest.json` (a forwarding-agent
  // filename fumble) while the prose sidecars carry the BARE base. The runner must tolerate the `.manifest` infix,
  // overlay `<id>.markName.md`, load the mark, and RUN — not park "missing mark name(s)" the way (4) does.
  writeFileSync(join(q, "mfumble.markName.md"), "FUMBLE MARK\n");
  writeFileSync(join(q, "mfumble.rawRequest.txt"), 'Forwarded: please clear "FUMBLE MARK".\n');
  writeFileSync(join(q, "mfumble.manifest.json"), JSON.stringify({
    id: "mfumble", msgId: "<mfumble@x>", forwarder: "jordan", forwarderDomain: "example.com",
    provider: "corsearch", classes: [9], promptParts: true,
  }));

  const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
  await main({ once: true });
  // — BEFORE the assertions below. If the runner refused before any run
  // started, every count below is 0 for a reason that has nothing to do with what is under test,
  // and the packets beside the queue already say what it was.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.promptparts.test.mjs");

  // (1) ran, and the verbatim prose (unescaped quotes, backslash, newline) round-tripped into the run artifact.
  assert.ok(existsSync(join(q, "tonica.done")), "prose-out job must RUN, not fail at intake");
  const tonicaRes = JSON.parse(readFileSync(join(q, "tonica.done.result"), "utf8"));
  assert.equal(tonicaRes.ok, true, JSON.stringify(tonicaRes));
  const briefArtifact = readFileSync(join(tonicaRes.runDir, "confirmation-brief.md"), "utf8");
  assert.ok(briefArtifact.includes('project ref "awesome-drinks"'), "unescaped quotes survived verbatim");
  assert.ok(briefArtifact.includes("C:\\runs\\tonica"), "backslashes survived verbatim");
  assert.ok(briefArtifact.includes('"ZEPHYR TONICA"'), "all embedded quotes survived verbatim");
  // P2-C (§8a): the campaignShape sidecar overlaid the job and rode the matter-frame prompt VERBATIM
  // (assembleJob → job.campaignShape → the stage message's "Stated campaign shape" line).
  const prompts = readFileSync(claudeLog, "utf8").trim().split("\n").map((l) => JSON.parse(l).prompt ?? "");
  const frameCall = prompts.find((p) => p.includes("Build the strategic matter frame") && p.includes("TONICA"));
  assert.ok(frameCall, "a matter-frame call for the tonica job is in the claude call log");
  assert.ok(frameCall.includes("Stated campaign shape (verbatim from intake"), "the campaign-shape prompt line rode the frame message");
  assert.ok(frameCall.includes('Seasonal limited flavour drop under the "ZEPHYR TONICA" house mark; 12-week summer program.'),
    "the stated facts reached the frame verbatim (quotes intact, no escaping)");

  // (2) legacy + (3) partial both ran.
  assert.ok(existsSync(join(q, "legacy.done")), "legacy self-contained JSON must still run");
  assert.ok(existsSync(join(q, "partial.done")), "manifest + markName sidecar (no brief) must run");

  // (6) the `<id>.manifest.json` mis-name still RAN — its bare-base sidecars overlaid via the `.manifest`-tolerant
  // base, so the mark loaded (else it would park like (4)). The lifecycle stays on the physical claimed name.
  assert.ok(existsSync(join(q, "mfumble.manifest.done")), "manifest mis-named <id>.manifest.json must RUN (tolerant sidecar base)");
  const mfumbleRes = JSON.parse(readFileSync(join(q, "mfumble.manifest.done.result"), "utf8"));
  assert.equal(mfumbleRes.ok, true, JSON.stringify(mfumbleRes));

  // (4) parked at intake with a subject error + notified (handoff default: outbox event packet).
  assert.ok(existsSync(join(q, "nosubject.failed")), "scalar-only manifest with no subject must park");
  const reasonNoSubject = readFileSync(join(q, "nosubject.failed.reason"), "utf8");
  assert.match(reasonNoSubject, /missing mark name/);
  assert.match(reasonNoSubject, /notify: packet /);

  // (5) parked with the NEW message, and the orphan sidecar was swept.
  assert.ok(existsSync(join(q, "brokenman.failed")), "broken manifest must park");
  const reasonBroken = readFileSync(join(q, "brokenman.failed.reason"), "utf8");
  assert.match(reasonBroken, /unparseable manifest/);
  assert.ok(!existsSync(join(q, "brokenman.brief.md")), "stray sidecar swept on intake-fail");

  // No residue anywhere: every job's prose sidecars and intermediates are gone after terminal.
  for (const base of ["tonica", "legacy", "partial", "nosubject", "brokenman"]) {
    assert.ok(!existsSync(join(q, `${base}.processing`)), `${base}.processing must not remain`);
    assert.ok(!existsSync(join(q, `${base}.json`)), `${base}.json must be consumed`);
    for (const sfx of PROSE_SUFFIXES) {
      assert.ok(!existsSync(join(q, `${base}${sfx}`)), `${base}${sfx} must be swept at terminal`);
    }
  }

  // (6) residue: the mis-named manifest is consumed and its bare-base sidecars swept (cleanupProseParts strips .manifest).
  assert.ok(!existsSync(join(q, "mfumble.manifest.processing")), "mfumble.manifest.processing must not remain");
  assert.ok(!existsSync(join(q, "mfumble.manifest.json")), "mfumble.manifest.json must be consumed");
  for (const sfx of PROSE_SUFFIXES) {
    assert.ok(!existsSync(join(q, `mfumble${sfx}`)), `mfumble${sfx} must be swept at terminal`);
  }

  // Exactly one outbox event packet per parked job (nosubject, brokenman) — none for the three that ran
  // (handoff default: the notice is a packet, not a gateway ping — no prelim-intake-* gateway calls at all).
  const outbox = join(root, "prelim-outbox");
  for (const base of ["nosubject", "brokenman"]) {
    const packet = JSON.parse(readFileSync(join(outbox, `intake-${base}.failed.pending`), "utf8"));
    assert.equal(packet.kind, "intake-rejected");
    assert.match(packet.text, /Nothing has been searched or delivered/);
  }
  for (const base of ["tonica", "legacy", "partial"]) {
    assert.ok(!existsSync(join(outbox, `intake-${base}.failed.pending`)), `${base} ran — no intake packet`);
  }
  // Stronger still: no gateway is invoked at all, so the call log never exists
  // (the retired gateway mock appended on every invocation; mock-claude only logs in MOCK_WARM_MODE).
  assert.ok(!existsSync(callLog), "no gateway invocation of any kind");
});
