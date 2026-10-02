// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A JUDGE'S FULL RECORD IS FETCHED FROM THE REGISTER THE RUN USED, AND EVERY FETCH IS COUNTED.
//
// A record id is the id one register gave it. The judging tools fetched a record the run did not hold from
// the deployment's active register, so a run listed on one register, opened after the deployment moved to
// another, asked the wrong register for its records. The fetch now goes to the register the run's frozen plan
// names, a register this build does not know is refused by name, and the run's record counts each call that
// reached a register, because each is billed and there is no cap. Driven through the real tool server, with
// two registers whose credentials are absent so that no call leaves the machine: each answers with its own
// name, which says which one was asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPile } from "../pile.mjs";
import { recordFetchCount } from "../owner-judgment-run.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "owner-server.mjs");
const PILE = join(HERE, "fixtures", "owner-pile");

/** A copy of the invented pile whose plan names `provider`, and one record it holds no full record for. */
function runNamed(provider) {
  const dir = mkdtempSync(join(tmpdir(), "fetch-register-"));
  cpSync(PILE, dir, { recursive: true });
  const planPath = driverDir(dir, "register-plan.json");
  writeFileSync(planPath, JSON.stringify({ ...JSON.parse(readFileSync(planPath, "utf8")), provider }));
  const pile = loadPile(dir);
  const unheld = pile.records.find((r) => !pile.readFullRecord(r.id));
  assert.ok(unheld, "precondition: the invented pile has a record with no full record to fetch");
  return { dir, record: unheld.id };
}

/** One register_open through the real server; resolves when it answers. The active register is `active`. */
function openThrough(dir, record, active) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLEAROTRON_BAND_RUN_DIR: dir, CLEAROTRON_DATABASE: active, CLEAROTRON_GATHER_SESSION_KEY: "judge-arm-1" };
    for (const k of ["CLARIVATE_API_KEY", "CORSEARCH_SESSION_KEY", "REGISTER_PROVIDER"]) delete env[k];
    const p = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "ignore"], env });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("the owner server did not answer — could not look")); }, 30000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "register_open", arguments: { record } } });
  });
}

const openRows = (dir) => {
  const p = driverDir(dir, "reading-log.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.tool === "register_open");
};

test("the fetch goes to the register the run's plan names, not to the deployment's active one", async () => {
  const { dir, record } = runNamed("clarivate");
  try {
    await openThrough(dir, record, "corsearch");
    const [row] = openRows(dir);
    assert.ok(row?.fetched, "the open logged no fetch at all — the instrument reached nothing");
    assert.match(String(row.fetched.cause ?? ""), /CLARIVATE/, `the fetch was not sent to the run's own register: ${row.fetched.cause}`);
    assert.doesNotMatch(String(row.fetched.cause ?? ""), /CORSEARCH/, "the fetch went to the deployment's active register");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a register this build does not know is refused by name, and the active register is never asked instead", async () => {
  const { dir, record } = runNamed("a-register-this-build-never-had");
  try {
    await openThrough(dir, record, "corsearch");
    const [row] = openRows(dir);
    assert.match(String(row?.fetched?.cause ?? ""), /a-register-this-build-never-had/, `the refusal does not name the run's register: ${row?.fetched?.cause}`);
    assert.doesNotMatch(String(row.fetched.cause), /CORSEARCH/, "an unknown register fell back to the active one");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("each call that reached a register is counted once in the run's record, and later opens are not", async () => {
  const { dir, record } = runNamed("clarivate");
  try {
    await openThrough(dir, record, "corsearch");
    assert.deepEqual(recordFetchCount(dir), { fetches: 1, ok: 0, failed: 1 });
    // A second judge's session opening the same record asks again — the first answered nothing — and is a
    // second billed call; a log row that merely repeats an earlier answer is not.
    await openThrough(dir, record, "corsearch");
    assert.deepEqual(recordFetchCount(dir), { fetches: 2, ok: 0, failed: 2 });
    const repeat = { ...openRows(dir)[0] };
    delete repeat.fetch_made;
    writeFileSync(driverDir(dir, "reading-log.jsonl"), `${readFileSync(driverDir(dir, "reading-log.jsonl"), "utf8")}${JSON.stringify(repeat)}\n`);
    assert.deepEqual(recordFetchCount(dir), { fetches: 2, ok: 0, failed: 2 }, "a repeated answer was counted as another call");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
