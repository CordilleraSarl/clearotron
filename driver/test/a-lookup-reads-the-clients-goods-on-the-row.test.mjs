// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LOOKUP READS THE CLIENT'S GOODS ON THE ROW, AS THE SHAPE TESTS THEM.
//
// The crowded-field method reads identical marks for the client's particular goods first, and a band row
// carried no goods. `band_lookup` now gives each record the client's goods words its goods hold, tested on
// the same words and stems the shape grouped on, from the records the run already holds; the goods text
// stays one `band_record` away. It also filters on goods words, a record with no goods on file matching
// too. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape } from "../band-shape.mjs";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");

async function session(requests, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    const responses = {}; let buf = "";
    const want = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(responses); };
    const timer = setTimeout(done, 8000);
    child.stdout.setEncoding("utf8");   // a character split across two chunks decodes whole
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) { responses[m.id] = m; want.delete(m.id); } } catch { /* not json */ }
      }
      if (want.size === 0) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
const call = (id, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "band_lookup", arguments: args } });
const body = (r, id) => JSON.parse(r[id]?.result?.content?.[0]?.text ?? "{}");

function seedRun() {
  const runDir = mkdtempSync(join(tmpdir(), "lookup-goods-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const rec = (id, owner, classes) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", classes, status: "Registered", owner_name: owner });
  const band = { enumerated: [rec("g1", "Alpha Ltd", [9]), rec("g2", "Beta GmbH", [9]), rec("g3", "Gamma SA", [9]), rec("g4", "Delta AG", [9, 25]),
    { ...rec("g5", "Epsilon Oy", [9]), record_id: "/mark/us/g5", goods: "joysticks for consoles" }], crowds: [] };   // untagged: read as English on the US register
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], goodsTest: { source: "product_words", words: ["joystick", "game controller"] } });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  const bodyOf = (statements) => ({ goodsServices: statements.map(([c, t]) => ({ classes: [c], language: "en", description: t })) });
  const ledger = [
    { target: "/mark/eu/g1", body: bodyOf([[9, "game controllers and joysticks"]]) },
    { target: "/mark/eu/g2", body: bodyOf([[9, "printers"]]) },
    // g3: no body on file — its goods are unknown.
    { target: "/mark/eu/g4", body: bodyOf([[25, "clothing"], [9, `${"printer cartridges; ".repeat(120)}joysticks`]]) },
  ];
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), ledger.map((r) => JSON.stringify({ ts: "2026-10-12T00:00:00Z", ...r })).join("\n") + "\n");
  return runDir;
}

test("each record carries the goods words the shape tests, k of N, and never the goods text", async () => {
  const runDir = seedRun();
  const r = await session([INIT, call(2, { limit: 10 })], { CLEAROTRON_BAND_RUN_DIR: runDir });
  const byId = Object.fromEntries(body(r, 2).records.map((x) => [x.record_id, x]));
  assert.equal(byId["/mark/eu/g1"].goods_words, "2 of 2: joystick, game controller", "stems: joysticks and game controllers match");
  assert.equal(byId["/mark/eu/g2"].goods_words, "0 of 2");
  assert.equal(byId["/mark/eu/g3"].goods_words, null, "a record with no body on file has no goods to test, said as null");
  assert.equal(byId["/mark/eu/g4"].goods_words, "1 of 2: joystick", "the whole text is tested, however long");
  assert.equal(byId["/mark/us/g5"].goods_words, "1 of 2: joystick", "a row's own goods stand in where the run holds no body");
  for (const x of Object.values(byId)) assert.equal(x.goods, undefined, "no goods text on a lookup row");
});

test("the goods filter keeps records whose goods hold any of the words, and records with no goods on file", async () => {
  const runDir = seedRun();
  const r = await session([INIT, call(2, { goods: ["joysticks", "game controllers"] }), call(3, { goods: "printers" })], { CLEAROTRON_BAND_RUN_DIR: runDir });
  assert.deepEqual(body(r, 2).records.map((x) => x.record_id).sort(), ["/mark/eu/g1", "/mark/eu/g3", "/mark/eu/g4", "/mark/us/g5"],
    "g4's joysticks sit past the row's cut and still match: the test reads the whole text");
  assert.deepEqual(body(r, 3).records.map((x) => x.record_id).sort(), ["/mark/eu/g2", "/mark/eu/g3", "/mark/eu/g4"],
    "one word as a string works as a list of one, singular or plural: printers finds g4's printer cartridges");
});

test("the tool says what the goods filter does and what the served goods mean", async () => {
  // Placement's offer, which carries the group filter (stages.mjs GROUP_READING_STAGES).
  const r = await session([INIT, { jsonrpc: "2.0", id: 2, method: "tools/list" }], { CLEAROTRON_BAND_RUN_DIR: mkdtempSync(join(tmpdir(), "lookup-goods-list-")), CLEAROTRON_BAND_GROUPS: "1" });
  const lookup = (r[2]?.result?.tools ?? []).find((t) => t.name === "band_lookup");
  assert.ok(lookup.description.includes("goods (words: records whose goods contain any of them, as whole words, singular or plural; a record with no goods on file matches too)"));
  assert.ok(lookup.description.includes("`goods_words` gives the client's goods words its goods hold, as the shape tests them (k of N: the words), or null where its goods cannot be read; `goods_from` says what those goods rest on: official record; official record, cut by the register; official record, completeness not established; official record, no goods listed; search answer; search answer, cut by the register; search answer, completeness not established; fetch failed; or nothing held. The goods text is in band_record."));
  assert.ok(lookup.description.includes("group (a, b, c, d, rest or no_goods: that list's lines in the shape's order, one per mark of an owner)"));
  assert.ok(lookup.inputSchema.properties.goods, "the filter is in the schema");
});
