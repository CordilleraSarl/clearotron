// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// HOW MUCH OF EACH MANUAL A STAGE WAS TOLD TO READ REACHED THE MODEL.
//
// methodology-witness.mjs records which manuals a stage is told to read, with the path and sha it resolved. It cannot say
// what the model saw of them. On Codex a long read loses its middle: the model is shown the first and last part of a tool
// output (engine/mcp/codex-config.mjs, CODEX_SHOWN_OUTPUT_BYTES). On Claude the model is shown what its Read calls
// returned. So after each attempt this reads the attempt's saved stream for the text the model was shown and records, per
// told manual, the share of the manual's lines that appear in it. Measured on saved streams before this was built
// (production, 2026-11-18): about a quarter of the told bytes of a Codex common-law half or register unit, and half of a
// report overview's, never reached the model under the cut.
//
// THE RULE, said once. A manual line counts when it holds 20 characters or more after its surrounding spaces are trimmed;
// it was seen when the same trimmed line appears in what the model was shown, after a line-number prefix (`cat -n`,
// `nl`, `grep -n`, Claude's Read) is taken off. A line repeated in a manual counts each time. The share is a lower bound
// on Codex, where the cut's size is the product's own measurement, not the vendor's.
//
// UNKNOWN IS null, NEVER 0. A stream that was not saved, was cut short, holds a line carrying a tool output that is not
// JSON before its last, or holds no event of the engine's own shape, says nothing about what was seen, and an engine this does not read is the
// same. A manual that changed since the stage was told it, or that holds no line long enough to count, is null on its
// own. Recording only, and it never throws: the attempt's result does not depend on it.
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { CODEX_SHOWN_OUTPUT_BYTES } from "./engine/mcp/codex-config.mjs";

const MIN_CHARS = 20;
const NUMBERED = /^\s*\d+(?:\t|→|:)/;

/** The countable form of one line: its line-number prefix off, its spaces trimmed; null when too short to count. PURE. */
export function countable(line, { numbered = false } = {}) {
  const raw = String(line ?? "");
  const s = (numbered ? raw.replace(NUMBERED, "") : raw).trim();
  return s.length >= MIN_CHARS ? s : null;
}

/** What a Codex model was shown of one output: all of it under the cut, else its first and last half of the cut. PURE. */
export function codexShown(output, cutBytes = CODEX_SHOWN_OUTPUT_BYTES) {
  const b = Buffer.from(String(output ?? ""), "utf8");
  if (b.length <= cutBytes) return b.toString("utf8");
  const half = Math.floor(cutBytes / 2);
  return `${b.subarray(0, half).toString("utf8")}\n${b.subarray(b.length - half).toString("utf8")}`;
}

// A synthesis stream runs to tens of megabytes, and this runs in the driver after every attempt: so a line is parsed only
// when it can carry what is read (measured 2026-11-18 on a 64 MB stream: 306 MB at peak when every line was parsed).
const READERS = {
  // Codex: every command's output, under the cut. Its events are `thread.*`, `turn.*` and `item.*`.
  "openai-agent": {
    ours: /"type"\s*:\s*"(thread|turn|item)\./,
    carries: (l) => l.includes('"command_execution"'),
    read: (e, add, { cutBytes }) => {
      if (e?.type === "item.completed" && e.item?.type === "command_execution") add(codexShown(e.item.aggregated_output, cutBytes));
    },
  },
  // Claude: what each Read call returned, matched to the call by its id.
  "anthropic-agent": {
    ours: /"type"\s*:\s*"(system|assistant|user|result)"/,
    carries: (l) => l.includes('"tool_use"') || l.includes('"tool_result"'),
    read: (e, add, _opts, reads) => {
      for (const c of Array.isArray(e?.message?.content) ? e.message.content : []) {
        if (e.type === "assistant" && c?.type === "tool_use" && c.name === "Read") reads.add(c.id);
        if (e.type === "user" && c?.type === "tool_result" && reads.has(c.tool_use_id))
          add(typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x?.text ?? "").join("\n") : "");
      }
    },
  },
};

/** Each line of a saved stream as bytes, read a megabyte at a time, so a long stream is never held whole. */
function* fileLines(file) {
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.alloc(1 << 20);
    let rest = Buffer.alloc(0);
    for (let n; (n = readSync(fd, chunk, 0, chunk.length, null)) > 0;) {
      let buf = Buffer.concat([rest, chunk.subarray(0, n)]), at;
      while ((at = buf.indexOf(10)) >= 0) { yield buf.subarray(0, at); buf = buf.subarray(at + 1); }
      rest = Buffer.from(buf);
    }
    if (rest.length) yield rest;
  } finally { closeSync(fd); }
}

const textLines = function* (text) { for (const l of String(text ?? "").split("\n")) yield Buffer.from(l); };

/**
 * The countable lines a session showed its model, from its stream's lines as bytes, or null when the stream cannot say:
 * no event of the engine's own shape, or a line that carries what is read and is not JSON before the last line (a killed
 * turn may tear its last). Only such a line is parsed. PURE but for the lines it is handed.
 */
function shownFrom(lines, engine, { cutBytes = CODEX_SHOWN_OUTPUT_BYTES } = {}) {
  const reader = READERS[engine];
  if (!reader) return null;
  const set = new Set();
  const add = (shown) => { for (const l of shown.split("\n")) { const c = countable(l, { numbered: true }); if (c) set.add(c); } };
  const reads = new Set();
  let ours = false, torn = false;
  for (const line of lines) {
    if (!line.toString("utf8", 0, 64).trim()) continue;
    if (torn) return null;
    if (!ours && reader.ours.test(line.toString("utf8", 0, 200))) ours = true;
    if (!reader.carries(line)) continue;
    let e;
    try { e = JSON.parse(line.toString("utf8")); } catch { torn = true; continue; }
    reader.read(e, add, { cutBytes }, reads);
  }
  return ours ? set : null;
}

/** The countable lines a session showed its model, from its stream's text; see shownFrom. PURE. */
export const shownLines = (streamText, engine, opts) => shownFrom(textLines(streamText), engine, opts);

const sha12 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

/**
 * `{ [ref]: share }` for the told rows (methodology-witness.mjs), each share from 0 to 1 at three places, or null for a
 * manual that changed since it was told or holds nothing countable; null in whole when `shown` is null. PURE but for
 * `readManual`.
 */
export function manualShares(told, shown, { readManual = (p) => readFileSync(p) } = {}) {
  if (!shown || !Array.isArray(told)) return null;
  const out = {};
  for (const row of told) {
    if (!row?.ref) continue;
    let buf = null;
    try { buf = row.path ? readManual(row.path) : null; } catch { buf = null; }
    if (!buf || (row.sha && sha12(buf) !== row.sha)) { out[row.ref] = null; continue; }
    const lines = String(buf).split("\n").map((l) => countable(l)).filter(Boolean);
    out[row.ref] = lines.length ? Math.round((lines.filter((l) => shown.has(l)).length / lines.length) * 1000) / 1000 : null;
  }
  return out;
}

/**
 * The attempt row's `manualsSeen`: the shares for what this turn was told, read from the stream the engine saved, or
 * null when nothing was told or the stream cannot say. Never throws.
 */
export function measureManualsSeen(turn, told, engine, { readManual } = {}) {
  try {
    if (!Array.isArray(told) || !told.length) return null;
    const s = turn?.stream;
    if (!s?.file || s.present !== true || s.reason) return null;
    return manualShares(told, shownFrom(fileLines(s.file), engine), readManual ? { readManual } : {});
  } catch { return null; }
}
