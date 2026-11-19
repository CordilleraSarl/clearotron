// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// connector-compare.mjs — does the connector still answer the same on the same runs?
//
//   node driver/test/snapshot/connector-compare.mjs seed --workspace <dir> [--repo <checkout>] [--run <saved-run-dir>]...
//   node driver/test/snapshot/connector-compare.mjs record --workspace <dir> --out <file> [--repo <checkout>] [--aside]
//   node driver/test/snapshot/connector-compare.mjs compare <a> <b>
//
// `seed` lays the demo runs into a throwaway workspace and publishes each there, so each carries its report document. Each
// `--run` adds a saved run in the demo folder's shape (`meta.json` beside `run/`), copied in and published the same way.
// `record` calls the connector's read tools on every run in that workspace, under a frozen clock, with the connector of
// the checkout given, and writes each answer's fingerprint. Two checkouts recorded on ONE seeded workspace read the same
// files, so a difference is a difference in what the connector does with them. `--aside` sets each run's report document
// aside for the recording and puts it back, which is how a run published before the document reads.
//
// IT REPORTS AND DOES NOT JUDGE: exit 0 means no difference was found; an answer that throws is recorded as its message.
// It makes no model turn and no register call.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

// The read tools whose answers come from a run's files, and the arguments each is asked with.
const CALLS = [
  ["brief", {}], ["get_run", {}],
  ["list_findings", {}], ["list_findings", { kind: "findings" }], ["list_findings", { kind: "negatives" }], ["list_findings", { kind: "audit" }],
  ["list_findings", { group: "on-field" }], ["list_findings", { group: "off-field" }], ["list_findings", { group: "out-of-scope" }],
  ["list_searches", {}], ["get_finding", { id: "F1" }], ["get_finding", { id: "NR1" }], ["get_finding", { id: "AT1" }],
  ["trace", { target: "F1" }], ["list_evidence", {}], ["get_search_coverage", {}],
  ["read_artifact", { name: "report" }], ["read_artifact", { name: "report", frontMatterOnly: true }],
];

function statusFiles(dir, depth = 0) {
  if (depth > 7 || !existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "status.json") return [p];
    return statSync(p).isDirectory() && !name.startsWith("_") ? statusFiles(p, depth + 1) : [];
  });
}

function child(mode, repo, workspace, extra = {}) {
  const home = join(workspace, "home");
  mkdirSync(home, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, TZ: "UTC", CLEAROTRON_NO_ENV_FILE: "1",
    CLEAROTRON_WORK_DIR: workspace, CLEAROTRON_REPORTS_DIR: join(workspace, "pool"), ...extra };
  return execFileSync(process.execPath, [fileURLToPath(import.meta.url), mode, "--repo", repo, "--workspace", workspace,
    ...(extra.ASIDE ? ["--aside"] : []), ...(extra.OUT ? ["--out", extra.OUT] : []), ...savedRuns().flatMap((r) => ["--run", r])],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000, maxBuffer: 256 * 1024 * 1024 });
}

/** Every `--run` given, as absolute paths. */
const savedRuns = () => process.argv.flatMap((a, i) => (a === "--run" && process.argv[i + 1] ? [resolve(process.argv[i + 1])] : []));

const mode = process.argv[2];
const repo = resolve(arg("--repo") ?? join(HERE, "..", "..", ".."));
const workspace = arg("--workspace") ? resolve(arg("--workspace")) : null;
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);

if (mode === "seed") {
  mkdirSync(join(workspace, "pool"), { recursive: true });
  process.stdout.write(child("seed-child", repo, workspace));
} else if (mode === "seed-child") {
  const { seedDemoRuns, publishSource, demoChildren } = await load("driver/demo-container.mjs");
  const { republishRun } = await load("driver/publish/report-registry.mjs");
  const examples = publishSource(join(repo, "demo"), { repoRoot: repo });
  seedDemoRuns({ workspace, examplesDir: examples, portalOrigin: "http://127.0.0.1:9" });
  const metas = new Map(demoChildren(examples).map((name) => {
    const meta = JSON.parse(readFileSync(join(examples, name, "meta.json"), "utf8"));
    return [meta.runId, meta];
  }));
  // A saved run is copied to the depth the connector looks at, under its own runId, and published with the demos.
  for (const saved of savedRuns()) {
    const meta = JSON.parse(readFileSync(join(saved, "meta.json"), "utf8"));
    const { studioDirFor } = await load("shared/pre-rename-spellings.mjs");
    const dir = join(studioDirFor(join(workspace, "workspace-saved")), "saved", meta.runId);
    cpSync(join(saved, "run"), dir, { recursive: true });
    metas.set(meta.runId, meta);
  }
  for (const file of statusFiles(workspace)) {
    const runId = JSON.parse(readFileSync(file, "utf8")).runId;
    const meta = metas.get(runId);
    if (!meta) continue;
    await republishRun({ runId, meta, pool: join(workspace, "pool"), poolUrl: "", runDir: dirname(file) });
    console.log(`seeded ${runId}`);
  }
} else if (mode === "record") {
  const out = arg("--out");
  // The record goes to its file from the child, because the driver's own log lines share the child's output.
  child("record-child", repo, workspace, { OUT: resolve(out), ...(process.argv.includes("--aside") ? { ASIDE: "1" } : {}) });
  console.log(`recorded ${out}`);
} else if (mode === "record-child") {
  const FROZEN = Date.UTC(2026, 0, 15, 12, 0, 0);
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(FROZEN); }
    static now() { return FROZEN; }
  };
  const runs = statusFiles(workspace).map((file) => ({ runDir: dirname(file), runId: JSON.parse(readFileSync(file, "utf8")).runId }));
  const documents = runs.map((r) => join(r.runDir, "_driver", "report-document.json")).filter((f) => existsSync(f));
  if (process.argv.includes("--aside")) for (const f of documents) renameSync(f, `${f}.aside`);
  const record = { documents: documents.length, answers: {} };
  try {
    const { tools } = await load("mcp-server/server.mjs");
    for (const { runId } of runs.sort((a, b) => a.runId.localeCompare(b.runId))) {
      for (const [name, args] of CALLS) {
        let answer;
        try { answer = await tools[name]({ runId, ...args }); } catch (e) { answer = { threw: String(e?.message ?? e) }; }
        const text = JSON.stringify(answer ?? null).split(workspace).join("<WS>");
        record.answers[`${runId} ${name} ${JSON.stringify(args)}`] = { sha: sha(text), text };
      }
    }
  } finally {
    if (process.argv.includes("--aside")) for (const f of documents) renameSync(`${f}.aside`, f);
  }
  writeFileSync(arg("--out"), JSON.stringify(record));
  process.exit(0);
} else if (mode === "compare") {
  const [a, b] = process.argv.slice(3).map((f) => JSON.parse(readFileSync(f, "utf8")));
  const keys = [...new Set([...Object.keys(a.answers), ...Object.keys(b.answers)])].sort();
  const differ = keys.filter((k) => a.answers[k]?.sha !== b.answers[k]?.sha);
  for (const k of differ) console.log(`  ${k}`);
  console.log(`connector-compare: ${differ.length} difference(s) across ${keys.length} answer(s); documents read ${a.documents} / ${b.documents}`);
  process.exit(differ.length ? 1 : 0);
} else {
  console.error("usage: connector-compare.mjs seed|record|compare …");
  process.exit(2);
}
