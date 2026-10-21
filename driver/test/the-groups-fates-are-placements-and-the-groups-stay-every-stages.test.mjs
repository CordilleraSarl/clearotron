// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE GROUPS' FATES ARE PLACEMENT'S, AND THE GROUPS STAY EVERY STAGE'S.
//
// Three of placement's orders were already served to placement alone (ruled 2026-10-14). Five more sat inside the
// groups' size sentences: a crowded (a)'s floors placed or named, a crowd's one row with its count, the list the
// goods test could not read set aside in one row, and its floors' fates. The shape's commands to page a group also
// reached the reading step, the write-up and the review, naming a lookup only placement is offered. Every stage but
// placement is now served the shape without them (ruled 2026-10-18), and each group's identity, members and count
// stay, as does the fact that a crowded group prints only its first page. No line moves, so the line each listed mark
// is printed on still holds. Placement's shape is the one it read before. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape, withoutPlacementOrders, PLACEMENT_LINE_ORDERS, PLACEMENT_GROUP_ORDERS, groupPageCall } from "../band-shape.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const SERVER = fileURLToPath(new URL("../engine/mcp/band-server.mjs", import.meta.url));
const rec = (i, mark) => ({ record_id: `/mark/eu/q${i}`, mark_text: mark, owner_name: `Owner ${i} Ltd`, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
// A thousand or more in (a), (b), the rest and the list the goods test could not read, so each prints its crowded form.
const N = 1001;
const BAND = [
  ...Array.from({ length: N }, (_, i) => ({ ...rec(i, "QZORVAK"), goods: "joysticks" })),             // (a)
  ...Array.from({ length: N }, (_, i) => ({ ...rec(N + i, "QZORVAK"), goods: "printers" })),          // (b)
  ...Array.from({ length: N }, (_, i) => ({ ...rec(2 * N + i, "DRELLUX"), goods: "printers" })),      // the rest
  ...Array.from({ length: N }, (_, i) => ({ ...rec(3 * N + i, "QZORVAK"), goods: null })),            // goods unread
];
const goods = { of: (r) => (r.goods ? [{ classes: ["9"], text: r.goods }] : null), held: () => false,
  hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
const COMMANDS = [`; page every other line with ${groupPageCall("a")}`, `; page with ${groupPageCall("b")} only where a line needs reading`,
  `; page with ${groupPageCall("rest")} only where a line needs reading`,
  `Where more floors are counted than this page shows, page the rest with ${groupPageCall("no_goods")}; they come first.`];

const shapeOf = (band) => buildBandShape({ enumerated: band, crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods,
  goodsTest: { source: "product_words", words: ["joysticks"] }, goodsWordCount: 1 });

test("placement's shape carries every order and page command, in the words it read before", () => {
  const { md } = shapeOf(BAND);
  // Two orders print only in the short list the goods test could not read: its floors' fate, and what to do with a
  // line of it by its marker. They are checked on that list below.
  const shortListOnly = (x) => x.endsWith("its goods are unknown.") || x.startsWith('A line marked "on file, not readable"');
  for (const s of PLACEMENT_LINE_ORDERS.filter((x) => !shortListOnly(x))) assert.ok(md.includes(s), `placement's shape lost: ${s}`);
  for (const c of COMMANDS) assert.ok(md.includes(c), `placement's shape lost: ${c}`);
  const { md: small } = shapeOf(BAND.slice(3 * N, 3 * N + 3));
  assert.ok(small.includes(PLACEMENT_LINE_ORDERS.find((x) => x.endsWith("its goods are unknown."))), "the short unread list's floor order");
  assert.ok(small.includes(PLACEMENT_LINE_ORDERS.find((x) => x.startsWith('A line marked "on file, not readable"'))), "the short unread list's order by marker");
  assert.ok(!withoutPlacementOrders(small).includes("before its fate"), "another stage is told of a fate");
});

test("every other stage reads the groups without placement's orders and commands, and without a line moving", () => {
  const { md } = shapeOf(BAND);
  const served = withoutPlacementOrders(md);
  for (const s of [...PLACEMENT_LINE_ORDERS, ...PLACEMENT_GROUP_ORDERS, ...COMMANDS]) assert.ok(!served.includes(s), `still served to other stages: ${s}`);
  assert.ok(!/band_lookup \{"group"/.test(served), "a group page is named to a stage that is not offered it");
  assert.equal(served.split("\n").length, md.split("\n").length, "a line moved, so the lines each listed mark is printed on no longer hold");
  const linesOf = (text) => text.split("\n");
  for (const [i, line] of linesOf(md).entries()) if (line.startsWith("|") || line.startsWith("#")) assert.equal(linesOf(served)[i], line, "a heading or a listed line changed");
  assert.equal((served.match(/The first \d+ lines are below\./g) ?? []).length, 3, "a crowded group no longer says it prints only its first page");
  assert.equal((served.match(/The first \d+ lines are below, the floors first/g) ?? []).length, 1);
  assert.ok(/1,001 records in 1,001 lines from 1,001 owners/.test(served), "the groups' counts stay");
});

test("the band server serves placement its shape whole, and every other stage the shape without the orders", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "groups-fates-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  const { shape, md } = shapeOf(BAND.slice(N, 2 * N));
  writeFileSync(driverDir(dir, "band-shape.json"), JSON.stringify(shape));
  writeFileSync(join(dir, "band-shape.md"), md);
  const served = async (groupPages) => await new Promise((resolve, reject) => {
    const env = { ...process.env, CLEAROTRON_BAND_RUN_DIR: dir };
    delete env.CLEAROTRON_BAND_GROUPS;
    if (groupPages) env.CLEAROTRON_BAND_GROUPS = "1";
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env });
    child.stdout.setEncoding("utf8");
    let buf = "", text = null;
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { text = m.result?.content?.map((c) => c.text).join("") ?? null; clearTimeout(timer); child.kill("SIGKILL"); resolve(text); } } catch { /* not json */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_shape", arguments: {} } }) + "\n");
  });
  const placement = await served(true), other = await served(false);
  assert.ok(placement.includes(PLACEMENT_LINE_ORDERS[1]) && placement.includes(COMMANDS[1]), "placement reads the crowd's row order and its page command");
  assert.ok(!other.includes(PLACEMENT_LINE_ORDERS[1]) && !other.includes(COMMANDS[1]), "another stage reads them");
  assert.ok(/The first \d+ lines are below\./.test(other));
});
