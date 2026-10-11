// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEAT READS THE WHOLE BAND PAGE BY PAGE, EACH RECORD ONCE, IN ABOUT FORTY CALLS.
//
// The placement step judges the complete named band, and band_lookup could not page: at most 100 records
// a call, byte-capped, and a capped answer told the seat to narrow the filters and look the rest up in
// smaller slices. On 0.4.1-beta.2 a seat did exactly that over a band of 1,423 records: 2,287 lookups by
// overlapping owner and text fragments, 65.8 MB of results, until the engine's output cap stopped the turn.
// These arms drive the band server as the seat meets it, over MCP, on a band of that size and of records
// that size: following only the offset each capped answer names, every record arrives exactly once, in
// about forty calls, and no answer advises slicing any more. All names are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { driverDir } from "../../shared/driver-dir.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "band-server.mjs");
const RECORDS = 1400;
const GOODS = "Beverages, namely mineral and aerated waters and other non-alcoholic drinks; fruit drinks and fruit juices; "
  + "syrups and other preparations for making beverages; energy drinks; sports drinks; isotonic beverages. ";

/** A band of RECORDS records the size real ones are (about 1.4 KB each), under 971 owners. */
function seedBand() {
  const runDir = mkdtempSync(join(tmpdir(), "band-pages-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const enumerated = Array.from({ length: RECORDS }, (_, i) => ({
    record_id: `/mark/eu/qzxv${String(i).padStart(5, "0")}`,
    mark_text: `QZXV ${i}`, classes: [32, 33], status: i % 4 ? "Registered" : "Expired",
    owner_name: `Qzxv Owner ${i % 971}`, owner_country: "CH",
    application_date: "2019-04-01", registration_date: "2020-01-15",
    goods: GOODS.repeat(4), _query: "contains qzxv [cl 32]",
    screen: { registry: "EUIPO", live_status: i % 4 ? "live" : "dead", applicationDate: "2019-04-01" },
  }));
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated, crowds: [] }));
  return runDir;
}

/** The server as a seat meets it: one request, its answer, then the next request. */
async function session(runDir) {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "clearotron-x-y-placement-inquiry" } });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* not a message */ }
  });
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const mine = ++id;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 10000);
    pending.set(mine, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2025-06-18" });
  const lookup = async (args) => JSON.parse((await request("tools/call", { name: "band_lookup", arguments: args })).result.content[0].text);
  return { lookup, close: () => child.kill("SIGKILL") };
}

test("a seat following the offset each answer names reads every record once, in about forty calls", async (t) => {
  const runDir = seedBand();
  const s = await session(runDir);
  try {
    const seen = [];
    let offset = 0, calls = 0, answer;
    do {
      answer = await s.lookup({ limit: 100, offset });
      calls++;
      assert.equal(answer.matched, RECORDS, "the full match count rides on every page");
      for (const r of answer.records) seen.push(r.record_id);
      if (answer.next_offset !== undefined) {
        assert.equal(answer.next_offset, offset + answer.returned);
        assert.match(answer.note, new RegExp(`call again with offset: ${answer.next_offset} for the next page`));
        offset = answer.next_offset;
      }
      for (const text of [answer.note, answer.byte_cap_note].filter(Boolean)) {
        assert.doesNotMatch(text, /narrow the filters|smaller slices/, "an answer still tells the seat to slice the band");
      }
      assert.ok(calls <= 60, "the read did not end");
    } while (answer.next_offset !== undefined);
    assert.equal(seen.length, RECORDS, "a record was skipped or returned twice");
    assert.equal(new Set(seen).size, RECORDS, "a record came back twice");
    assert.ok(calls >= 20 && calls <= 45, `the band took ${calls} calls; about forty is one read of it`);
    t.diagnostic(`${RECORDS} records read in ${calls} calls`);
  } finally { s.close(); rmSync(runDir, { recursive: true, force: true }); }
});

test("a filtered lookup pages the same way, and an offset past the end returns nothing", async () => {
  const runDir = seedBand();
  const s = await session(runDir);
  try {
    const first = await s.lookup({ status: "expired", limit: 100 });
    assert.equal(first.matched, RECORDS / 4);
    assert.equal(first.next_offset, first.returned);
    const rest = await s.lookup({ status: "expired", limit: 100, offset: first.next_offset });
    assert.equal(rest.offset, first.next_offset);
    assert.ok(!rest.records.some((r) => first.records.some((f) => f.record_id === r.record_id)), "a page repeated the one before it");
    const past = await s.lookup({ limit: 100, offset: RECORDS + 5 });
    assert.equal(past.returned, 0);
    assert.equal(past.next_offset, undefined);
    assert.equal(past.note, undefined);
  } finally { s.close(); rmSync(runDir, { recursive: true, force: true }); }
});
