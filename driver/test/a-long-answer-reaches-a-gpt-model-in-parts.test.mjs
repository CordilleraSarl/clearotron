// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LONG TOOL ANSWER REACHES A GPT MODEL IN PARTS, WHOLE, AND THE TOOL RUNS ONCE.
//
// Codex keeps 10,000 tokens of any tool answer, from its start and its end, and removes the middle; past
// about 39,000 bytes a model on that engine reads an answer with a hole in it and is not told what was in
// the hole. Register searches, research answers, fetched pages and case-law results all run past that size
// on real matters. Every local server answers through serve() (engine/mcp/stdio-server.mjs), so that is
// where the size is kept: given an answer size, a longer answer is served in parts, each under the size
// with its banners, the whole held in the server so a later part is read without running the tool again.
// Given no size, every answer is served exactly as before. All text here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { driverDir } from "../../shared/driver-dir.mjs";
import {
  ANSWER_PART_ARG, answerBudget, quotedBytes, splitAnswer, answerPieces, servedPart, takePart, heldAnswers, withAnswerPart,
} from "../../shared/answer-parts.mjs";
import { codexToolAnswerBytes } from "../engine/mcp/codex-config.mjs";

const STDIO_SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "stdio-server.mjs");
const bytes = (s) => quotedBytes(s);   // as the engine counts a printed answer: a quote or line break is two
const SIZE = codexToolAnswerBytes({});

/** An answer the length of a long register or research answer: lines of invented records, markers spread through. */
function longAnswer(lines = 900) {
  return Array.from({ length: lines }, (_, i) => `{"record_id": "/mark/eu/qzxv${String(i).padStart(5, "0")}", "mark_text": "QZXV ${i}", `
    + `"owner": "Qzxv Holder ${i % 97}", "goods": "beverages, namely mineral and aerated waters"${i % 75 === 0 ? `, "marker": "MARKER-${String(i / 75).padStart(2, "0")}"` : ""}}`).join("\n");
}

// The body of a served part: what lies between its two banner lines.
const bodyOf = (served) => served.slice(served.indexOf("]\n") + 2, served.lastIndexOf("\n[end of part"));

test("an answer is cut into pieces under the size counted as a quoted string, never inside a character, and the pieces give it back exactly", () => {
  const latin = longAnswer();
  const pieces = splitAnswer(latin, 30000);
  assert.ok(pieces.length >= 3);
  assert.equal(pieces.join(""), latin);
  assert.ok(pieces.every((p) => bytes(p) <= 30000));
  assert.ok(pieces.slice(0, -1).every((p) => p.endsWith("\n")), "a piece ends at a line break when it holds one");
  const nonLatin = "Ωμέγα 数字 Ŵ ".repeat(9000);   // one line, two- and three-byte characters
  const cut = splitAnswer(nonLatin, 10000);
  assert.equal(cut.join(""), nonLatin, "a line longer than a piece is cut on character boundaries");
  assert.ok(cut.every((p) => bytes(p) <= 10000 && !p.includes("�")));
  assert.deepEqual(splitAnswer("short", 10000), ["short"]);
  for (const t of [latin, nonLatin, 'a "quoted" \\ path\n'.repeat(500)]) assert.equal(quotedBytes(t), Buffer.byteLength(JSON.stringify(t)) - 2);
});

test("every served part, banners included, is under the size, and the parts name the next call", () => {
  for (const text of [longAnswer(), longAnswer(3000), "Ωμέγα 数字\n".repeat(12000)]) {
    const pieces = answerPieces(text, SIZE, "register_propose_supplemental");
    assert.ok(pieces.length >= 2);
    assert.equal(pieces.join(""), text);
    pieces.forEach((_, i) => {
      const served = servedPart("register_propose_supplemental", pieces, i + 1);
      assert.ok(bytes(served) <= SIZE, `part ${i + 1} is ${bytes(served)} bytes, over ${SIZE}`);
      assert.equal(bodyOf(served), pieces[i]);
      assert.match(served, new RegExp(`^\\[register_propose_supplemental answer part ${i + 1}/${pieces.length} — `));
      if (i + 1 < pieces.length) assert.match(served, new RegExp(`\\{"${ANSWER_PART_ARG}": ${i + 2}\\} for the next part\\]$`));
      else assert.match(served, /the answer is complete once parts 1\.\.\d+ are all read\]$/);
    });
  }
  assert.deepEqual(answerPieces("a short answer", SIZE, "t"), ["a short answer"], "an answer that fits is one piece");
  assert.deepEqual(answerPieces(longAnswer(), 0, "t"), [longAnswer()], "no size, no pieces");
});

