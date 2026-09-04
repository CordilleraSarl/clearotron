// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the full pipeline on the codex engine shape
// E2 (openai) — the $0 mock pipeline runs END-TO-END on CLEAROTRON_AI=openai-agent (codex exec, mocked).
// The MECHANICAL-SWAP proof: all 14 stages flow through the OpenAI engine with the SAME shared fixtures as
// the anthropic path, with ZERO changes to stages.mjs / pipeline.mjs — flipping CLEAROTRON_AI is the whole
// switch. (REASONING parity between providers is the separate paid A/B — not claimed here.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { PROBE_PROMPT } from "../engine/probe.mjs";
// — the RECORDING category's MEMBERSHIP, so a converted stage's own `mcp_servers.recording-<stage>`
// key is admitted without this file naming the stages. Only the membership: see the key-spelling note below.
import { RECORDING_STAGES } from "../engine/mcp/gather-config.mjs";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — the pin follows the emitter

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX_MOCK = join(HERE, "mock-codex.mjs");
chmodSync(CODEX_MOCK, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-oai", msgId: "<test-oai@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

/** The workspace root of the LAST run started, readable after a rejection — see the door-refusal test. */
let lastRoot = null;

async function runOpenaiPipeline(env = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-oai-"));
  lastRoot = root;
  const codexLog = join(root, "codex-calls.jsonl");
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP"]) delete process.env[k];
  // — pinEnvAll, not a bare write: a fixture pinned under ONE spelling is displaced by any
  // pin of the other one upstream, and the run then computes against a value this file never chose.
  pinEnvAll(process.env, {
    CLEAROTRON_AI: "openai-agent",          // stage compute on codex exec (mocked)
    CLEAROTRON_CODEX_PATH: CODEX_MOCK,
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy",   // api-key mode → no auth.json seeding; the mock ignores it
    MOCK_CODEX_CALL_LOG: codexLog,          // proves the stages actually went through the openai engine (argv + prompt + config.toml)
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const turns = existsSync(codexLog) ? readFileSync(codexLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  // — the run door's engine-turn probe opens the log and is NOT a stage (no run dir, no config.toml
  // MCP servers, floor tier). Split out by the probe's own exported prompt so the per-stage assertions
  // below keep judging only compute stages; the sibling comment in pipeline.anthropic.test.mjs has the
  // reasoning, and both files carry the split because both engines pay the same door.
  const doorProbe = turns.find((c) => (c.prompt || "").trim() === PROBE_PROMPT) ?? null;
  const codexCalls = turns.filter((c) => c !== doorProbe);
  return { res, events, codexCalls, doorProbe, turns };
}

test("E2(openai): full pipeline runs on the openai-agent engine (CLEAR, delivered, all stages via codex exec)", async () => {
  const { res, events, codexCalls, doorProbe, turns } = await runOpenaiPipeline();
  assert.equal(res.ok, true, JSON.stringify(res));

  // — the engine-turn door fires on BOTH engines and it is the same door: first turn of the run,
  // floor tier, nothing granted. This is the mechanical-swap claim applied to the door itself.
  assert.equal(turns[0], doorProbe, "the engine-turn probe is the FIRST turn of the run, ahead of matter-frame");
  assert.equal(doorProbe.argv[0], "exec", "the door's turn is built by the adapter's own buildCodexArgs");
  assert.match(doorProbe.argv.join(" "), /-c model_reasoning_effort=\S+/, "…carrying the floor effort rung, not a hand-rolled argv");
  assert.ok(!doorProbe.argv.includes("--add-dir"), "the door grants no directory — it runs before one exists");
  assert.ok(!(doorProbe.configToml || "").includes("[mcp_servers"), "and starts no MCP server");
  const probeRow = events.find((e) => e.event === "engine-turn-probe");
  assert.ok(probeRow?.ok === true && probeRow.basis === "completed-turn", `the door's verdict is on the run record: ${JSON.stringify(probeRow)}`);
  assert.equal(res.verdict, "CLEAR");
  assert.ok(existsSync(join(res.runDir, ".delivered")), ".delivered sentinel present");

  const order = events.filter((e) => e.event === "stage").map((e) => e.stage);
  const idx = (s) => order.findIndex((x) => x.startsWith(s));
  // SAME ordering invariants as the anthropic happy path → the engine swap is structurally transparent.
  assert.ok(idx("matter-frame") >= 0 && idx("matter-frame") < idx("prelim-variants"), "matter-frame before variants");
  assert.ok(idx("prelim-variants") < idx("common-law"), "variants before gather");
  assert.ok(idx("skeptic") < idx("synthesis"), "skeptic before synthesis");
  assert.ok(idx("synthesis") < idx("narrative-refutation"), "synthesis before refutation");
  for (const ax of ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"])
    assert.ok(order.includes(`register-unit:${ax}`), `axis ${ax} ran on openai`);
  // — REWRITTEN. This job's product does not carry the case-law reading, so the detector records and
  // does not execute. The engine under test is irrelevant to that decision, which is the point: the gate
  // is on the PRODUCT, not on how the stage would have been dispatched.
  assert.ok(!order.includes("case-law"), "case-law does not run on a product that does not sell it (#519)");
  assert.ok(events.some((e) => e.event === "verdict" && e.verdict === "CLEAR"), "CLEAR verdict recorded");

  // PROOF the compute stages went through `codex exec` (not a silent fallback): the mock-codex call-log has
  // many `exec` invocations carrying the flags the engine builds. The prompt rides STDIN (the `-` placeholder).
  assert.ok(codexCalls.length >= 8, `expected ≥8 codex exec stage turns, got ${codexCalls.length}`);
  const first = codexCalls[0];
  assert.equal(first.argv[0], "exec", "codex invoked in exec (non-interactive) mode");
  assert.ok(first.argv.includes("--json"), "JSONL event stream requested");
  assert.ok(first.argv.includes("--skip-git-repo-check"), "neutral non-repo cwd allowed");
  assert.equal(first.argv[first.argv.length - 1], "-", "prompt rides stdin via the `-` placeholder");

  // Skill refs absolutized in every prompt (codex cwd = tmpdir cannot resolve workspace-relative paths); and
  // each compute turn grants --add-dir on THIS run's dir (the writable root for the stage's output file).
  const BARE_SKILL_REF = /(?<![\w/.])skills\/[A-Za-z0-9._/-]+\.md/;
  for (const call of codexCalls) {
    const msg = call.prompt || "";
    assert.ok(!BARE_SKILL_REF.test(msg), `a stage prompt kept a workspace-relative skills ref: ${msg.match(BARE_SKILL_REF)?.[0]}`);
    const addDirs = call.argv.reduce((acc, a, i) => (a === "--add-dir" ? [...acc, call.argv[i + 1]] : acc), []);
    assert.ok(addDirs.some((d) => d && /\/studio\/prelim-search\//.test(d)), "compute turn grants --add-dir on the run dir");
  }
  assert.match(first.prompt, /\/driver\/skills\/matter-frame\/SKILL\.md/, "matter-frame skill ref absolutized to the driver's skills tree");

  // Every turn carries the WRITE_DISCIPLINE via config.toml's developer_instructions (codex's
  // append-system-prompt equivalent) — the shared stage prompts are never mutated.
  assert.ok(first.configToml.includes("developer_instructions ="), "config.toml carries developer_instructions (WRITE_DISCIPLINE)");

  // Per-stage tool selection via config.toml [mcp_servers]: judgment stages are LEAN (no servers); gather
  // stages get their MCP servers + per-server enabled_tools.
  //
  // CONVERSION 2 — matter-frame is a RECORDING stage now, so it is tooled on this engine too, and that is
  // the half worth asserting: the category's argv flip has to reach BOTH engines or a converted stage is
  // starved of its own transport on one of them. Same shape as the anthropic pin.
  assert.ok(first.configToml.includes("[mcp_servers"), "matter-frame is a recording stage now — codex mounts its server");
  assert.match(first.configToml, /recording-matter-frame/, "…under its own per-stage key");
  assert.match(first.configToml, /record_matter_frame/, "…with its record tool in enabled_tools");
  assert.match(first.configToml, /search_run_artifacts/, "…and the Class 2 read surface");
  // NO RETRIEVAL SERVER — asserted on the server KEYS, not on the text. `buildGatherMcpConfig` puts the
  // register telemetry ledger paths into every entry's env (CLEAROTRON_REGISTER_CALL_LOG and its sibling), so
  // the word "register" appears in a recording stage's config while nothing register-shaped is mounted.
  // A text match here would have read that env as a retrieval grant — the assertion has to name what it
  // means, which is which SERVERS the mount declares.
  for (const key of ["register", "perplexity", "band", "coverage", "courtlistener", "legaldatahunter"])
    assert.ok(!first.configToml.includes(`[mcp_servers.${key}]`),
      `matter-frame must mount no ${key} server — the recording category's promise is that it does not widen the retrieval surface`);

  // ──: EVERY TURN THAT MOUNTED A SERVER IS JUDGED, AND THE SUBJECT IS THE STAGE'S GROUPS ──────
  //
  // This block used to be one `codexCalls.find(has "[mcp_servers")` called `gatherCall` — whichever turn
  // the scheduler flushed to the call log first — and it broke in BOTH directions the moment the
  // RECORDING category stopped being empty. A converted stage mounts `mcp_servers.recording-<stage>`: a
  // perfectly neutral key that matches none of the three the neutral-key regex allows.
  //   · FALSE RED when a recording turn lands first — macOS CI, PR 's head, on a diff that cannot
  //     reach this lane; green on a re-run of the same head, and green on Linux every time so far.
  //   · FALSE GREEN the rest of the time, and that is the worse half: the neutral-key and no-vendor-name
  //     properties were checked on exactly ONE turn, so they went unchecked on every other one —
  //     including the stages that most recently gained a mount.
  // Stage-turn ordering is not stable across platforms and these properties never claimed anything about
  // one turn: ONE vendor-named key in ANY config is the defect. So the loop is the assertion.
  const serverKeysOf = (c) => [...(c.configToml || "").matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map((m) => m[1]);
  // Keyed off the KEYS, not off the "[mcp_servers" substring, so the filter and the classifier below read
  // the same thing: a block the regex cannot parse must not fall through the partition as a turn with an
  // empty key set (`[].every()` is `true`, which would file it as a recording turn and admit it silently).
  const mcpTurns = codexCalls.filter((c) => serverKeysOf(c).length);
  assert.ok(mcpTurns.length >= 2, `expected several turns to mount MCP servers, got ${mcpTurns.length}`);
  assert.equal(mcpTurns.length, codexCalls.filter((c) => (c.configToml || "").includes("[mcp_servers")).length,
    "a turn rendered an [mcp_servers] block whose key this test cannot read — the config shape moved");

  // THE RECORDING KEYS ARE ADMITTED EXPLICITLY, and the split of what is derived from what is pinned is
  // the point. MEMBERSHIP is derived from RECORDING_STAGES, so the third stage to convert is admitted
  // without touching this file — that is what stops re-opening on the next conversion. The
  // SPELLING is written here: `recording-<stage>` with a HYPHEN, because the key alphabet is not the
  // tool's (contract-dictation-registry.mjs parses a grant as /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/), and a
  // build that minted `recording_blind_frame` must be RED here rather than re-admitted by an expectation
  // that followed the rename. Import the key set and this test would compare gather-config with itself.
  const RECORDING_KEYS = new Set(Object.keys(RECORDING_STAGES).map((s) => `recording-${s}`));
  // The gather half is LITERAL for the same reason, and is that defect having already happened once:
  // the register surface is provider-neutral, so the active vendor mounts under `register` whatever sits
  // behind it, and an expectation derived from gather-config would carry a `register`→`corsearch` rename
  // into itself and stay green. An independent expectation is the only kind a pin can be. A new gather
  // group is one hand-written row here. The case-law bridges (`courtlistener`/`legaldatahunter`) and the
  // `fetch` shim are deliberately ABSENT: case-law does not run on this product and the assertion above
  // says so, so one of those keys appearing here is a change in what this fixture runs, not a new server.
  // — `declination` joins the neutral gather keys beside `coverage`, its exact sibling: one typed
  // transport, one key, one holding stage (synthesis), no vendor and no retrieval behind it. The list is
  // hand-written on purpose (see the block above), so a new key lands here as a deliberate row.
  // — `dispositions` joins them, and it is the first row here added by a tool MOVING rather than
  // arriving: `record_dispositions` rode the `perplexity` key, which four stages hold, so three of them
  // were granted a writer into the common-law lane's ruling ledger that no doctrine of theirs orders.
  // Same neutral shape as its two siblings — one typed transport, one key, no vendor and no retrieval
  // behind it — and the codex lane picks the split up for free because this config is rendered from
  // gather-config. That is exactly why the row is hand-written: a derived list would have followed the
  // change silently and this fixture would have proved nothing about it.
  // — `unit-note` joins them, the fourth typed transport on its own key and the
  // first that MOVES an artifact rather than adding a side-channel: register-units/<axis>.md becomes the
  // driver's. Same neutral shape as the three above — one tool, one key, no vendor and no retrieval behind
  // it — which is what this list is actually about. It is NOT a recording key, deliberately: the stage
  // keeps a legitimate seat write (the lane-off band, live for a matter with no Nice classes) and every
  // RECORDING row declares `seatWrites: false`. Hand-written for the reason stated above: a derived list
  // would have followed the change silently and this fixture would have proved nothing about it.
  const NEUTRAL_GATHER_KEYS = new Set(["perplexity", "register", "band", "coverage", "declination", "dispositions", "unit-note"]);
  for (const call of mcpTurns) {
    const keys = serverKeysOf(call);
    for (const k of keys)
      assert.ok(NEUTRAL_GATHER_KEYS.has(k) || RECORDING_KEYS.has(k),
        `codex config mounted the unrecognised MCP server key "${k}" — a gather key is one of `
        + `[${[...NEUTRAL_GATHER_KEYS].join(", ")}] and a recording key one of [${[...RECORDING_KEYS].join(", ")}]`);
    // Kept as its own assertion rather than left to the allowlist, and run over the WHOLE config text
    // rather than over the parsed keys: this is the property in its own words, and it does not depend on
    // the header regex above being the only way a vendor name can reach a codex config.
    assert.ok(!/mcp_servers\.(corsearch|clarivate|signa|euipo|uspto-local|free-tier)\b/.test(call.configToml),
      `no vendor-named MCP server key may reach a codex config — the register surface is provider-neutral (keys: ${keys.join(", ")})`);
    // PER SERVER, counted, and the count is the whole point: the old form matched `enabled_tools = [`
    // ONCE anywhere in the file, so a second server mounted beside a filtered one satisfied it while
    // codex enabled every tool that server serves. `enabled_tools` is only emitted for a server with a
    // granted tool, so header count == enabled_tools count is exactly "no server was mounted unfiltered".
    assert.equal((call.configToml.match(/^enabled_tools = \[/gm) || []).length, keys.length,
      `every mounted server sets its own enabled_tools — codex enables ALL of a server's tools without it (keys: ${keys.join(", ")})`);
    assert.equal(call.hasAuth, false, "api-key mode → no auth.json seeded into CODEX_HOME");
  }

  // BOTH HALVES PRESENT, which is what makes the run ordering-independent rather than merely unobserved:
  // a recording turn and a gather turn are BOTH in this run and both were judged by the loop above,
  // whichever of them the scheduler flushed first.
  const recordingTurns = mcpTurns.filter((c) => serverKeysOf(c).every((k) => RECORDING_KEYS.has(k)));
  const gatherTurns = mcpTurns.filter((c) => serverKeysOf(c).some((k) => !RECORDING_KEYS.has(k)));
  assert.ok(recordingTurns.length, "no turn mounted a recording server — the admission clause above is untested and #1166's ordering claim unproven");
  assert.ok(gatherTurns.length, "no gather stage rendered [mcp_servers] into config.toml");
  //: this regex USED TO READ /(perplexity|corsearch|euipo)/ and was matching on `euipo` — the
  // credential-blind side mount. Neither `corsearch` nor `euipo` was ever a valid server KEY: the
  // register surface is provider-neutral, so the active provider mounts under `register` whatever
  // vendor sits behind it. The old regex would have gone green on a build that mounted a vendor-named
  // key, which is the thing gather-config.mjs's own comment forbids.
  for (const call of gatherTurns)
    assert.match(call.configToml, /mcp_servers\.(perplexity|register|band)\b/,
      "gather config carries the wrapped MCP servers under NEUTRAL keys");

  // THE ANCHOR, and the only assertion here not derived from the config text it judges. The partition
  // above classifies a turn by the keys it carries, so on its own it cannot tell "blind-frame mounts its
  // record server under the neutral key" from "blind-frame mounts nothing" — the second produces one
  // fewer recording turn, not a failure. This names the stage INDEPENDENTLY, by the skill doc only its
  // own dispatch reads, and then requires the key.
  const blindFrameTurn = codexCalls.find((c) => /\/driver\/skills\/blind-frame\/SKILL\.md/.test(c.prompt || ""));
  assert.ok(blindFrameTurn, "blind-frame ran on the openai engine");
  assert.ok(recordingTurns.includes(blindFrameTurn), "blind-frame's turn mounts a recording server and nothing else");
  assert.match(blindFrameTurn.configToml, /^\[mcp_servers\.recording-blind-frame\]$/m,
    "…under the key recordingKey() mints for it — hyphens, the grant grammar's alphabet");

  // Handoff mode: no notify gateway stages, comms did NOT run through the compute engine, packet + sentinel written.
  assert.ok(!order.includes("notify") && !order.includes("notify-chat"), "no notify gateway stages in handoff mode");
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.equal(packet.verdict, "CLEAR");
  // — the packet subject is DERIVED from the run's own frozen policy row (deliverySubject over
  // reportIdentityFor), not spelled by hand. This fixture resolves to the worldwide clearance product,
  // so the subject names it — the end-to-end proof that the resolver reaches the delivery surface.
  assert.match(packet.subject, /^Global preliminary search — PROJECT NOVAPULSE$/);
  assert.doesNotMatch(packet.subject, /Preliminary clearance/, "the retired literal is gone from the wire");
  const sentinel = JSON.parse(readFileSync(join(res.runDir, ".delivered"), "utf8"));
  assert.equal(sentinel.sendPending, true, ".delivered marks sendPending for the integrator's watch");
});

test("E2(openai): an api-key billing mode with no key is REFUSED AT THE DOOR (named auth error, before a run dir exists)", async () => {
  // The provable-billing guarantee at the PIPELINE level: a mode that claims API billing but has no key does
  // NOT silently run. That guarantee is unchanged and still asserted below — the NAMED error, never a
  // generic failure, and nothing delivered.
  //
  // WHERE it is enforced MOVED, and that is a decision records rather than a fixup (see the PR): the
  // engine-turn door calls resolveAuthMode before buildRunContext, so the refusal now lands one door
  // earlier than the stage that used to raise it. What changes: the run no longer builds a directory, a
  // frozen profile and a status sidecar in order to fail, and there is therefore no `_driver/failure.json`
  // and no failure NOTICE for a fault nobody outside this box can act on. What stays: an operator sees the
  // exact variable to set, and preflightCredentials — the register-credential door two lines above — has
  // behaved this way since doc-27, so this is the shipped shape of a door refusal rather than a new one.
  await assert.rejects(() => runOpenaiPipeline({ CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "" }), (e) => {
    assert.match(e.message, /^\[preflight\] /, "it wears the same prefix as its refusing siblings");
    assert.match(e.message, /CODEX_API_KEY is not set/, "the refusal carries the NAMED auth error — never a silent mis-bill");
    assert.match(e.message, new RegExp(`CLEAROTRON_AI_BILLING=subscription`), "…and the two ways out");
    return true;
  });
  // "Before a run directory exists" is the whole property, so it is asserted from the filesystem and not
  // from the message. The whole ROOT is listed rather than one guessed path checked absent: a run dir sits
  // two levels down (<root>/workspace-clawdi/studio/prelim-search/…), so a path guessed at the top would
  // read as absent whatever the door did. `prelim-run-locks` is the run slot `pipeline()` takes before
  // `pipelineInner` runs; a run that got past the door would put `workspace-clawdi` beside it.
  assert.deepEqual(readdirSync(lastRoot), ["prelim-run-locks"],
    "a refused run leaves no run directory, no frozen profile and no status sidecar behind");
});
