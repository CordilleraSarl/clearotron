// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REST IS LISTED BY THE SIZE RULE (ruled 2026-10-12).
//
// The shape counted the rest at any size and listed none of it. On the third replay a rest of a few hundred
// lines was the one thing the shape withheld, and the step paged the whole band, about a hundred pages, to see
// it: the crowded-field method lists a few hundred. Now the rest is read like any group: listed under a
// thousand records, sorted by the client's goods words and then by live records; at a thousand or more, its
// first page and its count, the rest of it paged with `band_lookup`. Its one row waits for what the size rule
// says must be read. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape, deriveRegisterPositions, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { setAsideKeysOf } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const rec = (id, mark, owner, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"], ...extra });
function shapeOf(enumerated, goodsOf, caps = {}) {
  const positions = deriveRegisterPositions(enumerated);
  const goods = { of: (r) => [{ classes: r.classes, text: goodsOf(r) }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape, md } = buildBandShape({ enumerated, crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), markets: ["EU"], caps });
  return { shape, md, input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups } };
}
// Four marks like nothing the client asked about, so each is in none of (a) to (d).
const SMALL = [
  rec("x4", "Brindle", "Owner X4 Ltd", { status: "expired" }),           // printers, dead
  rec("x3", "Talisk", "Owner X3 Ltd"),                                  // printers, live
  rec("x2", "Morrow", "Owner X2 Ltd", { status: "expired" }),           // the client's goods, dead
  rec("x1", "Vespin", "Owner X1 Ltd", { classes: ["31"] }),             // the client's goods, live, outside the ordered classes
];
const SMALL_GOODS = (r) => (["/mark/eu/x1", "/mark/eu/x2"].includes(r.record_id) ? "joysticks" : "printers");
// The rows of the table printed under the rest's paragraph: its header, its rule, then one row a line.
function restRows(md) {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => l.startsWith("**The rest:"));
  if (at < 0 || lines[at + 1] !== "" || !lines[at + 2]?.startsWith("| mark |")) return [];
  const rows = [];
  for (let i = at + 4; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
  return rows;
}

test("under a thousand records the rest is listed, by the client's goods words and then live records", () => {
  const { shape, md } = shapeOf(SMALL, SMALL_GOODS);
  assert.deepEqual([shape.groups.rest.records, shape.groups.rest.lines], [4, 4], "guard: all four are in the rest");
  assert.deepEqual(shape.groups.rest.list.map((l) => l.record_id), ["/mark/eu/x1", "/mark/eu/x2", "/mark/eu/x3", "/mark/eu/x4"],
    "goods words first, then live records");
  assert.match(md, /\*\*The rest: 4 records in 4 lines from 4 owners\*\* — every record in none of \(a\) to \(d\) above\. Fifty\? Read them all\. Write down what you set aside and why: one row, with this count\./);
  const rows = restRows(md);
  assert.deepEqual(rows.map((l) => l.split("|").at(-2).trim()), ["/mark/eu/x1", "/mark/eu/x2", "/mark/eu/x3", "/mark/eu/x4"], "the rest was counted, not listed");
  const lines = md.split("\n");
  for (const l of shape.groups.rest.list) assert.ok(lines[shape.md_lines[l.key]]?.includes(l.record_id), "each rest line is on the md's line map, so reading its part serves it");
});

test("a rest of a few hundred lines says so, and every line is printed", () => {
  const band = Array.from({ length: 60 }, (_, i) => rec(`p${i}`, `Brantelo ${i}`, `Owner P${i} Ltd`));
  const { shape, md } = shapeOf(band, () => "printers");
  assert.equal(shape.groups.rest.lines, 60);
  assert.match(md, /A few hundred\? Sort by the client's goods and markets, read the near ones first, list the rest\. Write down what you set aside and why: one row, with this count\./);
  assert.equal(restRows(md).length, 60);
});

test("its row waits until every line of a rest under a thousand records was read, and says how to read them", () => {
  const { shape, input } = shapeOf(SMALL, SMALL_GOODS);
  const ROW = { set_aside_group: "rest", count: 4, ground: "none is like the mark, and none is live for the client's goods in the ordered classes" };
  const unread = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(), records: new Set() } });
  assert.equal(unread.form.set_aside_groups.length, 0, "the rest's row was taken over lines never read");
  assert.match(unread.form.set_aside_group_refused[0].why, /^0 of 4 lines of group rest were read: .*page it with band_lookup \{"group":"rest"\}, before its row$/);
  const read = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(shape.groups.rest.list.map((l) => l.key)), records: new Set() } });
  assert.deepEqual(read.form.set_aside_groups.map((g) => [g.set_aside_group, g.covers_lines]), [["rest", 4]]);
});

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
async function lookup(runDir, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(JSON.parse(m.result.content[0].text)); } } catch { /* not ours */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_lookup", arguments: args } }) + "\n");
  });
}

test("at a thousand records or more the rest shows its first page, its row stands on that page read, and band_lookup pages the rest", async (t) => {
  const band = Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(`q${i}`, `Brantelo ${i}`, `Owner Q${String(i).padStart(4, "0")} Ltd`));
  const { shape, md, input } = shapeOf(band, () => "printers", { owners: 5 });
  assert.equal(shape.groups.rest.records, CROWDED_GROUP_RECORDS);
  assert.match(md, /A thousand or more\? The field is crowded\. Read the first page, carry forward any line a lawyer would raise, and set the rest aside in this group's one row with the count: the client is told the field is crowded\. The first 5 lines are below; page with band_lookup \{"group":"rest"\} only where a line needs reading\./);
  assert.equal(restRows(md).length, 5, "the first page, and no more");
  const ROW = { set_aside_group: "rest", count: CROWDED_GROUP_RECORDS, ground: "a crowded field of marks unlike the client's" };
  const firstPage = new Set(shape.groups.rest.list.slice(0, 5).map((l) => l.key));
  assert.equal(unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(), records: new Set() } }).form.set_aside_groups.length, 0,
    "the crowded rest's row was taken with its first page unread");
  assert.equal(unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: firstPage, records: new Set() } }).form.set_aside_groups.length, 1);
  const runDir = mkdtempSync(join(tmpdir(), "rest-lookup-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: band, crowds: [] }));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  const page = await lookup(runDir, { group: "rest", offset: 5, limit: 3 });
  assert.equal(page?.lines_total, CROWDED_GROUP_RECORDS);
  assert.deepEqual(page.lines.map((l) => [l.record, l.mark, l.owner]),
    shape.groups.rest.list.slice(5, 8).map((l) => [l.record_id, l.mark, l.owner_name]), "the rest's own order, each line in full");
});
