// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NICE CLASS READS ONE WAY.
//
// The band shape compared classes as written, so a register that writes class 9 as "09" put a live identical mark
// in that class outside a class-9 order: it made no floor, and the lookup's class filter missed it. "09", "9" and
// 9 are now one class in the shape's scope, its floors, the dominant element's composites and the lookup's class
// filter. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape, dominantElementComposites, niceClassKey } from "../band-shape.mjs";

const rec = (classes, extra = {}) => ({ record_id: "/mark/eu/z1", mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes,
  status: "registered", jurisdictions: ["EU"], ...extra });
const floorsOf = (classes, order) => buildBandShape({ enumerated: [rec(classes)], crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: order })
  .shape.floors.in_class_identical_or_near.length;

test("a live identical mark in class 09 is a floor of a class-9 order, and the other way about", () => {
  assert.deepEqual([niceClassKey("09"), niceClassKey(9), niceClassKey(" 35 "), niceClassKey("IX")], ["9", "9", "35", "IX"]);
  assert.equal(floorsOf(["09"], ["9"]), 1, "a live identical mark in class 09 made no floor of a class-9 order");
  assert.equal(floorsOf(["9"], ["09"]), 1, "an order written 09 left a class-9 mark out");
  assert.equal(floorsOf(["10"], ["9"]), 0, "guard: another class is still out of scope");
});

test("the dominant element's composites read class 09 as class 9", () => {
  const band = { enumerated: [rec(["09"], { mark_text: "QZORVAK BLUE", screen_verdict: "surface:composite" })] };
  assert.equal(dominantElementComposites(band, { dominantElement: "Qzorvak", inScopeClasses: ["9"] })?.length, 1,
    "a composite in class 09 was left out of a class-9 order");
});

const SERVER = fileURLToPath(new URL("../engine/mcp/band-server.mjs", import.meta.url));
async function lookup(runDir, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
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

test("band_lookup's class filter reads class 09 as class 9, either way about", async (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "class-09-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const band = { enumerated: [rec(["09"])], crowds: [] };
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"] }).shape));
  assert.equal((await lookup(runDir, { nice_class: "9" }))?.matched, 1, "class 9 missed a record filed in class 09");
  assert.equal((await lookup(runDir, { nice_class: "09" }))?.matched, 1, "class 09 missed it too");
});
