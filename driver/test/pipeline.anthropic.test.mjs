// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the full pipeline on the production engine shape
// E2 — the $0 mock pipeline runs END-TO-END on CLEAROTRON_AI=anthropic-agent (claude -p, mocked). Proves
// all 14 stages flow through the anthropic engine with the SAME shared fixtures as the gateway-bin path:
// the engine swap is structurally transparent (REASONING parity is the separate paid A/B). Comms run in
// handoff mode — the headless default, asserted below: no notify gateway stage runs, and the driver
// writes a self-contained delivery packet instead of pinging one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { RECORDING_TOOLS, seatWritesForGroups, SEAT_WRITE_FREE_STAGES } from "../engine/mcp/gather-config.mjs";
import { runDirGrant } from "../engine/anthropic-agent.mjs";
import { PROBE_PROMPT } from "../engine/probe.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_MOCK = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE_MOCK, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-anth", msgId: "<test-anth@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function runAnthropicPipeline(env = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-anth-"));
  const claudeLog = join(root, "claude-calls.jsonl");
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent",       // stage compute on claude -p (mocked)
    CLEAROTRON_CLAUDE_PATH: CLAUDE_MOCK,
    MOCK_CLAUDE_CALL_LOG: claudeLog,        // proves the stages actually went through the anthropic engine
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const turns = existsSync(claudeLog) ? readFileSync(claudeLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  // — the RUN DOOR spends one cheap turn proving the engine before a run dir exists, so the call log
  // now opens with a turn that is deliberately NOT a stage: no run dir, no skills tree, floor tier. It is
  // split out here rather than tolerated inside `claudeCalls`, because every assertion below is about what
  // a COMPUTE STAGE carries and a probe that slipped into that population would weaken all of them. The
  // partition is on the probe's own exported prompt — an identity, not a heuristic over the log's shape.
  const doorProbe = turns.find((c) => (c.prompt || "").trim() === PROBE_PROMPT) ?? null;
  const claudeCalls = turns.filter((c) => c !== doorProbe);
  return { res, events, claudeCalls, doorProbe, turns };
}

