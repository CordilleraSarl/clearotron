// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// demo-texts.mjs — what a demo's assistant is told, where a real install's words would send it to a tool the demo withholds.
//
// A demo withholds `start_run` and the what-if tools (shared/scope.mjs, DEMO_WITHHELD_TOOLS), and three texts still sent the
// assistant to `start_run`: `plan_run`'s description, as the operator's assistant and as a signed-in client's assistant read it,
// and `describe_options`' closing note. The guidance pack describes starting searches and what-ifs too. In a demo each text takes
// the owner's replacement (2026-11-06); a real install keeps its words. Each replacement names the exact words it replaces, so a
// text that has changed underneath it is refused by the test rather than passed through unchanged.

/** `[the words a real install says, the words a demo says instead]`, per text. */
export const DEMO_SWAPS = Object.freeze({
  "plan_run:ops": [
    ["Takes the SAME arguments as start_run. Use this BEFORE start_run whenever the requester has not already confirmed the specifics: it reports", "It reports"],
    ["Show the result to the requester; then call start_run with the SAME arguments to actually run it.", "Show the result to the requester. A demo cannot start it."],
  ],
  "plan_run:client": [
    ["Takes the SAME arguments as start_run and reports", "Reports"],
    ["Show the result to them, then call start_run with the SAME arguments.", "Show the result to them. A demo cannot start it."],
  ],
  "describe_options:note": [
    ["Show that to the requester, and only then call start_run with the SAME arguments.", "Show that to the requester. A demo cannot start it."],
  ],
});

/** The line a demo's guidance opens with, in the owner's words (2026-11-06). */
export const DEMO_GUIDANCE_LINE = "This is a demo: it answers from finished reports, and cannot start a search or a what-if.";

/** `text` with the demo's replacements for `key` made; a text the table does not name is returned as it is. PURE. */
export function demoText(key, text) {
  let out = String(text ?? "");
  for (const [from, to] of DEMO_SWAPS[key] ?? []) out = out.split(from).join(to);
  return out;
}

/** The guidance a demo's assistant is given: the demo line, then the pack. None stays none. PURE. */
export const demoGuidance = (pack) => (pack ? `${DEMO_GUIDANCE_LINE}\n\n${pack}` : pack);
