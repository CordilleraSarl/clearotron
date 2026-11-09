#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// behaviour-snapshot.mjs — what a run does, written down so a change can be compared with the code before it.
//
//   node driver/test/snapshot/behaviour-snapshot.mjs record --out <dir> [--repo <checkout>] [--only <id,id>] [--jobs <n>]
//   node driver/test/snapshot/behaviour-snapshot.mjs compare <base> <head> [--from <sha> --to <sha>] [--detail <file>]
//
// Drives the mock pipeline, at no cost and with the network refused, and writes per scenario: the stages in
// order, a hash of each prompt with run-specific tokens normalised, the tools each was granted, the output
// files and their hashes, the terminal state and the report, with the driver lines the scenarios ran.
// Generated on demand and never committed. It reports and does not judge: exit 0 means it looked, whatever
// it found, and exit 2 means it could not look.
//
// EQUAL MEANS EQUAL ON THE LINES THE SCENARIOS RAN. The mocks write the same fixture whichever branch the
// driver takes, so a line no scenario reached is unproven, and `compare` says which changed lines those are.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
let REPO = resolve(HERE, "..", "..", "..");
const TEST = () => join(REPO, "driver", "test");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const JOB = { id: "snapshot-job", msgId: "<snapshot@x>", forwarder: "jordan", forwarderDomain: "example.com", ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch", goods: "downloadable software for planning invented courier routes", rawRequest: "An invented message asking about one name." };
const PRODUCTS = {
  "full-country": { product: "full-country-search", territories: ["US"] },
  "multi-country": { product: "multi-country-focus-search", territories: ["FR", "DE"] },
  "global-preliminary": { product: "global-preliminary-search" },
};
const ENGINES = {
  claude: (m) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: m.claude }),
  codex: (m) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: m.codex, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" }),
};
const KNOCKOUT = {
  product: "knockout-search", markName: "IRONWHISK", classes: [8, 21], goods: "kitchen tools; household utensils", rawRequest: "An invented message asking about two names for kitchen tools.",
  marks: [{ name: "IRONWHISK", classes: [8, 21] }, { name: "CLUVENDRA", classes: [8] }],
};
function scenarios() {
  const out = [];
  for (const engine of Object.keys(ENGINES)) {
    for (const [p, patch] of Object.entries(PRODUCTS)) out.push({ id: `${p}.${engine}`, engine, job: { ...JOB, ...patch } });
    out.push({ id: `knockout.${engine}`, engine, job: { ...JOB, ...KNOCKOUT }, knockout: true });
  }
  return out;
}

/** The knockout lane reads canned web and register answers from a fixture directory, as its end-to-end test does. */
function seedKnockout(spec, root) {
  const sweep = join(root, "sweep-fixtures"), counts = join(root, "count-fixtures");
  mkdirSync(sweep, { recursive: true }); mkdirSync(counts, { recursive: true });
  const cell = (term, platform, candidates = []) => ({ term, platform, status: candidates.length ? "hit" : "no_hit", candidates });
  writeFileSync(join(sweep, "ironwhisk.grid.json"), JSON.stringify({ cells: [cell("IRONWHISK", "web", [{ title: "Ironwhisk mixers", url: "https://example.test/ironwhisk" }]), cell("IRONWHISK", "shop.example.com"), cell("IRONWHISKK", "web")], gaps: [], extras: {} }));
  writeFileSync(join(sweep, "cluvendra.grid.json"), JSON.stringify({ cells: [cell("CLUVENDRA", "web"), cell("CLUVENDRA", "shop.example.com")], gaps: [], extras: {} }));
  writeFileSync(join(counts, "ironwhisk.json"), JSON.stringify({ identical: 3, containing: 41 }));
  writeFileSync(join(counts, "cluvendra.json"), JSON.stringify({ identical: 0, containing: null }));
  spec.job = { ...spec.job, registerFixtures: { counts } };
  spec.env = { ...(spec.env ?? {}), CLEAROTRON_KNOCKOUT_MODE: "1", CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES: sweep };
}

