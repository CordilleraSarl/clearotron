// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEAT READS THE WHOLE BAND PAGE BY PAGE, EACH RECORD ONCE, AND EVERY PAGE ARRIVES WHOLE ON EITHER ENGINE.
//
// The placement step judges the complete named band, and band_lookup could not page: at most 100 records
// a call, byte-capped, and a capped answer told the seat to narrow the filters and look the rest up in
// smaller slices. On 0.4.1-beta.2 a seat did exactly that over a band of 1,423 records: 2,287 lookups by
// overlapping owner and text fragments, 65.8 MB of results, until the engine's output cap stopped the turn.
// That seat ran on codex, which cuts the middle out of any tool answer over about 39,000 bytes, so a page
// sized for Claude reached it with records missing (engine/mcp/codex-config.mjs, CODEX_BAND_ANSWER_CHARS).
// These arms drive the band server as the seat meets it, over MCP, on a band of that size whose records
// are sized like that band's (2.1 KB on average, half under 1.6 KB, one in twenty near 9 KB), at the
// answer size each engine is given: following only the offset each capped answer names, every record
// arrives exactly once, every page fits, and no answer advises slicing any more. All names are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { driverDir } from "../../shared/driver-dir.mjs";
import { codexBandAnswerChars, codexToolAnswerBytes } from "../engine/mcp/codex-config.mjs";
import { claudeToolAnswerBytes } from "../engine/mcp/gather-config.mjs";
import { quotedBytes } from "../../shared/answer-parts.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "band-server.mjs");
const RECORDS = 1400;
const GOODS = "Beverages, namely mineral and aerated waters and other non-alcoholic drinks; fruit drinks and fruit juices; "
  + "syrups and other preparations for making beverages; energy drinks; sports drinks; isotonic beverages. ";

// Goods wording repeated to give the measured spread of record sizes. It rides a field of its own: real
// rows carry no goods, and the lookup serves goods from the run's record bodies, cut on the row.
const goodsRepeats = (i) => (i % 20 === 7 ? 45 : i % 10 === 3 ? 11 : i % 4 === 1 ? 6 : 5);

/** A band of RECORDS records under 971 owners, sized like the measured one. */
function seedBand() {
  const runDir = mkdtempSync(join(tmpdir(), "band-pages-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const enumerated = Array.from({ length: RECORDS }, (_, i) => ({
    record_id: `/mark/eu/qzxv${String(i).padStart(5, "0")}`,
    mark_text: `QZXV ${i}`, classes: [32, 33], status: i % 4 ? "Registered" : "Expired",
    owner_name: `Qzxv Owner ${i % 971}`, owner_country: "CH",
    application_date: "2019-04-01", registration_date: "2020-01-15",
    detail: GOODS.repeat(goodsRepeats(i)), _query: "contains qzxv [cl 32]",
    screen: { registry: "EUIPO", live_status: i % 4 ? "live" : "dead", applicationDate: "2019-04-01" },
  }));
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated, crowds: [] }));
  return runDir;
}

/** The server as a seat meets it: one request, its answer, then the next request. */
async function session(runDir, sizes = {}) {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "clearotron-x-y-placement-inquiry", ...sizes } });
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
  const raw = async (args) => (await request("tools/call", { name: "band_lookup", arguments: args })).result.content[0].text;
  const lookup = async (args) => JSON.parse(await raw(args));
  return { raw, lookup, close: () => child.kill("SIGKILL") };
}

/** Follow only the offset each capped answer names; what arrived, in how many calls, and the longest page. */
async function readWhole(s) {
  const seen = [];
  let offset = 0, calls = 0, longest = 0, printed = 0, answer;
  do {
    const text = await s.raw({ limit: 100, offset });
    calls++;
    longest = Math.max(longest, text.length);
    printed = Math.max(printed, quotedBytes(text));
    answer = JSON.parse(text);
    assert.equal(answer.matched, RECORDS, "the full match count rides on every page");
    for (const r of answer.records) seen.push(r.record_id);
    if (answer.next_offset !== undefined) {
      assert.equal(answer.next_offset, offset + answer.returned);
      assert.ok(answer.next_offset > offset, "a page returned nothing and named its own offset");
      assert.match(answer.note, new RegExp(`the next page is available with offset: ${answer.next_offset};`));
      offset = answer.next_offset;
    }
    for (const note of [answer.note, answer.byte_cap_note].filter(Boolean)) {
      assert.doesNotMatch(note, /narrow the filters|smaller slices/, "an answer still tells the seat to slice the band");
    }
    assert.ok(calls <= 200, "the read did not end");
  } while (answer.next_offset !== undefined);
  assert.equal(seen.length, RECORDS, "a record was skipped or returned twice");
  assert.equal(new Set(seen).size, RECORDS, "a record came back twice");
  return { calls, longest, printed };
}

test("given no answer size, a seat following the offset each answer names reads every record once, in about fifty calls", async (t) => {
  const runDir = seedBand();
  const s = await session(runDir);
  try {
    const { calls, longest } = await readWhole(s);
    assert.ok(longest <= 70000, `a page ran to ${longest} characters`);
    assert.ok(calls >= 35 && calls <= 60, `the band took ${calls} calls; the measured band of this size took 49`);
    t.diagnostic(`${RECORDS} records read in ${calls} calls, longest page ${longest} characters`);
  } finally { s.close(); rmSync(runDir, { recursive: true, force: true }); }
});

// Claude Code puts an answer past 50,000 characters into a file the model must read for itself, so Claude
// is given an answer size under that (gather-config.mjs), and the band answers in five sixths of it.
test("on Claude's answer size, every page arrives inline, under the size as printed, and every record still once", async (t) => {
  const runDir = seedBand();
  const size = claudeToolAnswerBytes({});
  const s = await session(runDir, { CLEAROTRON_TOOL_ANSWER_BYTES: String(size) });
  try {
    const { calls, longest, printed } = await readWhole(s);
    assert.ok(longest < 50000, `a page ran to ${longest} characters, where Claude Code would save it to a file`);
    assert.equal(Math.floor(size / 1.2), 37500);
    assert.ok(longest <= 37500, `a page ran to ${longest} characters, over five sixths of the answer size`);
    assert.ok(printed <= size, `a page printed as ${printed} bytes would be split again into parts`);
    assert.ok(calls >= 60 && calls <= 110, `the band took ${calls} calls`);
    t.diagnostic(`${RECORDS} records read in ${calls} calls, longest page ${longest} characters`);
  } finally { s.close(); rmSync(runDir, { recursive: true, force: true }); }
});

test("on codex's answer size, every page fits under its cut and every record still arrives once", async (t) => {
  const runDir = seedBand();
  const size = codexBandAnswerChars({});
  const s = await session(runDir, { CLEAROTRON_BAND_RESPONSE_CHARS: String(size), CLEAROTRON_TOOL_ANSWER_BYTES: String(codexToolAnswerBytes({})) });
  try {
    const { calls, longest, printed } = await readWhole(s);
    assert.ok(longest <= size, `a page ran to ${longest} characters, over the ${size} codex is given`);
    assert.ok(printed <= codexToolAnswerBytes({}), `a page printed as ${printed} bytes would be split again into parts`);
    assert.ok(calls >= 80 && calls <= 130, `the band took ${calls} calls`);
    t.diagnostic(`${RECORDS} records read in ${calls} calls, longest page ${longest} characters`);
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
