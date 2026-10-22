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
import { readServed } from "../placement-form-io.mjs";

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

test("a crowded (b)'s row stands on its first page read and the count: refused while that page is unread, then covering the floors read", () => {
  const { shape, input } = crowded();
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS, "guard: (b) is listed by its first page");
  const unread = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(), records: new Set() } });
  assert.deepEqual(unread.form.set_aside_groups, []);
  assert.match(unread.form.set_aside_group_refused[0].why, /^0 of the first 5 lines of group b were read: read the parts of band_shape that print them, before its row$/, "no paging is asked of a crowd");
  const firstPage = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(shape.groups.b.list.slice(0, 5).map((l) => l.key)), records: new Set() } });
  // Every line of this crowd holds a floor, and the row covers a floor only once its line has been read: the
  // first page's five are covered, and every other floor is said back for the step to read.
  assert.deepEqual(firstPage.form.set_aside_groups.map((g) => [g.set_aside_group, g.covers_lines, g.floors_not_covered?.length ?? 0]),
    [["b", 5, CROWDED_GROUP_RECORDS - 5]], "the first page read and the count: the row stands, and covers only the floors read");
});

test("group (a) is held to the same rule: its row over lines never served is refused", () => {
  const band = { enumerated: Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(i)), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  assert.equal(shape.groups.a.records, CROWDED_GROUP_RECORDS, "guard: (a) is listed by its first page");
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups };
  const row = { set_aside_group: "a", count: CROWDED_GROUP_RECORDS, ground: "a crowded field; none trades where the client trades" };
  const shown = unionPlacementForm(null, { rows: [row] }, { ...input, served: { lines: new Set(), records: new Set() } });
  assert.deepEqual(shown.form.set_aside_groups, [], "the row covered (a)'s lines past the first page unseen");
  assert.match(shown.form.set_aside_group_refused[0].why, /0 of 1000 lines of group a were read/);
});

test("a row on (a) never answers a floor, however many records (a) holds; only a crowded (b)'s row may", async () => {
  const { setAsideGrounds, buildSelectionIndex, parsePlacementForm } = await import("../placement-form.mjs");
  const { reconcileFloorDuty } = await import("../floor-duty.mjs");
  const band = { enumerated: Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(i)), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape, md } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  assert.equal(shape.groups.a.records, CROWDED_GROUP_RECORDS, "guard: (a) holds a thousand floors");
  const sectionA = md.slice(md.indexOf("### (a)"), md.indexOf("### (b)"));
  assert.match(sectionA, /These are the identical and near-identical marks live in the ordered classes for the client's goods: read every line\./);
  assert.doesNotMatch(sectionA, /do not write up the rest/, "(a) is read, never left unwritten");
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups };
  const served = { lines: new Set(shape.groups.a.list.map((l) => l.key)), records: new Set() };
  const u = unionPlacementForm(null, { rows: [{ set_aside_group: "a", count: CROWDED_GROUP_RECORDS, ground: "a crowded field" }] }, { ...input, served });
  const a = u.form.set_aside_groups.find((g) => g.set_aside_group === "a");
  assert.deepEqual([a.covers_lines, a.floors_not_covered.length], [0, CROWDED_GROUP_RECORDS], "every floor in (a) is said back, none covered");
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [], setAsideGroundOf: setAsideGrounds(parsePlacementForm(JSON.stringify(u.form)).set_aside, buildSelectionIndex(input), input.groups, input.floors) });
  assert.equal(duty.undischarged_by_seat, CROWDED_GROUP_RECORDS, "the floor duty still owes every (a) floor");
});

test("a line is served when a lookup returned or opened one of its records", () => {
  // (a) needs every line at any size, so a crowded (a) shows it.
  const band = { enumerated: Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(i)), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups };
  const ROW_A = { set_aside_group: "a", count: CROWDED_GROUP_RECORDS, ground: "every floor here is placed or named" };
  const keys = new Set(shape.groups.a.list.slice(0, 999).map((l) => l.key));
  const last = shape.groups.a.list[999];
  const short = unionPlacementForm(null, { rows: [ROW_A] }, { ...input, served: { lines: keys, records: new Set() } });
  assert.match(short.form.set_aside_group_refused[0].why, /^999 of 1000 lines of group a were read: page it with band_lookup \{"group":"a"\}, before its row$/);
  const opened = unionPlacementForm(null, { rows: [ROW_A] }, { ...input, served: { lines: keys, records: new Set([last.record_id]) } });
  assert.equal(opened.form.set_aside_groups.length, 1, "the last line's record was opened, so the line was served");
});

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
async function lookup(runDir, args, name = "band_lookup", env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, ...env } });
    child.stdout.setEncoding("utf8");   // a character split across two chunks decodes whole
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); const t = m.result.content[0].text; resolve(name === "band_lookup" ? JSON.parse(t) : t); } } catch { /* not ours */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) + "\n");
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

