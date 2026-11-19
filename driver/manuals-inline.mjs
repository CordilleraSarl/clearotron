// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE'S MANUALS RIDE ITS OPENING MESSAGE. A stage message starts by telling the model which manuals to
// read ("First, read and follow exactly: …"), and every session then spent turns and tokens opening the same
// files with its own read tool: the same manual, re-read by each card, half and register unit of a run.
// Here the gateway puts each named manual's text into the message itself, in the order named and with the
// company's overrides applied, so the session starts holding them and two sessions of one stage send the
// same leading text. Design's ruling on tracker issue 1385 (batch three, B1 to B3) sets the sentence and the
// order: the manuals first, then the stage's own instructions and the run's material, as the message
// already has them.
//
// ONE PLACE, BOTH ENGINES. It runs in the gateway on the text handed to `engine.runTurn`, so the Claude and
// Codex adapters receive the same bytes by construction. Each adapter still rewrites `skills/…md` references
// to absolute paths afterwards, so a supporting file a manual points at stays readable by path.
//
// WHAT IT DOES NOT TOUCH:
//   - a continuation: a resumed session already holds its opening message, so the gateway does not call this
//     for a warm resume or a warm patch;
//   - a manual that will not resolve or read: it stays named in today's read sentence, so the model meets
//     the missing file exactly as before and the run's existing recovery sees it. No new way to fail;
//   - the dispatch record and the methodology witness: both keep reading the composed message, the record
//     of what the stage asked for. What this inlined is returned beside the text, for the run log.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The sentence that replaces the read instruction, word for word as design set it (tracker issue 1385). */
export const MANUALS_SENTENCE = "Apply the following manuals to this stage, in the order given.";

const READ_SENTENCE = "First, read and follow exactly: ";
const SKILL_REF = /(?<![\w/.])skills\/[A-Za-z0-9._/-]+\.md/g;
// The read sentence as stages compose it: `reads()` writes a comma list, and the two register stages write
// "… SKILL.md (the shared spine) then … unit.md (MODE A — UNIT)." It ends at the first full stop that
// follows a manual's name or its parenthesis.
const READ_SENTENCE_RE = /First, read and follow exactly: (.*?\.md(?: \([^)]*\))?)\.(?=\s|$)/;

/** Where a manual's text is, for the engine's resolver or, without one, the skills folder. null when neither. */
const locate = (ref, { resolve, skillsDir }) => (resolve ? resolve(ref) : skillsDir ? join(dirname(skillsDir), ref) : null);

/**
 * The message with its read sentence replaced by the manuals' text, and what went in. PURE but for reading
 * the manual files. Never throws: a manual that cannot be read is left to the read sentence.
 *
 * @returns {{ text: string, inlined: {ref: string, bytes: number, sha256: string}[], missing: string[] }}
 */
export function inlineManuals(message, { resolve = null, skillsDir = null, read = (p) => readFileSync(p, "utf8") } = {}) {
  const text = String(message ?? "");
  const m = text.match(READ_SENTENCE_RE);
  if (!m || (!resolve && !skillsDir)) return { text, inlined: [], missing: [] };
  const refs = [...new Set(m[1].match(SKILL_REF) ?? [])];
  const inlined = [], missing = [], blocks = [];
  for (const ref of refs) {
    let body = null;
    try { const p = locate(ref, { resolve, skillsDir }); body = p ? read(p) : null; } catch { body = null; }
    if (typeof body !== "string") { missing.push(ref); continue; }
    inlined.push({ ref, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") });
    blocks.push(`=== MANUAL: ${ref} ===\n${body.replace(/\s+$/, "")}\n=== END MANUAL: ${ref} ===`);
  }
  if (!inlined.length) return { text, inlined: [], missing };
  const parts = [MANUALS_SENTENCE, ...blocks];
  if (missing.length) parts.push(`${READ_SENTENCE}${missing.join(", ")}.`);
  // A sentence that continued on the same line (the register stages' exclusion) starts on its own line after the manuals.
  const at = m.index + m[0].length;
  const tail = text.slice(at).replace(/^ (?=\S)/, "\n\n");
  return { text: text.slice(0, m.index) + parts.join("\n\n") + tail, inlined, missing };
}

// The engine adapters rewrite each `skills/…md` reference to an absolute path after this module runs, the block headers
// included, so a header names either form.
const BLOCK_RE = /=== MANUAL: (\S*?skills\/[A-Za-z0-9._/-]+\.md) ===\n[\s\S]*?\n=== END MANUAL: \1 ===/g;

/**
 * The stage's own text from a message this module filled: the manual blocks taken out again, and the read
 * sentence put back naming the same manuals in the same order, each as the message names it (relative, or absolute once
 * an engine adapter has rewritten it). For a reader that must tell a stage's
 * instructions from its manuals, as the mock engines do when they decide which stage they are answering.
 * A message with no manual blocks comes back unchanged. PURE.
 */
export function stageTextOf(message) {
  const text = String(message ?? "");
  const at = text.indexOf(MANUALS_SENTENCE);
  if (at < 0) return text;
  const refs = [];
  let end = at + MANUALS_SENTENCE.length;
  BLOCK_RE.lastIndex = end;
  for (let b; (b = BLOCK_RE.exec(text)) && /^\s*$/.test(text.slice(end, b.index)); ) { refs.push(b[1]); end = b.index + b[0].length; }
  const left = text.slice(end).match(/^\s*First, read and follow exactly: ([^\n]*?\.md)\.(?=\s|$)/);
  if (left) { refs.push(...(left[1].match(/\S*?skills\/[A-Za-z0-9._/-]+\.md/g) ?? [])); end += left[0].length; }
  return `${text.slice(0, at)}${READ_SENTENCE}${refs.join(", ")}.${text.slice(end)}`;
}
