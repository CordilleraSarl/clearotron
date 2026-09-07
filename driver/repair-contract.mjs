// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-contract.mjs — the ONE place that says HOW a corrective turn writes its repair.
//
// PURE: no IO, no config, no engine knowledge. Every corrective/warm/lint prompt in the driver ends with
// one of these tails, so the write-mode decision lives here instead of being re-typed (and re-decided)
// at ~21 call sites.
//
// WHY THIS EXISTS (E2E R2, 2026-07-30 + 2026-07-31). Every corrective prompt in the driver ended with
// "re-emit the COMPLETE updated <file> (full file, not a diff)". The cost of that sentence, measured:
//
//   register-digest settlement flush   att1  1,402s  105,747 out  FAIL   (register-findings.md 103,639 B)
//                                      att2  1,506s  137,519 out  FAIL   (…grew to 154,940 B)
//                                      att3    578s   36,362 out  PASS   (…160,913 B — read offset+limit,
//                                                                          then Write + 7 targeted Edits)
//
// The attempt that PASSED is the one that patched. Across that run ~87% of all emitted output tokens never
// landed in any artifact, and the document-growth tripwire fired four times on corrective re-emissions —
// a file growing while failing is a model retyping, not reasoning. Wall tracks emission at ~62-83 tok/s on
// the opus stages, so retyping a 160 KB document IS the latency.
//
// Nothing had to be built to fix this: every stage held Read/Write/Edit (engine/mcp/gather-config.mjs granted
// the same three to all of them) and acceptEdits auto-approves.
//
// — THAT IS NO LONGER UNIVERSAL, and a tail composed here can now name a tool its reader does not
// hold. A recording stage whose artifact the DRIVER writes is seeded `Read` alone, so `editRepairTail`'s
// "using the Edit tool" and `fullWriteTail`'s "with the Write tool" are wrong for it — gateway.mjs
// intercepts those stages before either tail is reached and orders a re-call of the typed tool instead.
// blind-frame is the first; every conversion adds one. If you are adding a tail here, the question is no
// longer "what should it say" but "which stages can obey it". The models were simply told, in the
// prompt and again in the engine's own system-prompt append, always to write whole files. So the repair is
// wording, and it belongs in one module.
//
// THE RULE, and its exception:
//   * the target EXISTS and one named check failed  → Edit it. It already passed everything not named.
//   * the target is ABSENT (missing_file), or the correction rewrites the whole document by nature
//     (a schema migration; a cold retry with no session context; a kill-torn artifact that cannot be
//     trusted as a base) → Write it in full.
// A full rewrite of a large valid document to fix a few lines is not the safe option: it risks degrading
// prose that already passed its checks, and a prose-structural failure is not quarantine-rescuable.

// The repair tail for a target that EXISTS and failed one named check.
// `target` is what the model should open — an absolute path wherever the caller has one (the Edit tool
// needs it), the stage's own output name otherwise.
// ── — TRUNCATE FOR DISPLAY; NEVER FOR INSTRUCTION, AND NEVER SILENTLY ───────────────────────────
// A model was told to cite a receipt "copied exactly from the ledger", and the failure token rendered that
// receipt's URL through a bare `.slice(0, 80)`. The real URL was 114 characters. The model copied what it
// was shown — exactly 80 characters, byte-identical to the slice — and `lineCitesResult` requires the FULL
// url as a substring, so the citation could never bind. The token then re-rendered the same cut string, and
// the model wrote the same line again: a byte-identical stall no attempt budget can reach the end of.
//
// The defect is not the bound. It is that `.slice()` says nothing about having cut anything, so the value
// LOOKS COMPLETE. Compliance and failure become indistinguishable from both ends — the model cannot tell
// that what it was handed is not what it must reproduce.
//
// THE RULE, and it is the general one and are both instances of: a value rendered into an
// instruction a model must act on is COMPLETE, or it is VISIBLY MARKED as incomplete. This is the marker.
// The ellipsis rides INSIDE the bound, so "80 characters" keeps meaning 80 and every existing budget
// arithmetic downstream stays true.
//
// Pair it with ABBREVIATED_VALUE_NOTE in any message that renders one, so the marker has a stated meaning
// rather than being a character the model has to guess at.
export function abbrev(value, max) {
  const v = String(value ?? "");
  return v.length > max ? `${v.slice(0, Math.max(0, max - 1))}…` : v;
}

/** The sentence that gives the `…` marker its meaning wherever an abbreviated value is shown. */
export const ABBREVIATED_VALUE_NOTE =
  "A value ending in … is ABBREVIATED for the message and is NOT what you must write: copy the full value " +
  "from the ledger, never from this failure text.";

export function editRepairTail(target) {
  const what = target || "the stage output";
  return `Apply the fix by TARGETED EDITS to ${what} using the Edit tool: change ONLY what the correction ` +
    `above names, and leave every other line of the file byte-identical. Do NOT rewrite, re-emit or re-type ` +
    `the whole file — everything not named above already passed, a full rewrite risks degrading it, and an ` +
    `unexplained size jump is flagged. If ${what} does not exist, create it in full with the Write tool. ` +
    `Do not stop until it is corrected and valid.`;
}

// The tail for a correction that ADDS rather than repairs (A-3).
//
// editRepairTail's central sentence — "everything not named above already passed" — is a claim about the
// file, and on an append it is FALSE: the file is incomplete, which is why rows are being added. Handing a
// model that sentence beside "add the missing rows" is telling it the file is fine and not fine at once.
// The growth framing differs too: editRepairTail warns that an unexplained size jump is flagged, but an
// append is SUPPOSED to grow, so the tripwire's meaning has to be stated against the additions rather than
// against the file. Same write mode, different truth about why.
export function appendRepairTail(target) {
  const what = target || "the stage output";
  return `Apply this by TARGETED EDITS to ${what} using the Edit tool: ADD exactly what the correction ` +
    `above names and leave every other line of the file byte-identical. This correction ADDS what is ` +
    `missing — it does not replace what is there — so do NOT rewrite, re-emit or re-type the whole file: ` +
    `a full rewrite risks degrading prose that is already correct, and growth beyond the additions ` +
    `themselves is flagged. If ${what} does not exist, create it in full with the Write tool. Do not stop ` +
    `until the additions are in place and the file is valid.`;
}

// The tail for a target that was NEVER WRITTEN. The work is done and sits in the model's context; what is
// missing is the file itself, so there is nothing to patch.
export function fullWriteTail(target) {
  const what = target || "the stage output";
  return `Write the COMPLETE file now at ${what} with the Write tool — full file, from the work already in ` +
    `your context. Do not stop until it exists and is complete.`;
}

// `invalid_file:<path>:<token>` names the member that actually failed. On a multi-file stage the repair must
// aim at THAT file, never at "the outputs" collectively — the same wrong-file loop the grid_join hints guard
// against. Returns the matching absolute path from `files` when the token's path identifies one (the token
// carries a display path, so match on suffix), else null.
export function failingTarget(lastFail, files = []) {
  const m = /^invalid_file:([^:]*):/.exec(String(lastFail ?? ""));
  if (!m || !m[1]) return null;
  const named = m[1];
  if (!named) return null;
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean).map(String);
  if (list.length <= 1) return list[0] ?? null;
  // longest suffix match wins: "x/register-findings.md" identifies ".../prelim-search/x/register-findings.md"
  const hit = list.find((f) => f === named || f.endsWith(`/${named}`) || named.endsWith(`/${f}`));
  return hit ?? null;
}