function childEnv(spec, root, netLog, callLog, covDir) {
  const mocks = { claude: join(TEST(), "mock-claude.mjs"), codex: join(TEST(), "mock-codex.mjs") };
  return {
    PATH: process.env.PATH, HOME: join(root, "home"), TMPDIR: join(root, "tmp"), TERM: "dumb", NO_COLOR: "1", LANG: "C.UTF-8", TZ: "UTC",
    NODE_OPTIONS: `--import=${join(HERE, "no-network.mjs")} --no-warnings`, NODE_V8_COVERAGE: covDir,
    BEHAVIOUR_SNAPSHOT_NET_LOG: netLog, MOCK_CLAUDE_CALL_LOG: callLog, MOCK_CODEX_CALL_LOG: callLog,
    CLEAROTRON_DATABASE: "corsearch", CORSEARCH_SESSION_KEY: "test-offline", PERPLEXITY_API_KEY: "test-offline",
    CLEAROTRON_PLAN_DISPATCH: "off", CLEAROTRON_BAND_TRUTH_GATE: "0", CLEAROTRON_REGISTER_GAP_CLAMP: "0", CLEAROTRON_SATPROBE_CODESIDE: "0",
    CLEAROTRON_REPORTS_URL: "https://trademark.test", CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    ...ENGINES[spec.engine](mocks), ...(spec.env ?? {}),
  };
}

function walk(dir, keep = () => true) {
  const out = [];
  const go = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) go(p); else if (keep(p)) out.push(p); } };
  if (existsSync(dir)) go(dir);
  return out;
}