test("band_lookup's class filter reads class 09 as class 9", async () => {
  const band = { enumerated: [{ record_id: "/mark/eu/z9", mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes: ["09"], status: "registered", jurisdictions: ["EU"] }], crowds: [] };
  const runDir = mkdtempSync(join(tmpdir(), "class-09-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"] }).shape));
  const page = await lookup(runDir, { nice_class: "9" });
  assert.equal(page.matched, 1);
});

test("band_lookup pages the lines the goods test could not place, and logs them read", async () => {
  const band = { enumerated: Array.from({ length: 30 }, (_, i) => ({ record_id: `/mark/eu/q${i}`, mark_text: "QZORVAK", owner_name: `Owner Q${i} Ltd`, classes: ["9"], status: "registered", jurisdictions: ["EU"] })), crowds: [] };
  const goods = { of: () => null, hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1 });
  assert.equal(shape.groups.no_goods.lines, 30, "guard: no goods on file for any record");
  const runDir = mkdtempSync(join(tmpdir(), "no-goods-page-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  const page = await lookup(runDir, { group: "no_goods", limit: 10 });
  assert.deepEqual([page.group, page.lines_total, page.returned, page.lines[0].goods_on_file], ["no_goods", 30, 10, false]);
  assert.equal(readServed(runDir).lines.size, 10, "the page's lines are read");
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
  assert.equal(duty.undischarged_by_seat, 0, "a crowded group's row is the crowded field's block: it answers its floors");
});

test("a ground by name covers the named mark only, never the owner's other marks in the rest", async () => {
  const { setAsideGrounds, buildSelectionIndex, parsePlacementForm } = await import("../placement-form.mjs");
  const band = { enumerated: [
    { record_id: "/mark/eu/n1", mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes: ["9"], status: "registered", jurisdictions: ["EU"] },
    { record_id: "/mark/jp/n2", mark_text: "QZORVAK PRO", owner_name: "Alpha Ltd", classes: ["9"], status: "registered", jurisdictions: ["JP"] },
  ], crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joystick"], { stems: true }), matched: goodsWordsMatched(["joystick"], { stems: true }) };
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), territories: ["EU"] });
  assert.equal(shape.groups.rest.list.length, 1, "guard: Alpha's Japanese mark is held only outside the EU order");
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups };
  const u = unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/n1", ground: "the registration lapsed and was not renewed", on: "status" }] }, input);
  const groundOf = setAsideGrounds(parsePlacementForm(JSON.stringify(u.form)).set_aside, buildSelectionIndex(input), input.groups, input.floors);
  assert.equal(groundOf("/mark/eu/n1").by, "name");
  assert.equal(groundOf("/mark/jp/n2"), null, "the owner's other mark keeps its own fate to be given");
});

test("a line printed in a part of the shape the step never read is not served, and the refusal names the part", async () => {
  // Three hundred live marks of other owners in the ordered class, for the client's goods: one long (d).
  const band = { enumerated: Array.from({ length: 300 }, (_, i) => ({ record_id: `/mark/eu/d${i}`, mark_text: `PLOVENTAR ${i}`, owner_name: `Owner D${i} AG`,
    classes: ["9"], status: "registered", jurisdictions: ["EU"] })), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape, md } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1, keysOf: setAsideKeysOf(positions.positions) });
  assert.equal(shape.groups.d.lines, 300, "guard: (d) is listed whole, three hundred lines");
  const runDir = mkdtempSync(join(tmpdir(), "parts-read-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  writeFileSync(join(runDir, "band-shape.md"), md);
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups };
  const ROW_D = { set_aside_group: "d", count: 300, ground: "similar to none of the mark's forms" };

  const unread = unionPlacementForm(null, { rows: [ROW_D] }, { ...input, served: readServed(runDir) });
  assert.match(unread.form.set_aside_group_refused[0].why, /^0 of 300 lines of group d were read: read the parts of band_shape that print it, or page it with band_lookup \{"group":"d"\}, before its row$/,
    "an empty reading log serves nothing, however much the shape printed");

  const SMALL = { CLEAROTRON_BAND_RESPONSE_CHARS: "8000" };
  const first = await lookup(runDir, {}, "band_shape", SMALL);
  const total = Number(first.match(/^\[band_shape part 1\/(\d+)/)[1]);
  const served1 = readServed(runDir);
  const dParts = served1.group_parts.d;
  assert.ok(dParts.length > 1 && dParts.includes(total), "guard: (d) runs over several parts, to the last");
  const partial = unionPlacementForm(null, { rows: [ROW_D] }, { ...input, served: served1 });
  const left = dParts.filter((p) => p !== 1);
  assert.match(partial.form.set_aside_group_refused[0].why,
    new RegExp(`lines of group d were read: read band_shape ${left.map((p) => `part ${p}`).join(" and ")}, or page it with band_lookup \\{"group":"d"\\}, before its row$`), "the refusal names the parts left unread");

  for (let p = 2; p <= total; p++) await lookup(runDir, { part: p }, "band_shape", SMALL);
  const all = unionPlacementForm(null, { rows: [ROW_D] }, { ...input, served: readServed(runDir) });
  assert.deepEqual(all.form.set_aside_groups.map((g) => [g.set_aside_group, g.covers_lines]), [["d", 300]], "every part read: the row is taken");
});

