// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The run recorded which manuals a stage was told to read and nothing about what reached the model, though Codex shows a
// model only the start and end of a long tool output. Each attempt row now carries the share of each told manual its
// model was shown, read off the attempt's saved stream: Codex from its command outputs under the cut, Claude from its Read
// results. A stream that cannot say records null, never 0. Every manual and stream here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { countable, codexShown, shownLines, manualShares, measureManualsSeen } from "../manuals-seen.mjs";
import { streamSink } from "../engine/session-record.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "manuals-seen-"));
const MANUAL = [
  "# An invented manual",
  "Rate every finding against the invented framework first.",
  "  - An indented rule that a numbered listing keeps indented.",
  "short line",
  "Name the band of each finding before you write its reason.",
  "Close with the invented summary block, in the order given.",
].join("\n") + "\n";
const PATH = join(ROOT, "invented-manual.md");
writeFileSync(PATH, MANUAL);
const told = (sha = createHash("sha256").update(MANUAL).digest("hex").slice(0, 12)) => [{ ref: "skills/invented/manual.md", path: PATH, sha }];
const numbered = (lines) => lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n");
const LINES = MANUAL.trimEnd().split("\n");
const jsonl = (evs) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";
const codexRead = (output) => ({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "cat -n skills/invented/manual.md", aggregated_output: output, exit_code: 0, status: "completed" } });
const claudeRead = (id, content) => [
  { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: PATH } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } },
];

test("a line counts at 20 characters, trimmed, with a listing's line number taken off", () => {
  assert.equal(countable("short line"), null);
  assert.equal(countable("     3\t  - An indented rule that a numbered listing keeps indented.", { numbered: true }), "- An indented rule that a numbered listing keeps indented.");
  assert.equal(countable("12:Name the band of each finding before you write its reason.", { numbered: true }), "Name the band of each finding before you write its reason.");
  assert.equal(countable("12:Name the band of each finding", { numbered: false }), "12:Name the band of each finding", "an unnumbered manual line keeps its text");
});

test("Codex is shown a long output's first and last half of the cut, and all of a short one", () => {
  assert.equal(codexShown("abcdef", 10), "abcdef");
  assert.equal(codexShown("abcdefghijkl", 10), "abcde\nhijkl");
});

test("a Codex session's share is what its command outputs showed, under the cut", () => {
  const whole = shownLines(jsonl([{ type: "thread.started", thread_id: "t" }, codexRead(numbered(LINES))]), "openai-agent");
  assert.deepEqual(manualShares(told(), whole), { "skills/invented/manual.md": 1 });
  // A long read with the indented rule in its middle: the cut keeps the start and the end, so 4 of the 5 countable lines.
  const head = numbered(LINES.slice(0, 2)) + "\n";
  const tail = "\n" + LINES.slice(3).map((l, i) => `${String(i + 4).padStart(6)}\t${l}`).join("\n");
  const filler = "x".repeat(5000);
  const long = `${head}${filler}\n${String(3).padStart(6)}\t${LINES[2]}\n${filler}${tail}`;
  const cutBytes = 2 * Math.max(Buffer.byteLength(head), Buffer.byteLength(tail)) + 20;
  assert.deepEqual(manualShares(told(), shownLines(jsonl([codexRead(long)]), "openai-agent", { cutBytes })), { "skills/invented/manual.md": 0.8 });
  assert.deepEqual(manualShares(told(), shownLines(jsonl([codexRead(long)]), "openai-agent")), { "skills/invented/manual.md": 1 }, "under the product's cut it is all shown");
});

test("a Claude session's share is what its Read calls returned, and another tool's output is not counted", () => {
  const evs = [{ type: "system", subtype: "init" }, ...claudeRead("r1", numbered(LINES.slice(0, 3))),
    { type: "assistant", message: { content: [{ type: "tool_use", id: "g1", name: "Grep", input: {} }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "g1", content: numbered(LINES) }] } }];
  assert.deepEqual(manualShares(told(), shownLines(jsonl(evs), "anthropic-agent")), { "skills/invented/manual.md": 0.6 });
  const arrayContent = claudeRead("r2", [{ type: "text", text: numbered(LINES) }]);
  assert.deepEqual(manualShares(told(), shownLines(jsonl(arrayContent), "anthropic-agent")), { "skills/invented/manual.md": 1 });
});

test("a session that read nothing is measured at 0; a stream that cannot say is null, never 0", () => {
  assert.deepEqual(manualShares(told(), shownLines(jsonl([{ type: "thread.started" }, { type: "turn.completed" }]), "openai-agent")), { "skills/invented/manual.md": 0 });
  assert.equal(shownLines(`{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"command_execution","aggre\n{"type":"turn.completed"}\n`, "openai-agent"), null, "a broken output mid-stream");
  assert.ok(shownLines(`${JSON.stringify(codexRead(numbered(LINES)))}\n{"type":"item.comp`, "openai-agent"), "a killed turn's torn last line is tolerated");
  assert.equal(shownLines(jsonl(claudeRead("r1", numbered(LINES))), "openai-agent"), null, "another engine's stream");
  assert.equal(shownLines(jsonl([codexRead(numbered(LINES))]), "an-invented-engine"), null, "an engine this does not read");
  assert.equal(shownLines("", "anthropic-agent"), null, "an empty stream");
  assert.equal(manualShares(told(), null), null);
});

