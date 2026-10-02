// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the recording server's tool list, asked over its own protocol in a child process
//
// A KNOCKOUT RUN WITH NO FRAMEWORK METHOD IS NOT OFFERED THE `inputs` FIELD.
//
// The knockout save tool declared the framework's `inputs` fields on every run. A session on a framework
// that states no method filled them, and the check that refuses them runs only after the whole step, so the
// step ran again, three times on one test run. The fields are now offered only where the run's framework
// states a method: when its frozen copy exists. Every other tool, and every run with a method, is listed as
// declared. Invented paths only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";

const SERVER = fileURLToPath(new URL("../engine/mcp/recording-server.mjs", import.meta.url));
const DIRS = [];
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });

/** The server's answer to tools/list, run against `runDir` (or none). */
function listTools(runDir) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (runDir) env.CLEAROTRON_BAND_RUN_DIR = runDir; else delete env.CLEAROTRON_BAND_RUN_DIR;
    const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "inherit"] });
    let buf = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("no answer from the server")); }, 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      const line = buf.split("\n").find((l) => l.includes('"id":7'));
      if (!line) return;
      clearTimeout(timer);
      child.stdin.end();
      resolve(JSON.parse(line).result.tools);
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n");
  });
}
function runDir({ method }) {
  const dir = mkdtempSync(join(tmpdir(), "knockout-inputs-"));
  DIRS.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  if (method) writeFileSync(driverDir(dir, "framework-method.json"), JSON.stringify({ schema_version: 1, inputs: [], table: [] }));
  return dir;
}
const knockout = (tools) => tools.find((t) => t.name === "record_knockout_assess");
const inputsFields = (schema) => (JSON.stringify(schema).match(/"inputs":\{/g) ?? []).length;

test("a run whose framework states no method is not offered the inputs fields; one that does is, as declared", async () => {
  const declared = knockout(await listTools(null)).inputSchema;
  assert.equal(inputsFields(declared), 2, "premise: the declared schema carries the two inputs fields (register reads, findings)");
  const withMethod = await listTools(runDir({ method: true }));
  assert.deepEqual(knockout(withMethod).inputSchema, declared, "a run with a method lost its fields");
  const noMethod = knockout(await listTools(runDir({ method: false }))).inputSchema;
  assert.equal(inputsFields(noMethod), 0, "a run with no method is still offered the inputs fields");
  assert.doesNotMatch(JSON.stringify(noMethod.required ?? []), /"inputs"/);
});

test("every other tool is listed exactly as declared, whatever the run", async () => {
  const declared = await listTools(null);
  const listed = await listTools(runDir({ method: false }));
  for (const t of declared.filter((x) => x.name !== "record_knockout_assess"))
    assert.deepEqual(listed.find((x) => x.name === t.name), t, `${t.name} changed with the run`);
});
