// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-record-is-written-once-per-run.test.mjs — the run's register record ledger holds each record once.
//
// THE DEFECT. A record that several queries return was appended once per query: measured on a delivered run,
// 2,898 lines for 2,098 distinct records, 800 of them repeats and 786 of those byte-identical. The band server
// reads the whole file on a cache miss, and nothing reads the repeats.
//
// NO VENDOR RECORD AND NO REAL MARK live here. Bodies are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeLedger } from "../ledger.mjs";
import { RUN_RECORD_LOG_FILE } from "../ledger-path.mjs";

const { logRecordBody } = makeLedger("invented");
const lines = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function runLedger() {
  const dir = mkdtempSync(join(tmpdir(), "record-once-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  return { dir, path: join(dir, "_driver", RUN_RECORD_LOG_FILE) };
}
const tctx = (path, stage = "register-unit-primary-sweep") => ({ recordLog: path, agentId: "a", sessionKey: `clearance-x-y-${stage}` });
const body = (status) => ({ uri: "/mark/us/1", markText: "INVENTED", statusText: status, _raw: { status: { primary: status } } });

test("the same record returned by three queries is one line", () => {
  const { dir, path } = runLedger();
  try {
    for (const stage of ["register-unit-primary-sweep", "register-unit-incumbent-class", "crowd-context"])
      logRecordBody(tctx(path, stage), "/mark/us/1", body("active"));
    logRecordBody(tctx(path), "/mark/us/2", { ...body("active"), uri: "/mark/us/2" });
    const rows = lines(path);
    assert.equal(rows.length, 2, "line count equals distinct record count");
    assert.deepEqual(rows.map((r) => r.target), ["/mark/us/1", "/mark/us/2"]);
    assert.ok(rows[0].body._raw, "every field stays, the vendor's raw copy included");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record returned again with a changed status is one line, the newer body, marked refreshed", () => {
  const { dir, path } = runLedger();
  try {
    logRecordBody(tctx(path), "/mark/us/1", body("pending"));
    const first = lines(path)[0];
    logRecordBody(tctx(path), "/MARK/US/1", body("active"));   // readers match case-insensitively; so does this
    const rows = lines(path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body.statusText, "active", "the newer body replaces the one written");
    assert.equal(rows[0].refreshed, true, "and says it was refreshed");
    assert.equal(rows[0].refreshed_from, first.ts, "naming when the body it replaced was written");
    // ONCE: a third, different answer does not rewrite the file again.
    logRecordBody(tctx(path), "/mark/us/1", body("expired"));
    assert.equal(lines(path).length, 1);
    assert.equal(lines(path)[0].body.statusText, "active");
    assert.ok(!existsSync(`${path}.lock`), "the lock is released");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record another process already wrote is not written again", () => {
  // Several processes write one run's ledger. "Already written" must be read off the file, not off memory.
  const { dir, path } = runLedger();
  try {
    logRecordBody(tctx(path), "/mark/us/9", { ...body("active"), uri: "/mark/us/9" });
    appendFileSync(path, JSON.stringify({ ts: "2026-09-18T00:00:00Z", provider: "invented", target: "/mark/gb/5", body: { uri: "/mark/gb/5" } }) + "\n");
    logRecordBody(tctx(path), "/mark/gb/5", { uri: "/mark/gb/5" });
    assert.equal(lines(path).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the box-wide fallback ledger is untouched by this: it holds many runs, and appends as before", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-global-"));
  const path = join(dir, "register-records.jsonl");
  try {
    logRecordBody({ recordLog: path }, "/mark/us/1", body("active"));
    logRecordBody({ recordLog: path }, "/mark/us/1", body("active"));
    assert.equal(lines(path).length, 2, "a record one run fetched is not a record another run holds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("two processes writing one run's ledger at once still leave each record once, and every line whole", async () => {
  // The run that matters has parallel register servers. Each writer here logs 300 records, 200 of them the
  // other writer's too, and changes the body of 20 shared ones, so appends and in-place replacements race.
  const { spawn } = await import("node:child_process");
  const { readdirSync } = await import("node:fs");
  const { dir, path } = runLedger();
  const writer = (seed) => `
    const { makeLedger } = await import(${JSON.stringify(new URL("../ledger.mjs", import.meta.url).href)});
    const { logRecordBody } = makeLedger("writer${seed}");
    for (let i = 0; i < 300; i++) {
      const n = ${seed} === 0 ? i : i + 100;              // 100..299 are written by both
      const changed = n >= 150 && n < 170 && ${seed} === 1; // 20 shared records answered differently by writer 1
      logRecordBody({ recordLog: ${JSON.stringify(path)} }, "/mark/us/" + n, { uri: "/mark/us/" + n, statusText: changed ? "active" : "pending" });
    }`;
  const run = (seed) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["--input-type=module", "-e", writer(seed)], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => { err += d; });
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${seed} exited ${code}: ${err}`))));
  });
  try {
    await Promise.all([run(0), run(1)]);
    const raw = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const rows = raw.map((l) => JSON.parse(l));   // throws on a torn line
    const targets = rows.map((r) => r.target);
    assert.equal(new Set(targets).size, 400, "every record written");
    assert.equal(rows.length, 400, "and each exactly once, whichever writer reached it first");
    assert.ok(!existsSync(`${path}.lock`), "no lock left behind");
    assert.deepEqual(readdirSync(join(dir, "_driver")).filter((f) => f.endsWith(".tmp")), [], "no replacement file left behind");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
