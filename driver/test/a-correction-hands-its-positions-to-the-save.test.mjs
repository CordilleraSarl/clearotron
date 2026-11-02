// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CORRECTION HANDS ITS POSITIONS TO THE SAVE, AND NOTHING ELSE DOES.
//
// The writer's save may add the finding for an excluded position a correction's flags name, and only during that
// correction (ruled 2026-11-02). The positions ride the correction's own dispatch: the driver puts them into the tool
// servers' env for that dispatch, which its retries share, and the save tool's server reads them there, never from
// the payload. These arms follow them through each seam: the stage ladder's server config on the Claude engine, the
// Codex engine's rendered config, the save tool's server answering a call, the retry wording, and the pipeline's own
// dispatch sites, where the first correction and its follow-up hand them on and no other synthesis dispatch does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { buildGatherMcpConfig, toolGroupsForStage, correctionPositionsFrom, CORRECTION_POSITIONS_ENV } from "../engine/mcp/gather-config.mjs";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";
import { recordSynthesis, FINDINGS_FILE } from "../synthesis-record.mjs";
import { appendDeclinations } from "../declination-tool.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "correction-positions-locks-"));
const { runStage, correctiveMessage, warmPatchMessage, CORRECTION_ROWS, REPLACED_ROWS } = await import("../gateway.mjs");

const dirs = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const POSITIONS = ["/mark/us/94000004"];
const SAVE_SERVER = "recording-synthesis";

test("the writer's dispatch carries a correction's positions to the save tool's server on both engines, and none otherwise", () => {
  const groups = toolGroupsForStage("synthesis");
  const wired = (opts) => buildGatherMcpConfig(groups, { sessionKey: "k", agent: "a", runDir: "/RUN", ...opts });
  const env = (cfg) => cfg?.mcpServers?.[SAVE_SERVER]?.env ?? null;
  assert.ok(env(wired({})), `premise: the writer's dispatch has no ${SAVE_SERVER} server to hand them to`);
  assert.deepEqual(correctionPositionsFrom(env(wired({ correctionPositions: POSITIONS }))), POSITIONS, "the positions did not reach the save tool's server");
  for (const none of [{}, { correctionPositions: null }, { correctionPositions: [] }])
    assert.equal(env(wired(none))[CORRECTION_POSITIONS_ENV], undefined, `${JSON.stringify(none)}: a dispatch that is no correction's carried positions`);
  // Codex gives a server only its own env, so the rendered table must carry them.
  const table = (opts) => renderCodexConfigToml({ mcpConfig: JSON.stringify(wired(opts)), allowedTools: "" }).split(/\n(?=\[)/)
    .find((t) => t.startsWith(`[mcp_servers.${SAVE_SERVER}]`) || t.startsWith(`[mcp_servers."${SAVE_SERVER}"]`));
  assert.ok(table({}), "premise: the Codex config has no save tool server");
  assert.match(table({ correctionPositions: POSITIONS }), new RegExp(`env = \\{[^\\n]*${CORRECTION_POSITIONS_ENV} = "\\[\\\\"/mark/us/94000004\\\\"\\]"`),
    "the Codex engine's save tool server is not handed the positions");
  assert.doesNotMatch(table({}), new RegExp(CORRECTION_POSITIONS_ENV), "the Codex engine's server carried positions on a dispatch that is no correction's");
});

test("a server handed no positions, or ones it cannot read, reads no correction", () => {
  for (const v of [undefined, "", "null", "{}", "[]", "[1]", "not json", "\"/mark/us/94000004\""])
    assert.equal(correctionPositionsFrom(v === undefined ? {} : { [CORRECTION_POSITIONS_ENV]: v }), null, `${v} read as a correction's positions`);
});

test("on the Claude engine, a stage ladder carrying a correction hands its positions to the save tool's server, and one carrying none does not", async () => {
  const dir = tempDir("correction-positions-ladder-");
  mkdirSync(driverDir(dir), { recursive: true });
  const out = join(dir, "out.md"), calls = join(dir, "calls.jsonl");
  const env = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_FILE: "a stub the validator accepts\n",
    MOCK_OUT_FILE: out, MOCK_CLAUDE_CALL_LOG: calls, MOCK_COUNT_FILE: join(dir, "count"), CLEAROTRON_RETRY_BACKOFF_MS: "0" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v);
  try {
    for (const correction of [{ positions: POSITIONS }, null]) {
      const res = await runStage("synthesis", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `correction-positions-${correction ? "on" : "off"}`,
        runDir: dir, expectFile: out, maxRetries: 0, timeoutSec: 30, ...(correction ? { correction } : {}) });
      assert.equal(res?.ok, true, `the stand-in turn did not complete: ${JSON.stringify(res).slice(0, 300)}`);
    }
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else pinEnv(process.env, k, v); } }
  const configs = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l).argv).map((argv) => JSON.parse(argv[argv.indexOf("--mcp-config") + 1]));
  assert.equal(configs.length, 2, "one turn per ladder");
  assert.deepEqual(correctionPositionsFrom(configs[0].mcpServers[SAVE_SERVER].env), POSITIONS, "the correction's turn did not hand its positions to the save");
  assert.equal(configs[1].mcpServers[SAVE_SERVER].env[CORRECTION_POSITIONS_ENV], undefined, "a turn that is no correction's handed positions to the save");
});

