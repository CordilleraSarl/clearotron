// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A BAND TOOL SERVES DOES NOT CHANGE WITH THE RUN'S RECORD OF WHAT THE GOODS REST ON.
//
// The run writes down, per band record, what its goods rest on (goods-evidence.mjs). Words the model reads land
// only after the owner has read them, so that record is kept where no band tool serves it: the band shape, a
// lookup and an official record are answered byte for byte as before, whether or not the record exists. Pinned
// on both engines' answer sizes: Claude's, and Codex's smaller one, which splits the shape into more parts. Every
// mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf } from "../placement-form.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { deriveGoodsEvidence, heldRecordProvenance, GOODS_EVIDENCE_FILE } from "../goods-evidence.mjs";
import { CLAUDE_TOOL_ANSWER_BYTES } from "../engine/mcp/gather-config.mjs";
import { CODEX_TOOL_ANSWER_BYTES, CODEX_BAND_ANSWER_CHARS } from "../engine/mcp/codex-config.mjs";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");

async function session(requests, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    const responses = {}; let buf = "";
    const want = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(responses); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
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
const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

const OWNERS = ["Alpha Ltd", "Beta GmbH", "Gamma SA", "Delta AG", "Epsilon Oy", "Zeta BV", "Eta Kft"];
const MARKS = ["QZORVAK", "Qzorvak", "Plimbo", "Drellux"];
function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "served-unchanged-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  // Enough records that the shape is served in parts at Codex's answer size.
  const band = [];
  for (let i = 0; i < 900; i++) band.push({ record_id: `/mark/eu/s${i}`, mark_text: MARKS[i % MARKS.length], owner_name: `${OWNERS[i % OWNERS.length]} ${i}`,
    classes: [i % 3 ? "9" : "28"], status: i % 5 ? "registered" : "expired", jurisdictions: ["EU"] });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: band, crowds: [] }));
  const ledger = band.filter((_, i) => i % 4 === 0).map((r, i) => ({ ts: "2026-10-18T00:00:00Z", provider: "clarivate", sessionKey: "clearance-x-y-register-unit-primary-sweep",
    target: r.record_id, body: { goodsServices: [{ classes: [9], language: "en", description: i % 2 ? "joysticks and game controllers" : "printers" }] } }));
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const byUri = new Map(ledger.map((r) => [r.target, [{ classes: ["9"], text: r.body.goodsServices[0].description }]]));
  const goods = { of: (r) => byUri.get(r.record_id) ?? null, hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const positions = deriveRegisterPositions(band);
  const { shape, md } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    goodsTest: { source: "product_words", words: ["joysticks"] }, keysOf: setAsideKeysOf(positions.positions) });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  writeFileSync(join(runDir, "band-shape.md"), md + "\n");
  return { runDir, band, goods };
}

const REQUESTS = [
  INIT,
  ...[1, 2, 3, 4, 5, 6].map((part, i) => call(10 + i, "band_shape", { part })),
  ...[1, 2, 3, 4, 5, 6].map((part, i) => call(20 + i, "band_shape", { format: "json", part })),
  call(30, "band_lookup", { limit: 100 }),
  call(31, "band_lookup", { goods: ["joysticks"], limit: 50, offset: 10 }),
  call(32, "band_lookup", { tier: "identical", live_only: true }),
  call(33, "band_record", { record_id: "/mark/eu/s0" }),
  call(34, "band_record", { record_id: "/mark/eu/s1" }),
];
const answers = (r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== "1").map(([id, m]) => [id, JSON.stringify(m.result ?? m.error)]));

for (const [engine, env] of [
  ["Claude", { CLEAROTRON_TOOL_ANSWER_BYTES: String(CLAUDE_TOOL_ANSWER_BYTES) }],
  ["Codex", { CLEAROTRON_TOOL_ANSWER_BYTES: String(CODEX_TOOL_ANSWER_BYTES), CLEAROTRON_BAND_RESPONSE_CHARS: String(CODEX_BAND_ANSWER_CHARS) }],
]) {
  test(`${engine}: the shape, the lookups and the records are served byte for byte as before when the record exists`, async (t) => {
    const { runDir, band, goods } = seedRun(t);
    const before = answers(await session(REQUESTS, { ...env, CLEAROTRON_BAND_RUN_DIR: runDir }));
    assert.equal(Object.keys(before).length, REQUESTS.length - 1, "guard: every request was answered");
    assert.ok(before["12"].includes("band_shape part 3/"), `guard: the shape is served in parts at ${engine}'s size`);
    const doc = deriveGoodsEvidence({ records: band, goods, held: heldRecordProvenance(runDir) });
    assert.ok(doc.totals.by_state.complete > 0 && doc.totals.by_state["not-held"] > 0, "guard: the record holds more than one state");
    writeFileSync(driverDir(runDir, GOODS_EVIDENCE_FILE), JSON.stringify(doc, null, 2) + "\n");
    const after = answers(await session(REQUESTS, { ...env, CLEAROTRON_BAND_RUN_DIR: runDir }));
    for (const id of Object.keys(before)) assert.equal(after[id], before[id], `${engine}: answer ${id} changed once the goods record existed`);
  });
}
