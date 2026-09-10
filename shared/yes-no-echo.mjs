// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A YES/NO QUESTION ECHOES ONLY A YES/NO ANSWER.
//
// Setup asks "Enter a Perplexity API key now? [Y/n]", and a person who already holds the key pastes it
// there. The wizard answered "Please answer y or n" and asked again, which is right, but the key had
// already been echoed to the terminal, into its scrollback and into whatever gets pasted into a bug
// report. Reported from a real install, 2026-09-10.
//
// THE ECHO IS DECIDED CHARACTER BY CHARACTER, because that is how it happens. In terminal mode readline
// writes each keypress as it arrives, a paste included, so by the time the line is submitted every
// character has already been shown. Waiting for the answer and then deciding is too late. So the echo is
// allowed only while the line typed so far can still become `y`, `yes`, `n` or `no`, and a key never is.

/** Whether the line typed so far can still become a yes/no answer. The empty line can: it takes the default. */
export const couldBeYesNo = (line) => /^(y|ye|yes|n|no)?$/i.test(String(line ?? ""));

/**
 * Whether an answer is plainly a credential rather than a yes/no: sixteen or more characters with no space
 * in them. No yes/no answer is that long, and every key this product asks for is longer.
 */
export const looksLikeAKey = (answer) => /^\S{16,}$/.test(String(answer ?? "").trim());

/**
 * What a yes/no question lets readline write, given the chunk it is about to write, the line typed so far
 * and the question's prompt. Cursor movement and the newline always pass, so the terminal stays in step.
 * Readline redraws the prompt and the whole line as one write after an edit, so a redraw keeps the prompt
 * and drops the line.
 */
export function yesNoEchoOf(chunk, { line = "", prompt = "" } = {}) {
  const s = String(chunk ?? "");
  if (!s || s.charCodeAt(0) === 0x1b || /^[\r\n]+$/.test(s) || couldBeYesNo(line)) return s;
  return prompt && s.startsWith(prompt) ? prompt : "";
}