test("a manual that changed since it was told, or holds nothing countable, is null on its own", () => {
  const shown = shownLines(jsonl([codexRead(numbered(LINES))]), "openai-agent");
  assert.deepEqual(manualShares(told("000000000000"), shown), { "skills/invented/manual.md": null });
  const tiny = join(ROOT, "tiny.md");
  writeFileSync(tiny, "# Tiny\nshort\n");
  assert.deepEqual(manualShares([{ ref: "skills/invented/tiny.md", path: tiny }], shown), { "skills/invented/tiny.md": null });
  assert.deepEqual(manualShares([{ ref: "skills/invented/gone.md", path: join(ROOT, "gone.md") }], shown), { "skills/invented/gone.md": null });
});

test("a stream kept gzipped, as a closed session's is, measures the same as the plain one", () => {
  // A closed session's stream is written gzipped; this read it as plain lines, found no event, and reported nothing.
  const sink = streamSink(join(ROOT, "gz.attempt1.jsonl"), { freeBytes: 6 * 1024 ** 3 });
  sink.write(jsonl([codexRead(numbered(LINES))]));
  const closed = sink.close();
  assert.match(closed.file, /\.gz$/, "premise: the closed stream was not gzipped");
  assert.deepEqual(measureManualsSeen({ stream: closed }, told(), "openai-agent"), { "skills/invented/manual.md": 1 });
});

test("an attempt whose stream was not saved, or was cut short, measures nothing", () => {
  const file = join(ROOT, "s.jsonl");
  writeFileSync(file, jsonl([codexRead(numbered(LINES))]));
  assert.deepEqual(measureManualsSeen({ stream: { file, present: true, bytes: 1 } }, told(), "openai-agent"), { "skills/invented/manual.md": 1 });
  assert.equal(measureManualsSeen({ stream: null }, told(), "openai-agent"), null);
  assert.equal(measureManualsSeen({ stream: { file, present: false, reason: "not written" } }, told(), "openai-agent"), null);
  assert.equal(measureManualsSeen({ stream: { file, present: true, bytes: 1, reason: "cut short after 1 bytes" } }, told(), "openai-agent"), null);
  assert.equal(measureManualsSeen({ stream: { file, present: true, bytes: 1 } }, [], "openai-agent"), null, "a stage told nothing");
  assert.equal(measureManualsSeen({ stream: { file: join(ROOT, "absent.jsonl"), present: true, bytes: 1 } }, told(), "openai-agent"), null);
});

test("the gateway writes the share on the attempt row, from what that attempt was told", async () => {
  process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
  pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
  const GW = await import("../gateway.mjs");
  const runDir = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "narrative.md");
  GW.registerEngine({ name: "openai-agent", async runTurn({ streamFile }) {
    // What the stage was told is on disk before the turn runs. The manual is longer than the cut, so this stand-in reads
    // it as a model must, a hundred lines at a time.
    const rows = JSON.parse(readFileSync(driverDir(runDir, "methodology-read.json"), "utf8")).stages.synthesis;
    const all = readFileSync(rows[0].path, "utf8").split("\n");
    const reads = [];
    for (let i = 0; i < all.length; i += 100) reads.push(codexRead(all.slice(i, i + 100).map((l, j) => `${String(i + j + 1).padStart(6)}\t${l}`).join("\n")));
    mkdirSync(dirname(streamFile), { recursive: true });
    writeFileSync(streamFile, jsonl([{ type: "thread.started" }, ...reads]));
    writeFileSync(out, "# Narrative\n\nAn invented narrative.\n");
    return { code: 0, killed: false, wall: 5, stdout: "", stderr: "", laneWaitMs: 0, json: { status: "ok", runId: "run" },
      usage: { input_tokens: 1, output_tokens: 1 }, sessionRef: "thr-1", stream: { file: streamFile, present: true, bytes: 1 } };
  } });
  const prev = {};
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0" })) {
    prev[k] = process.env[k]; pinEnv(process.env, k, v);
  }
  try {
    const r = await GW.runStage("synthesis", { agent: "mailagent", message: "First, read and follow exactly: skills/clearance-search/synthesis-rules.md", model: "haiku",
      sessionKey: "clearance-manuals-seen", timeoutSec: 600, runDir, expectFile: [out] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = JSON.parse(readFileSync(driverDir(runDir, "synthesis.jsonl"), "utf8").trim().split("\n").at(-1));
    assert.deepEqual(row.manualsSeen, { "skills/clearance-search/synthesis-rules.md": 1 });
  } finally { for (const [k, v] of Object.entries(prev)) pinEnv(process.env, k, v); }
});
