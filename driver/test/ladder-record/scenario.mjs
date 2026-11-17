// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scenario.mjs — one ladder scenario in its own process, run by ladder-record.mjs.
//
//   node scenario.mjs <repo> <scenario-id> <out.json> <scratch-root>
//
// Registers a scripted engine, drives runStage once with retries on, and writes what the ladder did: every turn's
// arguments, the stage rows, the run events, the files left in the run and the notes, with paths and clocks normalised.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SCENARIOS } from "./scenarios.mjs";

const [repo, id, out, root] = process.argv.slice(2);
const sc = SCENARIOS[id];
if (!sc) { console.error(`no scenario ${id}`); process.exit(2); }
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const runDir = join(root, "run");
mkdirSync(join(runDir, "_driver"), { recursive: true });

const env = {
  CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_RETRY_BACKOFF_MS: "0",
  CLEAROTRON_RECOVERY_MAX: "0", CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_DATABASE: "corsearch",
  CLEAROTRON_AI: "ladder-probe", ...(sc.env ?? {}),
};
for (const [k, v] of Object.entries(env)) process.env[k] = v;

const notes = [];
const origErr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => { notes.push(String(chunk)); return true; };

const GW = await import(pathToFileURL(join(repo, "driver/gateway.mjs")).href);
const OA = sc.stageHome ? await import(pathToFileURL(join(repo, "driver/engine/openai-agent.mjs")).href) : null;

const files = (sc.files ?? ["out.json"]).map((f) => join(runDir, f));
const calls = [];
let n = 0;
GW.registerEngine({
  name: "ladder-probe",
  ...(sc.engineProps ?? {}),
  ...(OA ? { makeStageHome: OA.openaiAgentEngine.makeStageHome, releaseStageHome: OA.openaiAgentEngine.releaseStageHome } : {}),
  async runTurn(opts) {
    const step = sc.steps[Math.min(n, sc.steps.length - 1)];
    n++;
    calls.push(opts);
    if (step.cancelAfter) writeFileSync(join(runDir, ".cancel"), JSON.stringify({ by: "test" }) + "\n");
    for (const [f, body] of Object.entries(step.write ?? {})) {
      const p = join(runDir, f);
      if (body === null) { rmSync(p, { force: true }); continue; }
      writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
      if (step.ageSec) { const t = (Date.now() / 1000) - step.ageSec; utimesSync(p, t, t); }
    }
    return {
      code: 0, killed: false, wall: 1, stdout: "", stderr: "", laneWaitMs: 0,
      json: { status: "ok", runId: `r${n}`, summary: "done" }, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      sessionRef: `sess-${n}`, signals: {}, reads: [], ...(step.turn ?? {}),
    };
  },
});

const validate = (f, text) => {
  let o;
  try { o = JSON.parse(text); } catch { return { ok: false, reason: "findings_unparseable" }; }
  if (o.ok === true) return { ok: true };
  return { ok: false, reason: String(o.reason ?? "findings_unknown"), ...(Number.isFinite(o.quantity) ? { quantity: o.quantity } : {}) };
};

let result, threw = null;
try {
  result = await GW.runStage(sc.stage ?? "ladder-stage", {
    agent: "mailagent", message: "Write out.json as asked.", model: sc.model ?? "sonnet", thinking: "low",
    sessionKey: "clearotron-ladder", timeoutSec: 100, runDir, expectFile: files, validate, maxRetries: sc.maxRetries ?? 2,
    ...(sc.opts ?? {}),
    ...(sc.refresh ? { refreshMessage: (a) => { if (sc.refresh === "throw") throw new Error("no state to recompose from"); return `Refreshed message for attempt ${a}.`; } } : {}),
  });
} catch (e) { threw = `${e?.name}: ${e?.message}`; }
process.stderr.write = origErr;

const H = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
const norm = (s) => String(s)
  .split(root).join("<ROOT>").split(repo).join("<REPO>")
  .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, "<TS>")
  .replace(/\b1[7-9]\d{11}\b/g, "<EPOCHMS>")
  .replace(/\b1[7-9]\d{8}\b/g, "<EPOCH>")
  .replace(/clearotron-codex-[A-Za-z0-9-]+/g, "<CODEXHOME>")
  .replace(/stage-[a-z-]+-[A-Za-z0-9]{6}\b/g, "<STAGEHOME>");
const normObj = (o) => JSON.parse(norm(JSON.stringify(o ?? null), (k, v) => v));
const DROP = new Set(["ts", "at", "time", "quiescentMs", "dispatchedAt", "settledAt", "startedAt", "endedAt", "elapsedMs", "durationMs", "sha", "dispatchSha"]);
const scrub = (o) => {
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).filter(([k]) => !DROP.has(k)).map(([k, v]) => [k, scrub(v)]));
  return o;
};
const jsonl = (p) => existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => scrub(normObj(JSON.parse(l)))) : null;

const walk = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];
const record = {
  id, threw: threw ? norm(threw) : null,
  result: scrub(normObj(result ?? null)),
  calls: calls.map((c) => scrub(normObj({
    sessionKey: c.sessionKey, message: c.message, grantDispatch: c.grantDispatch, model: c.model, thinking: c.thinking,
    timeoutSec: c.timeoutSec, resumeRef: c.resumeRef ?? null, stageHome: c.stageHome ? "<present>" : null,
    allowedTools: c.allowedTools ?? null, seatWrites: c.seatWrites ?? null, skillsDir: c.skillsDir ?? null,
    skillsGrantRoots: c.skillsGrantRoots ?? null, profilesDir: c.profilesDir ?? null, stallSec: c.stallSec ?? null,
    progressFiles: c.progressFiles ?? null, streamFile: c.streamFile ?? null,
    mcpConfig: c.mcpConfig ? H(norm(JSON.stringify(c.mcpConfig))) : null,
  }))),
  stageRows: jsonl(join(runDir, "_driver", `${sc.stage ?? "ladder-stage"}.jsonl`)),
  runEvents: jsonl(join(runDir, "_driver", "run.jsonl")),
  files: walk(runDir).filter((p) => !/\.jsonl$/.test(p) || !p.includes("_driver")).sort()
    .map((p) => [norm(relative(runDir, p)), H(norm(readFileSync(p, "utf8")))]),
  notes: notes.join("").split("\n").filter(Boolean).map(norm),
  network: process.env.BEHAVIOUR_SNAPSHOT_NET_LOG && existsSync(process.env.BEHAVIOUR_SNAPSHOT_NET_LOG)
    ? [...new Set(readFileSync(process.env.BEHAVIOUR_SNAPSHOT_NET_LOG, "utf8").split("\n").filter(Boolean))].sort() : [],
};
writeFileSync(out, JSON.stringify(record, null, 1));