test("a correction's retries say the save may add the finding, and every other retry says it replaces", () => {
  const files = [join(tempDir("correction-positions-retry-"), "narrative.md")];
  mkdirSync(driverDir(dirname(files[0]), "synthesis-calls"), { recursive: true });
  writeFileSync(driverDir(dirname(files[0]), "synthesis-calls", "accepted.json"), "{}\n");
  const fail = `invalid_file:${files[0]}:finding_meter_unknown:1`;
  for (const [what, text] of [["a fresh retry", (adds) => correctiveMessage("the base", 2, fail, files, { adds })],
    ["a warm patch", (adds) => warmPatchMessage(fail, files, { adds })]]) {
    assert.ok(text(true).includes(CORRECTION_ROWS) && !text(true).includes(REPLACED_ROWS), `${what} of a correction`);
    assert.ok(text(false).includes(REPLACED_ROWS) && !text(false).includes(CORRECTION_ROWS), `${what} of any other dispatch`);
  }
});

// ── THE SAVE TOOL'S SERVER READS THE POSITIONS FROM ITS ENV ──────────────────────────────────────────────────────

/** Ask the save tool's server, started as the driver starts it for one dispatch, to take `args`. */
function callSave(runDir, args, extraEnv = {}) {
  const script = join(HERE, "..", "engine", "mcp", "recording-server.mjs");
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, ...extraEnv };
    if (!(CORRECTION_POSITIONS_ENV in extraEnv)) delete env[CORRECTION_POSITIONS_ENV];
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "ignore"], env });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server.mjs did not answer tools/call — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(JSON.parse(m.result?.content?.[0]?.text ?? "null"));
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "correction-positions", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "record_synthesis", arguments: args } });
  });
}

test("the save tool's server adds the finding when its dispatch handed it the position, and refuses it otherwise", async () => {
  const OWNERS = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"], ["Brannick Tooling", "ORVANTE"]];
  const uri = (i) => `/mark/us/9400000${i + 1}`;
  const finding = (i, ordinal = i + 1) => {
    const f = structuredClone(JSON.parse(synthesisFindings(null)).findings[0]);
    f.ordinal = ordinal; [f.owner.name, f.mark] = OWNERS[i]; f.owner.registrations[0].uri = uri(i);
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = uri(i);
    return f;
  };
  const NARRATIVE = { spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first.",
    verdict: "The identical registration in the searched class drives the read.", coverage: { read: "The instructed registers were enumerated on the named band." } };
  const dir = tempDir("correction-positions-server-");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ schema_version: 1, rows: OWNERS.map(([owner, mark], i) => ({ uri: uri(i), mark, owner, tier: "headline-candidate" })) }) + "\n");
  appendDeclinations(dir, [{ uri: uri(3), reason: "unrelated-goods", grounds: "An invented ground for the exclusion." }]);
  assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: { ...JSON.parse(synthesisFindings(null)), findings: [0, 1, 2].map((i) => finding(i)) } }).refused, null);
  const call = { findings: { corrections: { applied: true, note: "ORVANTE: recorded as a finding" } }, findings_patch: [finding(3, 4)] };
  const before = readFileSync(join(dir, FINDINGS_FILE), "utf8");
  const refused = await callSave(dir, call);
  assert.match(String(refused?.refused), /^synthesis_patch_ordinal_unknown:4 — /, "a server handed no positions took the addition");
  assert.equal(readFileSync(join(dir, FINDINGS_FILE), "utf8"), before, "a refused addition changed the record");
  const added = await callSave(dir, call, { [CORRECTION_POSITIONS_ENV]: JSON.stringify([uri(3)]) });
  assert.equal(added?.refused, null, `a server handed the position refused the addition: ${added?.refused}`);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8")).findings.map((f) => f.ordinal), [1, 2, 3, 4]);
});

// ── THE PIPELINE HANDS THEM ON AT THE CORRECTION'S OWN DISPATCHES, AND AT NO OTHER ───────────────────────────────

test("the first correction and its follow-up hand on the positions; the correction after a repair's review and every other writer dispatch do not", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  // Every writer dispatch the pipeline makes, by its trigger.
  const dispatches = [...src.matchAll(/stage\("synthesis", ctx, \{([\s\S]*?)\}\);/g)].map((m) => m[1]);
  const trigger = (d) => /trigger: "([^"]+)"/.exec(d)?.[1] ?? null;
  const carrying = dispatches.filter((d) => /\bcorrection\b/.test(d)).map(trigger).sort();
  assert.deepEqual(carrying, ["corrective", "corrective-findings"], "a writer dispatch other than the correction's hands on positions, or the correction's does not");
  assert.ok(dispatches.some((d) => trigger(d) === "post-repair-corrective" && !/\bcorrection\b/.test(d)), "premise: the correction after a repair's review was not found");
  // The follow-up hands them on only where its caller gave them: the first correction does, the one after a repair's review does not.
  const callers = [...src.matchAll(/await enforceCorrectionsReachFindings\(([^;]*)\);/g)].map((m) => m[1]);
  assert.equal(callers.length, 2, "the follow-up's callers moved");
  assert.deepEqual(callers.map((c) => /\bcorrection\b/.test(c)), [false, true], "the correction after a repair's review hands positions to the follow-up, or the first correction does not");
  assert.match(src, /const reading = correctionReading\(P\);\s*const correction = \{ positions: reading\.positions \};/,
    "the positions the correction is handed are not the ones its message names");
});