test("the rest's row never answers a floor: one held outside the order's territories waits in its group", async () => {
  const { setAsideGrounds, buildSelectionIndex, parsePlacementForm } = await import("../placement-form.mjs");
  const { reconcileFloorDuty } = await import("../floor-duty.mjs");
  // An EU order. One live identical mark held only in Japan, and a thousand unrelated marks held there too.
  const enumerated = [{ record_id: "/mark/jp/v1", mark_text: "QZORVAK", owner_name: "Owner K KK", classes: ["9"], status: "registered", jurisdictions: ["JP"] },
    ...Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => ({ record_id: `/mark/jp/u${i}`, mark_text: `BRANTELO ${i}`, owner_name: `Owner U${i} KK`,
      classes: ["9"], status: "registered", jurisdictions: ["JP"] }))];
  const positions = deriveRegisterPositions(enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "printers" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated, crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), territories: ["EU"] });
  assert.deepEqual([shape.groups.rest.records, shape.groups.b.lines], [CROWDED_GROUP_RECORDS, 1], "the floor is listed in (b); the rest is the thousand others");
  // The step read the rest's first page, which the shape prints: a crowded rest's row stands on it and the count.
  const firstPage = new Set(shape.groups.rest.list.slice(0, shape.groups.first_page).map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups, served: { lines: firstPage, records: new Set() } };
  const u = unionPlacementForm(null, { rows: [{ set_aside_group: "rest", count: CROWDED_GROUP_RECORDS, ground: "held only outside the order's territories" }] }, input);
  assert.equal(u.form.set_aside_groups.length, 1, "guard: the rest's row is taken");
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [], setAsideGroundOf: setAsideGrounds(parsePlacementForm(JSON.stringify(u.form)).set_aside, buildSelectionIndex(input), input.groups, input.floors) });
  assert.equal(duty.undischarged_by_seat, 1, "the floor held outside the territories is still owed a fate of its own");
});

test("only placement's own reads serve a line: what another stage read does not count", () => {
  const runDir = mkdtempSync(join(tmpdir(), "own-reads-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const entry = (session, keys) => JSON.stringify({ tool: "band_lookup", ok: true, served_lines: keys, ...(session ? { session } : {}) });
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), [
    entry("clearance-acme-x1-register-digest", ["line:digest-read"]),
    entry("clearance-acme-x1-synthesis", ["line:synthesis-read"]),
    entry("clearance-acme-x1-placement-inquiry", ["line:placement-read"]),
    entry(null, ["line:untagged-read"]),
  ].join("\n") + "\n");
  assert.deepEqual([...readServed(runDir).lines].sort(), ["line:placement-read", "line:untagged-read"]);
});

test("a crowded list of lines the goods test could not place takes one row on its first page and the count, which never covers a floor; a short one takes none", async () => {
  const { setAsideGrounds, buildSelectionIndex, parsePlacementForm } = await import("../placement-form.mjs");
  const { reconcileFloorDuty } = await import("../floor-duty.mjs");
  const make = (n) => {
    const band = { enumerated: Array.from({ length: n }, (_, i) => rec(i)), crowds: [] };
    const positions = deriveRegisterPositions(band.enumerated);
    const goods = { of: () => null, hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
    const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1, keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
    return { shape, input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups } };
  };
  const ROW_NG = (n) => ({ set_aside_group: "no_goods", count: n, ground: "goods unreadable, crowded" });
  const big = make(CROWDED_GROUP_RECORDS);
  assert.equal(big.shape.groups.no_goods.records, CROWDED_GROUP_RECORDS, "guard: no goods on file anywhere");
  const firstPage = new Set(big.shape.groups.no_goods.list.slice(0, 5).map((l) => l.key));
  const u = unionPlacementForm(null, { rows: [ROW_NG(CROWDED_GROUP_RECORDS)] }, { ...big.input, served: { lines: firstPage, records: new Set() } });
  const row = u.form.set_aside_groups.find((g) => g.set_aside_group === "no_goods");
  assert.deepEqual([row.covers_lines, row.floors_not_covered.length], [0, CROWDED_GROUP_RECORDS], "every line here holds a floor: none is covered, each is said back");
  const duty = reconcileFloorDuty({ floors: big.input.floors, placements: [], setAsideGroundOf: setAsideGrounds(parsePlacementForm(JSON.stringify(u.form)).set_aside, buildSelectionIndex(big.input), big.input.groups, big.input.floors) });
  assert.equal(duty.undischarged_by_seat, CROWDED_GROUP_RECORDS, "a floor whose goods cannot be read is (a)'s kind: it takes its fate by name, at any size");
  const small = make(30);
  const v = unionPlacementForm(null, { rows: [ROW_NG(30)] }, { ...small.input, served: { lines: new Set(small.shape.groups.no_goods.list.map((l) => l.key)), records: new Set() } });
  assert.match(v.form.set_aside_group_refused[0].why, /take a row only at a thousand records or more/);
});
