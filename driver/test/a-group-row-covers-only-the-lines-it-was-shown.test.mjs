// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GROUP'S ROW COVERS ONLY THE LINES THE STEP WAS SHOWN.
//
// The shape lists a group of a thousand records or more by its first page. A row covering that group
// covered every line of it, so a line the step never saw left with a ground written about the lines it did
// see. Now the row is refused until every line of the group was served, by the shape or by a lookup, and
// `band_lookup` pages a group as the shape lists it, one compact line per mark of an owner, logging what it
// served. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape, deriveRegisterPositions, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { setAsideKeysOf } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const rec = (i) => ({ record_id: `/mark/eu/c${i}`, mark_text: "QZORVAK", owner_name: `Owner ${String(i).padStart(4, "0")} Ltd`, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
function crowded() {
  const band = { enumerated: Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(i)), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "printers" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  return { band, shape, input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups } };
}
const ROW = { set_aside_group: "b", count: CROWDED_GROUP_RECORDS, ground: "identical marks in the class, for goods unrelated to the client's" };

test("a crowded group's row is refused while any of its lines is unserved, and taken once every line was served", () => {
  const { shape, input } = crowded();
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS, "guard: (b) is listed by its first page");
  const shownOnly = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(), records: new Set() } });
  assert.deepEqual(shownOnly.form.set_aside_groups, []);
  assert.match(shownOnly.form.set_aside_group_refused[0].why, /5 of 1000 lines of group b were served: page the rest with band_lookup \{"group":"b"\}/);
  const paged = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(shape.groups.b.list.map((l) => l.key)), records: new Set() } });
  assert.deepEqual(paged.form.set_aside_groups.map((g) => [g.set_aside_group, g.covers_lines]), [["b", CROWDED_GROUP_RECORDS]]);
});

test("a line is served when a lookup returned or opened one of its records", () => {
  const { shape, input } = crowded();
  const keys = new Set(shape.groups.b.list.slice(0, 999).map((l) => l.key));
  const last = shape.groups.b.list[999];
  const short = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: keys, records: new Set() } });
  assert.match(short.form.set_aside_group_refused[0].why, /999 of 1000/);
  const opened = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: keys, records: new Set([last.record_id]) } });
  assert.equal(opened.form.set_aside_groups.length, 1, "the last line's record was opened, so the line was served");
});

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
async function lookup(runDir, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
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

test("band_lookup pages a group as the shape lists it, and the reading log records the lines it served", async () => {
  const { band, shape } = crowded();
  const runDir = mkdtempSync(join(tmpdir(), "group-lookup-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  const page = await lookup(runDir, { group: "b", offset: 5, limit: 3 });
  assert.equal(page.lines_total, CROWDED_GROUP_RECORDS);
  assert.deepEqual(page.lines.map((l) => l.record), shape.groups.b.list.slice(5, 8).map((l) => l.record_id), "the group's own order, from the offset");
  assert.equal(page.next_offset, 8);
  assert.equal(page.lines[0].goods_words, "0 of 1");
  const log = readFileSync(driverDir(runDir, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(log.at(-1).served_lines, shape.groups.b.list.slice(5, 8).map((l) => l.key));
});

test("a group's row answers a floor only in a group of a thousand records or more", async () => {
  const { setAsideGrounds, buildSelectionIndex, parsePlacementForm } = await import("../placement-form.mjs");
  const { reconcileFloorDuty } = await import("../floor-duty.mjs");
  const { shape, input } = crowded();
  const served = { lines: new Set(shape.groups.b.list.map((l) => l.key)), records: new Set() };
  const u = unionPlacementForm(null, { rows: [ROW] }, { ...input, served });
  const entries = parsePlacementForm(JSON.stringify(u.form)).set_aside;
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [], setAsideGroundOf: setAsideGrounds(entries, buildSelectionIndex(input), input.groups, input.floors) });
  assert.equal(input.floors.length, CROWDED_GROUP_RECORDS, "guard: every line of the crowded (b) is a floor");
  assert.equal(duty.undischarged_by_seat, 0, "a crowded group's row is her crowd block: it answers its floors");
});
