// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// PLACEMENT'S ORDERS REACH PLACEMENT ALONE.
//
// Four sentences tell the reader to give the band's lines and floors their fates: three the shape prints under
// its groups, and the reading contract's "Every floor has a fate on the form." Only placement owes those fates.
// The register digest and synthesis read the same shape and the same contract, and a synthesis that was told a
// group is read line by line paged one 2,519 times (measured on a test run, 2026-10-13). Ruled 2026-10-14: the
// digest and synthesis read both without the four sentences, placement reads both unchanged, and no word is
// added. This file shows, stage by stage, which of the four each one is given. Invented data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { SORT_THE_NEAR_ONES, ONE_SET_ASIDE_ROW, A_FATE_BY_NAME, PLACEMENT_GROUP_ORDERS } from "../band-shape.mjs";
import { STAGES, paths, BAND_READING_STAGES, GROUP_READING_STAGES, BAND_READING_CONTRACT,
  BAND_READING_CONTRACT_AFTER_PLACEMENT, FLOOR_FATE_ORDER } from "../stages.mjs";

const SERVER = fileURLToPath(new URL("../engine/mcp/band-server.mjs", import.meta.url));
const SENTENCES = { "sort the near ones": SORT_THE_NEAR_ONES, "one set-aside row": ONE_SET_ASIDE_ROW,
  "a fate by name": A_FATE_BY_NAME, "every floor has a fate": FLOOR_FATE_ORDER };

// The three group orders in the places the shape prints them: after a group's count, twice in the rest's line,
// and inside the no-goods line between the size sentence and the next. The listed line's row sits below each.
const SHAPE_MD = [
  "## The band in the lawyer's order — for the client's goods first", "",
  "### (b) Identical marks in the ordered classes, for other goods", "",
  `120 records in 64 lines from 60 owners. ${SORT_THE_NEAR_ONES}`, "",
  "| mark | owner | classes | live | territories | goods words | floor | record |", "|---|---|---|---|---|---|---|---|",
  "| QZORVAK | Alpha Ltd | 9 | 1 of 1 | EU | 0 of 1 | no | /mark/eu/1 |", "",
  `**The rest: 90 records in 70 lines from 66 owners** — every record in none of (a) to (d) above. ${SORT_THE_NEAR_ONES} ${ONE_SET_ASIDE_ROW}`, "",
  `**Goods the test could not read: 3 records in 2 lines from 2 owners.** Fifty? Read them all. ${A_FATE_BY_NAME} A floor here is placed, or set aside by name on its status or its territory.`,
].join("\n");

function runDir(t) {
  const d = mkdtempSync(join(tmpdir(), "placement-orders-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(driverDir(d), { recursive: true });
  const line = { key: "line:owner:alpha ltd|qzorvak", owner_key: "owner:alpha ltd", owner_name: "Alpha Ltd", mark: "QZORVAK", classes: ["9"],
    live: 1, records: 1, territories: ["EU"], goods_words: [], floors: 0, record_id: "/mark/eu/1" };
  writeFileSync(driverDir(d, "band-shape.json"), JSON.stringify({ groups: { b: { records: 1, lines: 1, list: [line] }, goods_words_total: 1 },
    md_lines: { [line.key]: 8 } }));
  writeFileSync(join(d, "band-shape.md"), SHAPE_MD);
  return d;
}

/** The shape as the band server serves it to a stage, with or without the placement flag the driver sets. */
async function shapeServed(dir, groupPages) {
  return await new Promise((resolve, reject) => {
    const env = { ...process.env, CLEAROTRON_BAND_RUN_DIR: dir };
    delete env.CLEAROTRON_BAND_GROUPS;
    if (groupPages) env.CLEAROTRON_BAND_GROUPS = "1";
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try {
          const m = JSON.parse(line);
          if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(m.result.content[0].text); }
        } catch { /* not ours */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_shape", arguments: {} } }) + "\n");
  });
}

const given = (text) => Object.entries(SENTENCES).filter(([, s]) => text.includes(s)).map(([name]) => name);

test("each band-reading stage is given the four sentences only if it is placement", async (t) => {
  const dir = runDir(t);
  const P = paths(dir);
  const served = { true: await shapeServed(dir, true), false: await shapeServed(dir, false) };
  const table = {};
  for (const stage of [...BAND_READING_STAGES].sort()) {
    const message = String(STAGES[stage].message({ paths: P, axes: ["primary-sweep"], registerOnly: true, job: {} }));
    table[stage] = given(message + "\n" + served[GROUP_READING_STAGES.has(stage)]);
  }
  assert.deepEqual(table, {
    "placement-inquiry": ["sort the near ones", "one set-aside row", "a fate by name", "every floor has a fate"],
    "register-digest": [],
    synthesis: [],
  });
});

test("placement reads the shape and the contract exactly as before; the others, the same less the four sentences", async (t) => {
  const dir = runDir(t);
  const placement = await shapeServed(dir, true);
  const other = await shapeServed(dir, false);
  assert.equal(placement, SHAPE_MD, "placement's shape changed");
  assert.equal(other, SHAPE_MD.split(` ${SORT_THE_NEAR_ONES}`).join("").split(` ${ONE_SET_ASIDE_ROW}`).join("").split(` ${A_FATE_BY_NAME}`).join(""),
    "the other stages' shape lost more than the three orders, or kept one");
  // No line moves, so the line each listed mark is printed on still holds for the reading audit.
  assert.equal(other.split("\n").length, placement.split("\n").length);
  assert.ok(other.includes("120 records in 64 lines from 60 owners.\n"), "a count lost its full stop or kept a trailing space");
  assert.ok(other.includes("Fifty? Read them all. A floor here is placed"), "the sentences either side of an order were not rejoined by one space");

  const P = paths(dir);
  const message = (stage) => String(STAGES[stage].message({ paths: P, axes: ["primary-sweep"], registerOnly: true, job: {} }));
  assert.ok(message("placement-inquiry").includes(BAND_READING_CONTRACT), "placement's contract changed");
  for (const stage of ["register-digest", "synthesis"]) assert.ok(message(stage).includes(BAND_READING_CONTRACT_AFTER_PLACEMENT));
  assert.equal(BAND_READING_CONTRACT.replace(` ${FLOOR_FATE_ORDER}`, ""), BAND_READING_CONTRACT_AFTER_PLACEMENT);
  assert.notEqual(BAND_READING_CONTRACT, BAND_READING_CONTRACT_AFTER_PLACEMENT, "the floor order is no longer in the contract to remove");
  assert.equal(PLACEMENT_GROUP_ORDERS.length, 3);
});