test("E2: full pipeline runs on the anthropic-agent engine (CLEAR, delivered, all stages via claude -p)", async () => {
  const { res, events, claudeCalls, doorProbe, turns } = await runAnthropicPipeline();
  assert.equal(res.ok, true, JSON.stringify(res));

  // — the engine-turn door fired, FIRST, and it is a probe rather than a stage: the floor tier, the
  // probe's own six-word prompt, no MCP config and no granted directory (there is no run dir yet — that
  // is the property the door exists to have). A run that reached stage one without this turn has an
  // engine nobody proved.
  assert.equal(turns[0], doorProbe, "the engine-turn probe is the FIRST turn of the run, ahead of matter-frame");
  assert.deepEqual(doorProbe.argv.slice(5, 9), ["--model", "haiku", "--effort", "low"], "the door spends the cheapest turn either adapter can build");
  assert.ok(!doorProbe.argv.includes("--add-dir"), "the door grants no directory — it runs before one exists");
  assert.ok(!doorProbe.argv.includes("--mcp-config"), "and starts no MCP server");
  const probeRow = events.find((e) => e.event === "engine-turn-probe");
  assert.ok(probeRow?.ok === true && probeRow.basis === "completed-turn", `the door's verdict is on the run record: ${JSON.stringify(probeRow)}`);
  assert.equal(res.verdict, "CLEAR");
  assert.ok(existsSync(join(res.runDir, ".delivered")), ".delivered sentinel present");

  const order = events.filter((e) => e.event === "stage").map((e) => e.stage);
  const idx = (s) => order.findIndex((x) => x.startsWith(s));
  // same ordering invariants as the gateway-bin happy path → the engine swap is transparent
  assert.ok(idx("matter-frame") >= 0 && idx("matter-frame") < idx("prelim-variants"), "matter-frame before variants");
  assert.ok(idx("prelim-variants") < idx("common-law"), "variants before gather");
  assert.ok(idx("skeptic") < idx("synthesis"), "skeptic before synthesis");
  assert.ok(idx("synthesis") < idx("narrative-refutation"), "synthesis before refutation");
  assert.ok(idx("narrative-refutation") < idx("report-overview"), "report-overview after refutation");
  for (const ax of ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"])
    assert.ok(order.includes(`register-unit:${ax}`), `axis ${ax} ran on anthropic`);
  // — REWRITTEN. This job's product does not carry the case-law reading, so the detector records and
  // does not execute. The engine under test is irrelevant to that decision, which is the point: the gate
  // is on the PRODUCT, not on how the stage would have been dispatched.
  assert.ok(!order.includes("case-law"), "case-law does not run on a product that does not sell it (#519)");
  assert.ok(events.some((e) => e.event === "verdict" && e.verdict === "CLEAR"), "CLEAR verdict recorded");

  // PROOF the compute stages went through claude -p (not a silent second-exec fallback): the mock-claude
  // call-log has many `-p` invocations, each carrying the streaming flags the engine builds. The prompt
  // rides STDIN now (E2BIG fix), so the log records { argv, prompt } — flags on argv, text on prompt.
  assert.ok(claudeCalls.length >= 8, `expected ≥8 claude -p stage turns, got ${claudeCalls.length}`);
  const first = claudeCalls[0];
  assert.equal(first.argv[0], "-p", "claude invoked in print mode");
  assert.ok(first.argv.includes("--output-format") && first.argv.includes("stream-json"), "stream-json requested");
  assert.ok(first.argv.includes("--include-partial-messages"), "partial messages (the watchdog heartbeat) requested");

  // PATH-RESOLUTION FIX (2026-06-16): EVERY compute turn must (a) carry the two --add-dir roots — the
  // agent's skills tree + this run's dir (claude -p file tools are confined to cwd+add-dir) — and (b) have
  // its skill refs absolutized: no bare `skills/…md` token survives into the prompt (claude -p
  // cwd=tmpdir cannot resolve workspace-relative paths; that was the matter-frame blocker).
  const BARE_SKILL_REF = /(?<![\w/.])skills\/[A-Za-z0-9._/-]+\.md/;
  const RUN_DIR_RE = /\/studio\/prelim-search\//;
  for (const call of claudeCalls) {
    const msg = call.prompt || "";
    assert.ok(!BARE_SKILL_REF.test(msg), `a stage prompt kept a workspace-relative skills ref: ${msg.match(BARE_SKILL_REF)?.[0]}`);
    const addDirs = call.argv.reduce((acc, a, i) => (a === "--add-dir" ? [...acc, call.argv[i + 1]] : acc), []);
    assert.ok(addDirs.some((d) => d && d.endsWith("/skills")), "compute turn grants --add-dir on the skills tree");
    // — THE RUN-DIR GRANT IS EARNED NOW, so this asserts the RULE rather than a constant. A turn
    // whose tool groups ALL declare `seatWrites:false` records through its MCP server and authors no file,
    // so it is handed no writable run root; every other turn still gets one. Both sides are read off the
    // run that actually happened — the expectation from `runDirGrant` (the builder's own predicate, fed
    // the argv's declared groups and the real dispatch), the observation from argv — so a DRIFT between
    // what a stage declares and what it is handed fails HERE. Asserting `some(...)` as before would have
    // gone on passing while the grant it names quietly stopped being universal.
    const cfgAt = call.argv.indexOf("--mcp-config");
    let groups = [];
    if (cfgAt >= 0 && call.argv[cfgAt + 1]) {
      try { groups = Object.keys(JSON.parse(call.argv[cfgAt + 1])?.mcpServers ?? {}); } catch { groups = []; }
    }
    // The server key IS the group key for the recording groups (buildGatherMcpConfig keys mcpServers by
    // the group's local entry), and that equivalence is what lets argv stand in for the group list. Guard
    // it: a rename that broke it would otherwise make every turn look like it earns the root.
    for (const g of groups) {
      if (!g.startsWith("recording-")) continue;
      assert.ok(SEAT_WRITE_FREE_STAGES.includes(g.slice("recording-".length)),
        `recording server key ${g} names no known seat-write-free stage — the argv→group equivalence broke`);
    }
    const runDirOf = (a) => { const i = a.indexOf("--mcp-config"); if (i < 0) return null;
      try { for (const s of Object.values(JSON.parse(a[i + 1])?.mcpServers ?? {})) if (s?.env?.CLEAROTRON_BAND_RUN_DIR) return String(s.env.CLEAROTRON_BAND_RUN_DIR); } catch { /* none */ } return null; };
    const expected = runDirGrant({ runDir: runDirOf(call.argv), dispatch: msg, seatWrites: seatWritesForGroups(groups) }).grant;
    const hasRunDir = addDirs.some((d) => d && RUN_DIR_RE.test(d));
    assert.equal(hasRunDir, expected,
      `run-dir grant disagrees with the declaration for groups [${groups.join(", ")}]: argv granted=${hasRunDir}, rule says=${expected}`);
  }
  assert.match(first.prompt, /\/driver\/skills\/matter-frame\/SKILL\.md/, "matter-frame skill ref absolutized to the driver's skills tree (config.skillsDir; Phase-3 repoint off the agent workspace)");

  // E3: per-stage tool selection — gather stages get the MCP servers + allowedTools; judgment stages stay
  // lean (no MCP, no tool-def bloat).
  //
  // CONVERSION 2 FLIPPED THE FIRST STAGE, and this is THE argv-level assertion the category's own comment
  // demanded: "the first stage to enter this category gains --mcp-config, --strict-mcp-config AND
  // --allowedTools where it previously had none. That is a change in KIND … but it must be asserted at the
  // argv level, not inferred from this map." matter-frame is a RECORDING stage now, so it is tooled — and
  // what has to stay true is that it gained the RECORDING surface and no retrieval server.
  assert.ok(first.argv.includes("--mcp-config"), "matter-frame is a recording stage now — it carries an MCP config");
  assert.ok(first.argv.includes("--strict-mcp-config"), "…and the strict flag, so the mount is exactly the declared one");
  const firstAllowed = first.argv[first.argv.indexOf("--allowedTools") + 1] ?? "";
  assert.match(firstAllowed, /mcp__recording-matter-frame__record_matter_frame/, "its record tool is granted");
  assert.match(firstAllowed, /mcp__recording-matter-frame__search_run_artifacts/, "…and the Class 2 read surface");
  assert.ok(!/mcp__(register|perplexity|band|coverage|courtlistener|legaldatahunter)__/.test(firstAllowed),
    "and NO retrieval server — the recording category's provable promise is that it does not widen that surface");
  assert.ok(!/(^|,)(Write|Edit)(,|$)/.test(firstAllowed),
    "seatWrites:false — the driver renders the frame, so the hand-write tools are gone from the grant");
  // review — "THE FIRST CALL WITH --mcp-config" IS NO LONGER A GATHER STAGE, and this assertion
  // failed on macOS while passing on Linux for exactly that reason. The RECORDING category (blind-frame,
  // then skeptic) gives a stage `--mcp-config` + `--allowedTools` carrying ONLY its own record tool and
  // NO retrieval namespace. So `find` could return blind-frame, and the specimen says it did:
  //   actual: 'Read Write Edit mcp__recording-blind-frame__record_blind_frame'
  // Whether it bit was a matter of which call landed first in the log — main was green by luck, and every
  // branch was exposed. A category that adds a new argv SHAPE invalidates every selector written when
  // there was only one shape.
  //
  // The partition is read off the SHIPPED DECLARATION (RECORDING_TOOLS), not off the property under test:
  // selecting the call that already carries a retrieval namespace would make the assertion vacuous.
  const mcpCalls = claudeCalls.filter((a) => a.argv.includes("--mcp-config"));
  assert.ok(mcpCalls.length, "at least one stage received --mcp-config");
  const allowedOf = (c) => c.argv[c.argv.indexOf("--allowedTools") + 1] || "";
  const recordingGrants = new Set(Object.values(RECORDING_TOOLS).map((ts) => [...ts].sort().join(" ")));
  const isRecording = (c) => recordingGrants.has(allowedOf(c).split(/\s+/).filter(Boolean).sort().join(" "));
  const gatherCalls = mcpCalls.filter((c) => !isRecording(c));
  // NON-VACUITY: the partition only protects anything if a RECORDING call is actually in this population.
  // Without this, a run that mounted no recording stage would exercise none of the logic above and the
  // selector would look order-proof because there was nothing to mis-select.
  assert.ok(mcpCalls.some(isRecording),
    `no RECORDING grant appeared among the --mcp-config calls, so this partition proved nothing (${mcpCalls.map(allowedOf).join(" | ")})`);
  assert.ok(gatherCalls.length, `every --mcp-config call looks like a RECORDING grant — no gather stage was mounted at all (${mcpCalls.map(allowedOf).join(" | ")})`);
  const gatherCall = gatherCalls[0];
  assert.ok(gatherCall.argv.includes("--strict-mcp-config"), "gather stage uses --strict-mcp-config");
  const allowed = allowedOf(gatherCall);
  //: the sibling of pipeline.openai.test.mjs's server-key check, and it failed the same way —
  // this regex was matching on `mcp__euipo__`, the credential-blind side mount. `corsearch` was never
  // a valid namespace either: the register surface is provider-neutral, so every register tool is
  // `mcp__register__register_*` whatever vendor sits behind it.
  assert.match(allowed, /mcp__(perplexity|register|band)__/, "gather allowedTools carry the wrapped tools under NEUTRAL namespaces");
  assert.ok(!/mcp__(corsearch|clarivate|signa|euipo|uspto-local|free-tier)__/.test(allowed),
    "no vendor-named tool namespace may reach an allowedTools list");

  // Handoff mode: on the anthropic engine the driver does NOT run the notify/notify-chat gateway stages —
  // it writes a self-contained delivery packet for clawdi to send off (driver stays 100% gateway-fraw-free).
  assert.ok(!order.includes("notify") && !order.includes("notify-chat"), "no notify gateway stages in handoff mode");
  assert.ok(!claudeCalls.some((a) => /notify-receipt|notify-chat|clawdi_send|channel \"whatsapp\"/.test(a.prompt || "")), "comms did NOT run through the compute engine");
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.equal(packet.forwarder, "requester");
  assert.equal(packet.verdict, "CLEAR");
  // — the packet subject is DERIVED from the run's own frozen policy row (deliverySubject over
  // reportIdentityFor), not spelled by hand. This fixture resolves to the worldwide clearance product,
  // so the subject names it — the end-to-end proof that the resolver reaches the delivery surface.
  assert.match(packet.subject, /^Global preliminary search — PROJECT NOVAPULSE$/);
  assert.doesNotMatch(packet.subject, /Preliminary clearance/, "the retired literal is gone from the wire");
  assert.ok(packet.emailBodyHtml && packet.emailBodyHtml.length > 0, "email body embedded for clawdi");
  assert.match(packet.whatsappText, /Prelim search for PROJECT NOVAPULSE.*is done\. Report:/);
  assert.equal(packet.whatsappTo, "+10000000001");
  const sentinel = JSON.parse(readFileSync(join(res.runDir, ".delivered"), "utf8"));
  assert.equal(sentinel.sendPending, true, ".delivered marks sendPending for clawdi's watch");
});

// ── PR-8 (reading layer) — the wiring proof, end to end on the mock engine ─────────────────────────
// One full mock run, then assert from the OUTSIDE (call log + run dir): the band-consuming judgment
// stages carry the band server (and synthesis carries NO live register server), the prompts stopped
// naming the raw band path, the shape artifacts are derived, and the audit carries # Reading audit.
// NO env kill switch exists for any of this — the machinery ships built and on (retired doctrine).
test("PR-8 e2e: band tools wired per stage, register dropped from synthesis, shape derived, reading audit rendered", async () => {
  const { res, events, claudeCalls } = await runAnthropicPipeline();
  assert.equal(res.ok, true, JSON.stringify(res));

  const stageCall = (re) => claudeCalls.find((c) => re.test(c.prompt || ""));
  const mcpOf = (c) => { const i = c.argv.indexOf("--mcp-config"); return i >= 0 ? JSON.parse(c.argv[i + 1]) : null; };
  const allowedOf = (c) => { const i = c.argv.indexOf("--allowedTools"); return i >= 0 ? (c.argv[i + 1] || "") : ""; };

  const digest = stageCall(/register DIGEST mode/);
  const placement = stageCall(/placement-inquiry\/SKILL\.md/);
  const synthesis = stageCall(/MACHINE FINDINGS \(MANDATORY\)/);
  const refutation = stageCall(/Adversarially refute the narrative/);
  assert.ok(digest && placement && synthesis && refutation, "all four band-consuming stages ran");

  // grants: digest/placement = band only; refutation = band + perplexity since; synthesis =
  // perplexity + band. NO live register on any of them — that is the invariant this block protects, and
  // it is asserted for every one of the four rather than folded into the "band only" phrasing.
  //
  // — narrative-refutation moved out of the band-only set. Its served doctrine orders one scoped
  // `perplexity_research` probe, and on a delivered production run it ran nineteen minutes unable to make
  // the call, with nothing recording a denial. Third place this grant was pinned; the other two are
  // engine.gather.test.mjs and contract-dictation.test.mjs. All three read the same grant table.
  const BAND_ONLY = new Set(["register-digest", "placement-inquiry"]);
  for (const [name, c] of [["register-digest", digest], ["placement-inquiry", placement], ["narrative-refutation", refutation]]) {
    const cfg = mcpOf(c);
    assert.ok(cfg?.mcpServers?.band, `${name} mounts the band server`);
    assert.ok(!cfg.mcpServers.register, `${name} must not mount the live register server`);
    assert.equal(Boolean(cfg.mcpServers.perplexity), !BAND_ONLY.has(name),
      `${name}: perplexity is mounted exactly for the stages whose doctrine orders a probe (#865)`);
    // res.runDir is the ARCHIVED path (the run moved after delivery); the live run dir shares its
    // <slug>/<date-codename> leaf — that identity is what proves the server served THIS run.
    const leaf = res.runDir.split("/").slice(-2).join("/");
    assert.ok(cfg.mcpServers.band.env.CLEAROTRON_BAND_RUN_DIR.endsWith(`/${leaf}`), `${name}'s band server serves THIS run (${leaf})`);
    assert.match(allowedOf(c), /mcp__band__band_lookup/, `${name} allow-lists the band tools`);
  }
  const synthCfg = mcpOf(synthesis);
  assert.ok(synthCfg?.mcpServers?.band && synthCfg?.mcpServers?.perplexity, "synthesis mounts perplexity + band");
  assert.ok(!synthCfg.mcpServers.register && !synthCfg.mcpServers.euipo,
    "synthesis holds NO live register server — new register work rides the supplemental mint, never the judgment seat");
  assert.ok(!/mcp__register__/.test(allowedOf(synthesis)), "no register_* tool on synthesis's allowlist");
  // the funnel keeps its live register tools — the reading layer never touched the search layer
  const unit = claudeCalls.find((c) => mcpOf(c)?.mcpServers?.register);
  assert.ok(unit, "register units still mount the live register server");

  // — AND THE REGISTER SERVER IS TOLD TO WRITE RECORD BODIES INTO THIS RUN.
  //
  // This is the caller side, and it is the half a unit test cannot reach. `serverEnv` reads
  // `runDir ? runRecordLogPath(runDir) : ledgerPath("record")`, and every unit test of it passes `runDir`
  // itself — so all of them stay green on a dispatch that never supplies one, while every real record
  // body goes to the box-global file the run does not read. The spawned register server is the DOMINANT
  // writer, so that would make the whole change inert and the only symptom would be a note in the log.
  // This asserts against a REAL pipeline dispatch: the argv the engine actually received.
  const unitLeaf = res.runDir.split("/").slice(-2).join("/");
  const unitRecordLog = mcpOf(unit).mcpServers.register.env.CLEAROTRON_REGISTER_RECORD_LOG;
  assert.ok(unitRecordLog.endsWith(`/${unitLeaf}/_driver/register-record-bodies.jsonl`),
    `the register unit's server writes record bodies into THIS run (${unitLeaf}), not the home directory: ${unitRecordLog}`);
  // …and the CALL ledger deliberately does NOT move with it: it is billing-grade, read across runs, and
  // it is the independent witness that makes an empty run-scoped record log reportable as a failure.
  assert.ok(!mcpOf(unit).mcpServers.register.env.CLEAROTRON_REGISTER_CALL_LOG.includes(unitLeaf),
    "the call ledger stays box-global — scoping it to the run would remove the only cross-check on the record log");

  // prompts stopped naming the raw band path (it stays a declared stage INPUT for freshness/machine
  // checks — but judgment is never pointed at the file again); they teach the band tools instead
  for (const [name, c] of [["register-digest", digest], ["placement-inquiry", placement], ["synthesis", synthesis]]) {
    assert.ok(!(c.prompt || "").includes("register-named-band.json"), `${name} prompt no longer names the raw band path`);
    assert.match(c.prompt || "", /band_shape/, `${name} prompt teaches the band tools`);
  }
  assert.ok(!/register tools you hold/.test(digest.prompt || ""), "the postmortem prompt/grant mismatch line is gone");
  // (the INSTRUCTED CHECKS → supplemental-mint routing needs a register-owned intake ask; asserted
  // on the message builder directly in the unit test below — this mock job carries no asks)

  // the shape is derived on disk (after the fan-in re-merge) + the floors carry the mock's identical mark
  const shape = JSON.parse(readFileSync(driverDir(res.runDir, "band-shape.json"), "utf8"));
  assert.ok(shape.totals.records > 0, "shape derived over the merged band");
  assert.ok(shape.floors.in_class_identical_or_near.some((f) => /NOVAPULSE/i.test(f.mark_text ?? "")),
    "the identical NOVAPULSE record is on the floors, individually");
  assert.ok(existsSync(join(res.runDir, "band-shape.md")), "the readable mirror exists for whole-file reads");
  assert.ok(events.some((e) => e.event === "band-shape-derived"), "derivation is on the run record");

  // the audit renders # Reading audit — the mock engine made no MCP calls, so the section shows the
  // honest zero rather than hiding the silence
  const audit = readFileSync(join(res.runDir, "audit.md"), "utf8");
  assert.ok(audit.includes("# Reading audit"), "audit.md carries the reading audit section");
  assert.match(audit, /no band lookups recorded this run/, "an unread band is disclosed, never hidden");
});

// PR-8 unit: with a register-owned intake ask, the digest dictation answers from the BAND and routes
// any genuinely new register query through the supplemental mint — never "the register tools you hold"
// (the stage holds none; that line ordered live searches from a tool-less stage).
test("PR-8: register-digest INSTRUCTED CHECKS answer from the band and route new queries via the mint", async () => {
  const { STAGES, paths } = await import("../stages.mjs");
  const P = paths("/r");
  const msg = STAGES["register-digest"].message({ paths: P, axes: ["primary-sweep"],
    intakeAsks: [{ ask: "check the owner's EU portfolio", owner: "register" }] });
  assert.match(msg, /INSTRUCTED CHECKS/);
  assert.match(msg, /band_shape \/ band_lookup \/ band_record/, "answers come from the frozen material");
  assert.match(msg, /supplemental mint/, "a check needing a new register query rides the mint (escalation lane)");
  assert.match(msg, /NO live register tools here — that is by design, never an outage/);
  assert.ok(!msg.includes("register tools you hold"), "the mismatch wording is dead");
  assert.ok(!msg.includes(P.registerNamedBand), "the raw band path is never named to the model");
});
