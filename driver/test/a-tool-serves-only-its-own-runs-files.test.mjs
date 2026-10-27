// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A TOOL SERVES ONLY ITS OWN RUN'S FILES, HOWEVER THE PATH IS WRITTEN.
//
// A run may read nothing from another run. The grid tools took a spec in any run's folder and wrote the ledger it
// named; the register tools read a plan and wrote a band at any path the call gave. Each now resolves the path to
// where it really is, `..` and links included, and serves it only inside the run folder the driver wired. A path
// in another run's folder, one that climbs out with `..`, a link placed inside the run that points at another run,
// and a link whose target is not written yet are all refused; the run's own paths still work. Artifact search
// already held this line (skeptic-search.mjs, `search_file_escapes_run`). Every run and mark below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";
import { RUN_RECORD_LOG_FILE } from "../../providers/_shared/ledger-path.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, "..", "engine", "mcp");

/** Two invented runs side by side, as two clearances on one machine sit, and a grid spec in each. */
function twoRuns(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "own-run-files-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (name) => {
    const dir = join(root, "studio", "clearance-search", name);
    mkdirSync(join(dir, "_driver"), { recursive: true });
    mkdirSync(join(dir, "register-units"), { recursive: true });
    const spec = join(dir, "_driver", "grid-spec.json");
    writeFileSync(spec, JSON.stringify({ terms: ["QZORVIM"], platforms: ["example-shop"], output_path: join(dir, "grid-ledger.json") }) + "\n");
    writeFileSync(join(dir, "_driver", "register-plan.json"), JSON.stringify({ regions: [], entries: [{ qid: "q1", axis: "primary-sweep", predicate: "exact", term: "QZORVIM" }] }) + "\n");
    return { dir, spec, plan: join(dir, "_driver", "register-plan.json"), band: join(dir, "register-units", "primary-sweep-band.json"),
      recordLog: join(dir, "_driver", RUN_RECORD_LOG_FILE) };
  };
  return { mine: run("2026-01-01-amber-fox"), theirs: run("2026-01-01-cobalt-owl") };
}

test("a path is this run's only where it really is: inside, not via .., another run's folder or a link out", async (t) => {
  const { pathInRun } = await import("../../shared/inside-run.mjs");
  const { mine, theirs } = twoRuns(t);
  assert.equal(pathInRun(mine.dir, mine.spec), join("_driver", "grid-spec.json"));
  assert.equal(pathInRun(mine.dir, join(mine.dir, "register-units", "not-written-yet.json")), join("register-units", "not-written-yet.json"));
  assert.equal(pathInRun(mine.dir, mine.dir), "");
  assert.equal(pathInRun(mine.dir, theirs.spec), null, "another run's file was read as this run's");
  assert.equal(pathInRun(mine.dir, join(mine.dir, "..", "2026-01-01-cobalt-owl", "_driver", "grid-spec.json")), null, "`..` climbed into another run");
  symlinkSync(theirs.spec, join(mine.dir, "linked-spec.json"));
  assert.equal(pathInRun(mine.dir, join(mine.dir, "linked-spec.json")), null, "a link inside the run carried a read into another run");
  symlinkSync(join(theirs.dir, "planted.json"), join(mine.dir, "dangling.json"));
  assert.equal(pathInRun(mine.dir, join(mine.dir, "dangling.json")), null, "a write through a dangling link would land in another run");
  assert.equal(pathInRun(join(mine.dir, "nowhere"), mine.spec), null, "a run folder that does not resolve held a file");
});

/** One tool call to a real server over stdio, wired to `runDir` as the driver wires it. */
async function callServer(script, tool, args, runDir) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, script)], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "placeholder-not-a-key", CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* not a reply */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

test("the grid tools refuse another run's spec, directly and through a link, and a spec whose ledger is another run's", async (t) => {
  const { mine, theirs } = twoRuns(t);
  symlinkSync(theirs.spec, join(mine.dir, "linked-spec.json"));
  const crossing = join(mine.dir, "_driver", "crossing-spec.json");
  writeFileSync(crossing, JSON.stringify({ terms: ["QZORVIM"], platforms: ["example-shop"], output_path: join(theirs.dir, "grid-ledger.json") }) + "\n");
  for (const [script, tool, extra] of [["perplexity-server.mjs", "perplexity_research", { task: "grid" }], ["dispositions-server.mjs", "record_dispositions", { rows: [] }]]) {
    for (const spec of [theirs.spec, join(mine.dir, "linked-spec.json")]) {
      const reply = await callServer(script, tool, { ...extra, grid_spec_path: spec }, mine.dir);
      assert.match(reply, /grid_spec_path is outside this run's folder/, `${tool} served another run's spec at ${spec}: ${reply.slice(0, 200)}`);
    }
    const reply = await callServer(script, tool, { ...extra, grid_spec_path: crossing }, mine.dir);
    assert.match(reply, /output_path is outside this run's folder/, `${tool} would write another run's ledger: ${reply.slice(0, 200)}`);
  }
  assert.equal(existsSync(join(theirs.dir, "grid-ledger.json")), false, "a ledger was written into another run");
});

test("the register tools refuse another run's plan and band, and still run on the run's own", async (t) => {
  const { mine, theirs } = twoRuns(t);
  const asked = [];
  const answer = async (_a, p) => { asked.push(p); return { total: 0, records: [] }; };
  const { executePlan } = { executePlan: makeExecutePlan({ search: answer, enumerate: answer, capabilities: { id: "an-invented-register" } }) };
  const ctx = { kind: "execute_plan", recordLog: mine.recordLog };
  const call = (plan, band) => executePlan("auth", { plan_path: plan, axis: "primary-sweep", output_path: band }, ctx);
  symlinkSync(theirs.dir, join(mine.dir, "register-units", "elsewhere"));
  for (const [plan, band, what] of [
    [theirs.plan, mine.band, "another run's plan"],
    [mine.plan, theirs.band, "another run's band"],
    [mine.plan, join(mine.dir, "register-units", "elsewhere", "register-units", "primary-sweep-band.json"), "a band through a link into another run"],
  ]) {
    const res = await call(plan, band);
    assert.match(String(res.text), /^ERROR: (plan_path|output_path) is outside this run's folder/, `${what} was served: ${String(res.text).slice(0, 200)}`);
  }
  assert.equal(asked.length, 0, "a refused call still searched the register");
  assert.equal(existsSync(theirs.band), false, "a band was written into another run");
  const own = await call(mine.plan, mine.band);
  assert.doesNotMatch(String(own.text), /outside this run's folder/, "the run's own plan and band were refused");
});

test("a supplemental proposal refuses a band path in another run before it writes anything", async (t) => {
  const { proposeSupplemental } = await import("../engine/mcp/supplemental.mjs");
  const { mine, theirs } = twoRuns(t);
  const res = await proposeSupplemental({ axis: "primary-sweep", output_path: theirs.band, proposals: [{ predicate: "exact", term: "QZORVIM" }] },
    { kind: "propose_supplemental", recordLog: mine.recordLog }, { executePlan: async () => ({ type: "text", text: "{}" }) });
  assert.match(String(res.text), /^ERROR: output_path is outside this run's folder/, String(res.text).slice(0, 200));
  assert.equal(existsSync(join(theirs.dir, "register-units", "primary-sweep-supplemental-plan.json")), false, "a supplemental plan was written into another run");
});
