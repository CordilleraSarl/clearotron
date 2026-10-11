// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// answer-parts.mjs — a tool answer longer than the engine carries whole, served in parts.
//
// Codex shows a model at most 10,000 tokens of the text a tool call puts in front of it, counting 4 bytes a
// token, and puts "…N tokens truncated…" where the middle was. That text is the tool's answer itself, or,
// for the GPT models that call tools only from code (all of 5.6 and 6.x), what that code prints, and code
// that prints an answer as a quoted string adds a byte for each quote and line break. Measured in testing,
// 2026-10-11, on codex 0.162.0 with gpt-6.1-sol and on codex 0.156.1 with gpt-5.6-sol: a model that
// printed a 42,560-byte answer to read it saw its start and end only. Register searches, research answers,
// fetched pages and case-law results all run past that size on real matters. So when a server is given an
// answer size (CLEAROTRON_TOOL_ANSWER_BYTES, set for codex in engine/mcp/codex-config.mjs), an answer
// longer than that, counted as a quoted string, is split into parts, each with a banner naming the next
// call. The tool runs ONCE: the whole answer is held in the server's process and a later part is read from
// it, so nothing is searched, fetched or written again. With no size given, nothing here runs and every
// answer is served as it always was.
//
// Two places use it, because every tool answer the engine reads passes through one of them: serve() in
// driver/engine/mcp/stdio-server.mjs, for every local server, and the OAuth bridge, for the case-law servers.

/** The argument a later part is asked for by. No tool uses this name for anything else. */
export const ANSWER_PART_ARG = "answer_part";

/** Room left in each part for its banner; a tool's name is counted on top. */
const BANNER_RESERVE = 400;

/** The answer size this server was given, in bytes, or 0 when none was. Never under 8 KB. */
export function answerBudget(env = process.env) {
  const n = Number(env.CLEAROTRON_TOOL_ANSWER_BYTES);
  return n > 0 ? Math.max(8192, Math.floor(n)) : 0;
}

/** What a character costs once the text is a quoted string: its UTF-8 bytes, or its escape. PURE. */
function quotedCost(code) {
  if (code === 0x22 || code === 0x5c || code === 0x0a || code === 0x0d || code === 0x09 || code === 0x08 || code === 0x0c) return 2;
  if (code < 0x20) return 6;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

/** The size of text as a quoted string, in bytes, quotes not counted: never less than its own bytes. PURE. */
export function quotedBytes(text) {
  let n = 0;
  for (const ch of String(text)) n += quotedCost(ch.codePointAt(0));
  return n;
}

/**
 * Split text into consecutive pieces of at most `budget` bytes, counted as a quoted string. PURE. A piece
 * ends after its last line break when it holds one, so a line is cut only when it is longer than a piece;
 * every cut falls between characters. Joining the pieces with nothing between them gives the text back.
 */
export function splitAnswer(text, budget) {
  const chars = Array.from(String(text));
  const pieces = [];
  let start = 0;
  while (start < chars.length) {
    let cost = 0, end = start, lastBreak = -1;
    while (end < chars.length) {
      const c = quotedCost(chars[end].codePointAt(0));
      if (cost + c > budget && end > start) break;
      cost += c;
      if (chars[end] === "\n") lastBreak = end;
      end++;
    }
    if (end < chars.length && lastBreak >= start) end = lastBreak + 1;
    pieces.push(chars.slice(start, end).join(""));
    start = end;
  }
  return pieces.length ? pieces : [""];
}

/** The pieces of an answer too long for one response; one piece when it fits. PURE. */
export function answerPieces(text, budget, tool) {
  if (!budget || quotedBytes(text) <= budget) return [String(text)];
  return splitAnswer(text, Math.max(1024, budget - BANNER_RESERVE - 2 * quotedBytes(String(tool))));
}

/** Part `part` of `pieces`, between the banners that say what it is and how to read the next one. PURE. */
export function servedPart(tool, pieces, part) {
  const total = pieces.length;
  const p = Math.min(Math.max(1, Math.floor(Number(part)) || 1), total);
  const head = `[${tool} answer part ${p}/${total} — this answer exceeds one tool response, so it is served in ${total} parts.`
    + ` It is COMPLETE only once ALL ${total} parts are read — never reason from a partial answer.]`;
  const tail = p < total
    ? `[end of part ${p}/${total} — call ${tool} again with the same arguments plus {"${ANSWER_PART_ARG}": ${p + 1}} for the next part]`
    : `[end of part ${total}/${total} — the answer is complete once parts 1..${total} are all read]`;
  return `${head}\n${pieces[p - 1]}\n${tail}`;
}

/** What a part request is told when this process no longer holds that answer. PURE. */
export function partNotHeld(tool, part) {
  return `${tool}: no answer for these arguments is held, so part ${part} cannot be served — `
    + `call ${tool} again without "${ANSWER_PART_ARG}" for the whole answer.`;
}

/** The arguments of a call without the part it asks for, and that part (null when it asks for none). PURE. */
export function takePart(args) {
  if (!args || typeof args !== "object" || !(ANSWER_PART_ARG in args)) return { args: args || {}, part: null };
  const { [ANSWER_PART_ARG]: asked, ...rest } = args;
  const part = Math.floor(Number(asked));
  return { args: rest, part: part >= 1 ? part : null };
}

const canonical = (v) => (Array.isArray(v) ? v.map(canonical)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);

/** The answers this process holds, by tool and arguments; the oldest goes once `limit` are held. */
export function heldAnswers(limit = 16) {
  const held = new Map();
  const key = (tool, args) => `${tool}\u0000${JSON.stringify(canonical(args ?? {}))}`;
  return {
    hold(tool, args, pieces) {
      const k = key(tool, args);
      held.delete(k);
      held.set(k, pieces);
      while (held.size > limit) held.delete(held.keys().next().value);
    },
    get: (tool, args) => held.get(key(tool, args)) ?? null,
  };
}

/** A tool's input schema with the part argument added, for a server that was given an answer size. PURE. */
export function withAnswerPart(schema) {
  const s = schema && typeof schema === "object" ? schema : { type: "object" };
  return { ...s, properties: { ...(s.properties || {}), [ANSWER_PART_ARG]: { type: "number" } } };
}
