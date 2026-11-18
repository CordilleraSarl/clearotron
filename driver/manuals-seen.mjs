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
// UNKNOWN IS null, NEVER 0. A stream that was not saved, was cut short, holds a line that is not JSON before its last,
// or holds no event of the engine's own shape, says nothing about what was seen, and an engine this does not read is the
// same. A manual that changed since the stage was told it, or that holds no line long enough to count, is null on its
// own. Recording only, and it never throws: the attempt's result does not depend on it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

/** Each JSON event of a saved stream, or null when a line before the last is not JSON (a killed turn may tear its last). PURE. */
function events(streamText) {
  const lines = String(streamText ?? "").split("\n").filter((l) => l.trim());
  const out = [];
  for (const [i, line] of lines.entries()) {
    try { out.push(JSON.parse(line)); } catch { if (i < lines.length - 1) return null; }
  }
  return out;
}

const READERS = {
  // Codex: every command's output, under the cut. Its events are `thread.*`, `turn.*` and `item.*`.
  "openai-agent": (evs, { cutBytes }) => {
    const ours = evs.filter((e) => /^(thread|turn|item)\./.test(String(e?.type)));
    if (!ours.length) return null;
    return ours.filter((e) => e.type === "item.completed" && e.item?.type === "command_execution")
      .map((e) => codexShown(e.item.aggregated_output, cutBytes));
  },
  // Claude: what each Read call returned, matched to the call by its id.
  "anthropic-agent": (evs) => {
    const ours = evs.filter((e) => ["system", "assistant", "user", "result"].includes(e?.type));
    if (!ours.length) return null;
    const reads = new Set();
    const shown = [];
    for (const e of ours) for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (e.type === "assistant" && c?.type === "tool_use" && c.name === "Read") reads.add(c.id);
      if (e.type === "user" && c?.type === "tool_result" && reads.has(c.tool_use_id))
        shown.push(typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x?.text ?? "").join("\n") : "");
    }
    return shown;
  },
};

/** The countable lines a session showed its model, or null when the stream cannot say. PURE. */
export function shownLines(streamText, engine, { cutBytes = CODEX_SHOWN_OUTPUT_BYTES } = {}) {
  const read = READERS[engine];
  const evs = read ? events(streamText) : null;
  const shown = evs ? read(evs, { cutBytes }) : null;
  if (!shown) return null;
  const set = new Set();
  for (const text of shown) for (const l of text.split("\n")) { const c = countable(l, { numbered: true }); if (c) set.add(c); }
  return set;
}

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
export function measureManualsSeen(turn, told, engine, { read = (p) => readFileSync(p, "utf8"), readManual } = {}) {
  try {
    if (!Array.isArray(told) || !told.length) return null;
    const s = turn?.stream;
    if (!s?.file || s.present !== true || s.reason) return null;
    return manualShares(told, shownLines(read(s.file), engine), readManual ? { readManual } : {});
  } catch { return null; }
}