function normaliser(root, result) {
  const pairs = [[root, "<ROOT>"], [REPO, "<REPO>"]];
  const codename = result?.codename ?? (result?.runDir ? String(result.runDir).split(/[\\/]/).filter(Boolean).pop().replace(/^\d{4}-\d{2}-\d{2}-/, "") : null);
  if (codename) pairs.push([codename, "<CODENAME>"]);
  // Reports and status files name the commit they were built from, which is the one thing two commits always differ by.
  const commit = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  pairs.push([commit, "<COMMIT>"], [commit.slice(0, 12), "<COMMIT>"], [commit.slice(0, 8), "<COMMIT>"], [commit.slice(0, 7), "<COMMIT>"]);
  return (text) => {
    let t = String(text);
    for (const [a, b] of pairs) t = t.split(a).join(b);
    return t
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<TS>")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
      .replace(/"pid(Starttime)?":\s*"?\d+"?/g, '"pid$1":0')
      .replace(/\b1[7-9]\d{8}(\d{3})?\b/g, "<EPOCH>")
      .replace(/-p\d+-[A-Za-z0-9]{6}\b/g, "-<TEMP>")
      .replace(/\b(clearotron-[a-z-]*?)-[A-Za-z0-9]{6}(?=[\\/"'\s]|$)/g, "$1-<TEMP>")
      .replace(/<DATE> · \d{1,2}:\d{2}( ?(GMT|UTC)([+-]\d{1,2})?)?/g, "<DATE> · <TIME>")
      .replace(/\bprobe-[0-9a-f]{8}\b/g, "probe-<NONCE>")
      .replace(/"turnaroundHours":\s*\{[^}]*\}/g, '"turnaroundHours":"<WALL>"')
      .replace(/mock-sess-[a-z0-9]+/g, "<SESSION>")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<UUID>");
  };
}

function record(spec, root, result, callLog, netLog, out) {
  const norm = normaliser(root, result);
  const rec = { id: spec.id, engine: spec.engine, terminal: { ok: result.ok ?? null, failedStage: result.failedStage ?? null, terminalKind: result.terminalKind ?? null, threw: result.threw ? norm(result.threw) : null } };
  rec.network = existsSync(netLog) ? [...new Set(readFileSync(netLog, "utf8").trim().split("\n"))].sort() : [];
  if (!result.runDir) return rec;
  const run = join(result.runDir, "_driver");
  const events = readFileSync(join(run, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  rec.stages = stageOrder(events.filter((e) => e.event === "stage")).map((row) => JSON.parse(norm(JSON.stringify(row))));
  const dispatches = new Map();
  for (const f of readdirSync(run)) if (f.endsWith(".dispatch.txt")) dispatches.set(promptKey(norm(readFileSync(join(run, f), "utf8"))), f.replace(/\.dispatch\.txt$/, ""));
  const calls = existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  rec.turns = Object.fromEntries(calls.map((c, i) => {
    const prompt = norm(c.prompt ?? "");
    const label = dispatches.get(promptKey(prompt)) ?? `unlabelled.${sha(prompt)}`;
    const detail = join(out, "detail", spec.id);
    mkdirSync(detail, { recursive: true });
    writeFileSync(join(detail, `${label.replace(/[^\w.-]/g, "_")}.prompt.txt`), prompt);
    writeFileSync(join(detail, `${label.replace(/[^\w.-]/g, "_")}.tools.txt`), tools(c, norm));
    return [label, { prompt: sha(prompt), tools: sha(tools(c, norm)), instructions: instructionFiles(prompt) }];
  }).sort(([a], [b]) => (a < b ? -1 : 1)));
  rec.outputs = {};
  for (const f of walk(result.runDir, stableOutput)) rec.outputs[norm(relative(result.runDir, f))] = fileHash(f, norm);
  rec.report = {};
  for (const f of walk(join(root, "pool"))) rec.report[norm(relative(join(root, "pool"), f))] = fileHash(f, norm);
  return rec;
}
/** A prompt tells the model which instruction files to read, and the mocks never open them: their words are hashed here. */
function instructionFiles(prompt) {
  const out = {};
  for (const [, rel] of prompt.matchAll(/(?:<REPO>\/driver\/)?\b(skills\/[\w./-]+\.(?:md|json|txt))/g)) {
    const file = join(REPO, "driver", rel);
    out[rel] = existsSync(file) ? sha(readFileSync(file)) : "absent";
  }
  return out;
}
const promptKey = (t) => t.replace(/<REPO>\/driver\//g, "").trim();
function tools(call, norm) {
  const a = call.argv ?? [];
  const at = (flag) => { const i = a.indexOf(flag); return i < 0 ? null : a[i + 1]; };
  return norm(JSON.stringify({ allowed: at("--allowedTools"), disallowed: at("--disallowedTools"), model: at("--model") ?? at("-m"), effort: at("--effort"), config: call.configToml ?? null }));
}
function fileHash(f, norm) {
  const buf = readFileSync(f);
  // A workbook is a zip whose entries carry the moment it was written, so its bytes and its size move on every run.
  // A report lists the models it was served in the order concurrent stages finished. Each turn's own model is
  // compared in its record, so the list's order carries nothing the comparison needs.
  return /\.(xlsx|png|jpg|pdf|zip|gz)$/.test(f) ? "binary" : sha(norm(buf.toString("utf8")).replace(/\b(?:claude|gpt)-[a-z0-9.-]+/g, "<MODEL>"));
}
const VOLATILE = /(^|[\\/])(streams|[^\\/]*\.jsonl|economics\.json|[^\\/]*\.attempt\d+[^\\/]*\.stdout)($|[\\/])/;
const stableOutput = (f) => !VOLATILE.test(f);
function stageOrder(stages) {
  const span = (e) => [Date.parse(e.dispatchedAt ?? e.ts), Date.parse(e.settledAt ?? e.ts)];
  const row = (e) => ({ stage: e.stage, lane: e.lane ?? null, ok: e.ok ?? null, attempts: e.attempts ?? null, fail: e.fail ?? null, model: e.model ?? null, output: e.output?.name ?? null });
  const groups = [];
  for (const e of stages) {
    const [from, to] = span(e);
    const g = groups.at(-1);
    if (g && from < g.to) { g.items.push(e); g.to = Math.max(g.to, to); } else groups.push({ to, items: [e] });
  }
  return groups.flatMap((g) => g.items.map(row).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)));
}

function runOne(spec, out) {
  return new Promise((done) => {
    const root = mkdtempSync(join(tmpdir(), "behaviour-snapshot-"));
    for (const d of ["home", "tmp"]) mkdirSync(join(root, d), { recursive: true });
    if (spec.knockout) seedKnockout(spec, root);
    const callLog = join(root, "calls.jsonl"), netLog = join(root, "network.log"), covDir = join(out, "coverage", spec.id), resultFile = join(root, "result.json");
    mkdirSync(covDir, { recursive: true });
    const specFile = join(root, "spec.json");
    writeFileSync(specFile, JSON.stringify({ job: spec.job, opts: spec.opts ?? {}, resultFile, driver: join(REPO, "driver") }));
    chmodSync(join(TEST(), "mock-claude.mjs"), 0o755); chmodSync(join(TEST(), "mock-codex.mjs"), 0o755);
    const t0 = Date.now();
    execFile(process.execPath, [join(HERE, "run-scenario.mjs"), specFile], { env: childEnv(spec, root, netLog, callLog, covDir), cwd: root, timeout: 600_000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      let rec;
      if (existsSync(resultFile)) rec = record(spec, root, JSON.parse(readFileSync(resultFile, "utf8")), callLog, netLog, out);
      else rec = { id: spec.id, engine: spec.engine, terminal: { couldNotRun: String(err?.message ?? "no result").slice(0, 400), stderr: stderr.slice(-800) } };
      writeFileSync(join(out, `${spec.id}.json`), JSON.stringify(rec, null, 1) + "\n");
      done({ id: spec.id, ms: Date.now() - t0, ok: rec.terminal?.ok, stages: rec.stages?.length ?? 0, couldNotRun: Boolean(rec.terminal?.couldNotRun) });
    });
  });
}

async function main(argv) {
  const at = (f) => { const i = argv.indexOf(f); return i < 0 ? null : argv[i + 1]; };
  if (argv[0] === "record") {
    if (at("--repo")) REPO = resolve(at("--repo"));
    const out = resolve(at("--out"));
    mkdirSync(out, { recursive: true });
    const only = at("--only")?.split(",");
    const queue = scenarios().filter((s) => !only || only.includes(s.id));
    const results = [];
    await Promise.all(Array.from({ length: Number(at("--jobs") ?? 2) }, async () => { while (queue.length) results.push(await runOne(queue.shift(), out)); }));
    for (const r of results.sort((a, b) => (a.id < b.id ? -1 : 1))) console.log(`${r.id}: ok=${r.ok} stages=${r.stages} ms=${r.ms}`);
    writeFileSync(join(out, "coverage.lines"), JSON.stringify(reduceCoverage(join(out, "coverage"))));
    rmSync(join(out, "coverage"), { recursive: true, force: true });
    return results.some((r) => r.couldNotRun) ? 2 : 0;
  }
  if (argv[0] === "compare") {
    if (at("--repo")) REPO = resolve(at("--repo"));
    const [baseDir, headDir] = [resolve(argv[1]), resolve(argv[2])];
    if (![baseDir, headDir].every((d) => existsSync(join(d, "coverage.lines")))) {
      console.error("behaviour-snapshot: a record directory has no coverage.lines; this is a could-not-look, not a clean comparison");
      return 2;
    }
    const differences = compareDirs(baseDir, headDir);
    const from = at("--from"), to = at("--to");
    const modules = from && to ? changedModules(from, to, JSON.parse(readFileSync(join(headDir, "coverage.lines"), "utf8"))) : [];
    for (const m of modules) console.log(`${m.file} [${owner(m.file)}]: ${m.changed} changed line(s), ${m.notRun.length} not run by any scenario`);
    console.log(`behaviour-snapshot: ${differences.length} behaviour difference(s) in ${new Set(differences.map((d) => d.split("/")[0])).size} scenario(s); ${modules.length} changed module(s)`);
    for (const gap of SCENARIO_GAPS) console.log(`behaviour-snapshot: not driven: ${gap}`);
    if (at("--detail")) writeFileSync(at("--detail"), [...differences, "", ...modules.map((m) => `${m.file}: not run: ${m.notRun.join(",")}`)].join("\n") + "\n");
    else for (const d of differences) console.log(d);
    return 0;
  }
  console.error("usage: behaviour-snapshot.mjs record --out <dir> [--repo <checkout>] [--only <ids>] [--jobs <n>]\n       behaviour-snapshot.mjs compare <base> <head> [--from <sha> --to <sha>] [--detail <file>]");
  return 2;
}

/** Scenarios this tool does not drive yet, printed on every comparison so that their absence is read. */
export const SCENARIO_GAPS = ["a correction pass", "a resumed run", "a parked run", "a cancelled run", "a failed stage"];

// Neutral area labels. Which session or person holds an area is kept outside the repository.
const OWNERS = [
  [/^driver\/(pipeline|stages)/, "pipeline"],
  [/^driver\/(skills\/|engine\/|gateway|repair-composers)|^providers\//, "engine and instructions"],
  [/^driver\/publish\/|^shared\//, "record and report"],
  [/^(\.github\/|scripts\/|package(-lock)?\.json$|\.changeset\/|bin\/)/, "release"],
];
export const owner = (file) => OWNERS.find(([re]) => re.test(file))?.[1] ?? "unassigned";

/** Lines of `source` with at least one non-blank character that a V8 block-coverage function list ran. */
export function executedLines(source, functions) {
  const counts = new Int32Array(source.length).fill(-1);
  const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, source.length));
  const lines = new Set();
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") { line++; continue; }
    if (counts[i] > 0 && source[i].trim()) lines.add(line);
  }
  return lines;
}
function reduceCoverage(dir) {
  const byFile = new Map();
  for (const f of walk(dir, (p) => p.endsWith(".json"))) {
    for (const entry of JSON.parse(readFileSync(f, "utf8")).result ?? []) {
      if (!entry.url.startsWith("file://")) continue;
      const file = relative(REPO, fileURLToPath(entry.url.replace(/\?.*$/, "")));
      if (!/^(driver|shared|providers)\//.test(file) || /(^|\/)test\//.test(file)) continue;
      const seen = byFile.get(file) ?? new Set();
      for (const l of executedLines(readFileSync(join(REPO, file), "utf8"), entry.functions)) seen.add(l);
      byFile.set(file, seen);
    }
  }
  return Object.fromEntries([...byFile].map(([f, s]) => [f, [...s].sort((a, b) => a - b)]));
}
const CODE_LINE = (t) => { const x = t.trim(); return x && !x.startsWith("//") && !x.startsWith("*") && !x.startsWith("/*"); };
function changedModules(from, to, coverage) {
  const out = execFileSync("git", ["-C", REPO, "diff", "--unified=0", `${from}..${to}`, "--", "driver", "shared", "providers", "mcp-server", "bin", "scripts"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const modules = new Map();
  let cur = null, line = 0;
  for (const l of out.split("\n")) {
    const header = l.match(/^\+\+\+ b\/(.+)$/);
    if (header) { cur = /(^|\/)test\//.test(header[1]) ? null : header[1]; if (cur) modules.set(cur, { file: cur, changed: 0, notRun: [] }); continue; }
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!cur || !l.startsWith("+") || l.startsWith("+++")) continue;
    if (CODE_LINE(l.slice(1))) {
      const m = modules.get(cur); m.changed++;
      if (/^(driver|shared|providers)\/.*\.m?js$/.test(cur) && !coverage[cur]?.includes(line)) m.notRun.push(line);
    }
    line++;
  }
  return [...modules.values()].filter((m) => m.changed > 0);
}

/** Every path through two records where they disagree: scenario, section, key. */
export function compareRecords(base, head, prefix = base?.id ?? head?.id ?? "") {
  const out = [];
  const go = (a, b, path) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const objects = a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b);
    if (!objects) { out.push(`${path}: ${brief(a)} -> ${brief(b)}`); return; }
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) go(a[k], b[k], `${path}/${k}`);
  };
  go(base, head, prefix);
  return out;
}
const brief = (v) => (v === undefined ? "absent" : JSON.stringify(v).slice(0, 160));
function compareDirs(baseDir, headDir) {
  const names = (d) => readdirSync(d).filter((f) => f.endsWith(".json")).sort();
  const out = [];
  for (const f of [...new Set([...names(baseDir), ...names(headDir)])]) {
    const read = (d) => (existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), "utf8")) : undefined);
    out.push(...compareRecords(read(baseDir), read(headDir), f.replace(/\.json$/, "")));
  }
  return out;
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