test("the size is read from the server's environment, a part is taken off the arguments, held answers are found by their arguments", () => {
  assert.equal(answerBudget({}), 0);
  assert.equal(answerBudget({ CLEAROTRON_TOOL_ANSWER_BYTES: "36000" }), 36000);
  assert.equal(answerBudget({ CLEAROTRON_TOOL_ANSWER_BYTES: "100" }), 8192, "never under 8 KB");
  assert.deepEqual(takePart({ q: "x", [ANSWER_PART_ARG]: 3 }), { args: { q: "x" }, part: 3 });
  assert.deepEqual(takePart({ q: "x" }), { args: { q: "x" }, part: null });
  const held = heldAnswers(2);
  held.hold("t", { b: 1, a: [1, { d: 2, c: 3 }] }, ["p1", "p2"]);
  assert.deepEqual(held.get("t", { a: [1, { c: 3, d: 2 }], b: 1 }), ["p1", "p2"], "the order of keys does not matter");
  held.hold("t", { n: 2 }, ["x"]); held.hold("t", { n: 3 }, ["y"]);
  assert.equal(held.get("t", { b: 1, a: [1, { d: 2, c: 3 }] }), null, "the oldest goes once the limit is held");
  assert.deepEqual(withAnswerPart({ type: "object", properties: { q: { type: "string" } }, required: ["q"] }),
    { type: "object", properties: { q: { type: "string" }, [ANSWER_PART_ARG]: { type: "number" } }, required: ["q"] });
});

// ── the real serve(), over MCP, as the engine meets it ───────────────────────────────────────────────────
function writeServer(dir) {
  const path = join(dir, "server.mjs");
  writeFileSync(path, `import { serve } from ${JSON.stringify(pathToFileURL(STDIO_SERVER).href)};
const LONG = ${JSON.stringify(longAnswer())};
serve({ name: "probe", tools: [
  { name: "long_answer", description: "a long answer", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: { readOnlyHint: true }, handler: async () => LONG },
  { name: "short_answer", description: "a short answer", inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true }, handler: async () => "four words, no more" },
]});
`);
  return path;
}

async function session(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...env } });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (l) => { try { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); } catch { /* not ours */ } });
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const mine = ++id; const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 10000);
    pending.set(mine, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2025-06-18" });
  const call = async (name, args) => (await request("tools/call", { name, arguments: args })).result;
  return { request, call, close: () => child.kill("SIGKILL") };
}

const toolRows = (runDir) => (existsSync(driverDir(runDir, "tool-calls.jsonl"))
  ? readFileSync(driverDir(runDir, "tool-calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

test("given the answer size, serve() hands a long answer over in parts, whole, and runs the tool once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "answer-parts-"));
  const runDir = join(dir, "run"); mkdirSync(driverDir(runDir), { recursive: true });
  const s = await session(writeServer(dir), { CLEAROTRON_TOOL_ANSWER_BYTES: String(SIZE), CLEAROTRON_BAND_RUN_DIR: runDir });
  try {
    const first = (await s.call("long_answer", { q: "qzxv" })).content[0].text;
    const total = Number(first.match(/^\[long_answer answer part 1\/(\d+) — /)?.[1]);
    assert.ok(total >= 3, `a long answer was not served in parts: ${first.slice(0, 120)}`);
    const served = [first];
    for (let p = 2; p <= total; p++) served.push((await s.call("long_answer", { q: "qzxv", [ANSWER_PART_ARG]: p })).content[0].text);
    assert.ok(served.every((t) => bytes(t) <= SIZE), "a part ran over the size");
    assert.equal(served.map(bodyOf).join(""), longAnswer(), "the parts together are the answer, nothing lost or repeated");
    const rows = toolRows(runDir).filter((r) => r.tool === "long_answer");
    assert.equal(rows.filter((r) => r.event === "started").length, 1, "the tool ran more than once");
    assert.equal(rows.filter((r) => r.event === "answer-part").length, total - 1);

    const again = (await s.call("long_answer", { q: "qzxv", [ANSWER_PART_ARG]: 1 })).content[0].text;
    assert.equal(again, first, "part 1 asked for by name is read from the held answer");
    const gone = await s.call("long_answer", { q: "never asked", [ANSWER_PART_ARG]: 2 });
    assert.equal(gone.isError, true);
    assert.match(gone.content[0].text, /no answer for these arguments is held, so part 2 cannot be served/);
    assert.equal(toolRows(runDir).filter((r) => r.tool === "long_answer" && r.event === "started").length, 1, "a part request ran the tool");

    assert.equal((await s.call("short_answer", {})).content[0].text, "four words, no more", "a short answer is served as it was");
    const listed = (await s.request("tools/list", {})).result.tools;
    assert.ok(listed.every((t) => t.inputSchema.properties?.[ANSWER_PART_ARG]?.type === "number"));
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("THE CONTROL: given no answer size, serve() hands every answer over whole and lists the schemas as declared", async () => {
  const dir = mkdtempSync(join(tmpdir(), "answer-parts-"));
  const s = await session(writeServer(dir), {});
  try {
    const whole = await s.call("long_answer", { q: "qzxv" });
    assert.equal(whole.content[0].text, longAnswer(), "served whole, byte for byte");
    assert.ok(bytes(whole.content[0].text) > SIZE * 2);
    const listed = (await s.request("tools/list", {})).result.tools;
    assert.deepEqual(listed.find((t) => t.name === "long_answer").inputSchema,
      { type: "object", properties: { q: { type: "string" } }, required: ["q"] });
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
