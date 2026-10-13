// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A BAND ANSWER IN A WIDE SCRIPT FITS ONE RESPONSE.
//
// The band tools trimmed a lookup page and split the shape by characters, against an answer size counted in
// bytes. A page of marks and owners written in a script of three bytes a character came to about three times
// the answer size, so the tool server split the answer a second time and the step read a JSON page in pieces.
// Every answer and every part is now held to the bytes as well. Every mark and owner here is invented, built
// from code points.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { quotedBytes } from "../../shared/answer-parts.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const BUDGET = 36000;
const wide = (i, n) => Array.from({ length: n }, (_, k) => String.fromCodePoint(0x4e00 + ((i * 7 + k * 13) % 2000))).join("");
const MARK = wide(0, 4);
const rec = (i) => ({ record_id: `/mark/cn/w${i}`, mark_text: MARK, owner_name: wide(i + 1, 24), classes: ["9"], status: "registered", jurisdictions: ["CN"] });

function runDirWith(n) {
  const band = { enumerated: Array.from({ length: n }, (_, i) => rec(i)), crowds: [] };
  const goods = { of: () => [{ classes: ["9"], text: "printers" }], hits: goodsWordCounter(["joystick"], { stems: true }), matched: goodsWordsMatched(["joystick"], { stems: true }) };
  const { shape, md } = buildBandShape(band, { targets: [MARK], inScopeClasses: ["9"], goods, goodsWordCount: 1 });
  const runDir = mkdtempSync(join(tmpdir(), "wide-script-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  writeFileSync(join(runDir, "band-shape.md"), md);
  return { runDir, shape, md };
}

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
async function call(runDir, name, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_TOOL_ANSWER_BYTES: String(BUDGET) } });
    child.stdout.setEncoding("utf8");   // a character split across two chunks decodes whole
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(m.result.content[0].text); } } catch { /* not ours */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
}
const splitAgain = (text, tool) => text.startsWith(`[${tool} answer part 1/`);

test("a lookup page of wide-script records is one answer within the answer size, trimmed by its bytes", async () => {
  const { runDir } = runDirWith(400);
  try {
    const text = await call(runDir, "band_lookup", { owner: "", limit: 100 });
    assert.ok(!splitAgain(text, "band_lookup"), "the page was split a second time");
    assert.ok(quotedBytes(text) <= BUDGET, `the page is ${quotedBytes(text)} bytes`);
    const page = JSON.parse(text);
    assert.ok(page.returned < 100 && page.byte_cap_note, "the page was trimmed by its bytes, and says so");
    assert.equal(page.next_offset, page.returned);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a group page of wide-script lines is one answer within the answer size", async () => {
  const { runDir, shape } = runDirWith(400);
  try {
    assert.equal(shape.groups.b.lines, 400, "guard: one identical mark, four hundred owners, goods unrelated");
    const text = await call(runDir, "band_lookup", { group: "b" });
    assert.ok(!splitAgain(text, "band_lookup"), "the page was split a second time");
    assert.ok(quotedBytes(text) <= BUDGET, `the page is ${quotedBytes(text)} bytes`);
    const page = JSON.parse(text);
    assert.deepEqual([page.group, page.lines_total], ["b", 400], "a page of the group's lines");
    assert.ok(page.returned > 0 && page.returned < 200 && page.next_offset === page.returned, "trimmed by its bytes, with the next offset");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a wide-script shape is served in parts that each fit the answer size", async () => {
  const { runDir, md } = runDirWith(400);
  try {
    assert.ok(quotedBytes(md) > BUDGET, "guard: the shape is larger than one answer");
    const first = await call(runDir, "band_shape", {});
    assert.ok(!splitAgain(first, "band_shape"), "the shape part was split a second time");
    assert.ok(quotedBytes(first) <= BUDGET, `part 1 is ${quotedBytes(first)} bytes`);
    const total = Number(first.match(/^\[band_shape part 1\/(\d+)/)?.[1]);
    assert.ok(total > 1, "the shape announces its parts");
    const last = await call(runDir, "band_shape", { part: total });
    assert.ok(quotedBytes(last) <= BUDGET && !splitAgain(last, "band_shape"));
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
