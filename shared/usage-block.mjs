// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── The synopsis a verb prints for --help, read out of its own header ─────────────────────────────
//
// tracker issues 1861 and 1882. Four verbs printed their LICENCE HEADER as the first line of `--help`:
//
//     $ npx clearotron doctor --help
//     SPDX-License-Identifier: AGPL-3.0-only
//     Copyright 2026 Cordillera Sàrl
//     clearotron install / clearotron doctor — one install from a fresh clone to a first real run.
//
// The split named its own cause exactly: the four that leaked print their help from a DOCUMENT WINDOW
// at the top of the file, and the top of the file is the licence header. The five that were clean have
// help composed for the purpose. The first thing a first-time installer sees, from the verb the install
// document tells them to run first, was `SPDX-License-Identifier`.
//
// ══ AND EVERY ONE OF THOSE WINDOWS WAS HAND-COUNTED ══
//
// `slice(1, 7)`, `slice(1, 8)`, `slice(1, 12)` — three files, three numbers, nothing asserting any of
// them. One was already WRONG: `bin/onboard.mjs` read lines 2..7 while `--probe-engine` sat on line 8,
// so the one credential proof that tool had was invisible to `--help`, and its own comment claimed the
// slice had been "widened by one" when that flag was added. It had not been.
//
// So the window is DERIVED at both ends: it starts after the licence header and ends where the synopsis
// does. A verb that grows a flag cannot truncate its own help, and a verb added tomorrow inherits both
// fixes rather than the defect.
import { invocationPrefix } from "./invocation.mjs";   // — the form a reader can type

const LICENCE_LINE = /^\/\/\s*(SPDX-License-Identifier|Copyright)\b/i;

// ── — THESE LINES ARE PRINTED, WHATEVER THE GUARD BELIEVES ────────────────
//
// Every synopsis this function reads is a SOURCE COMMENT, and the guard in invocation-prefix.test.mjs
// skips comment lines with the stated reason "source comments are not printed to anyone". For any file
// whose help IS its header — which is every caller of this function — that reason is false. Fifteen
// advice lines across `install`, `start` and `demo` hardcoded `npx clearotron …`, reached a reader
// through `--help`, and were exempt from the one guard written to prevent exactly that.
//
// So the prefix is applied HERE, at print time, to the indented command lines only. Not to the prose:
// the title line reads `clearotron install / clearotron doctor — …`, and rewriting a name used as a
// name into a runnable line makes a sentence nobody can parse.
const COMMAND_LINE_VERB = /^(\/\/\s{2,})(?:npx\s+)?clearotron(?=\s)/;

/**
 * The synopsis out of a source file's leading comment block.
 *
 * Skips the licence header, then takes leading `//` lines up to the blank comment line that CLOSES the
 * synopsis — the one after the indented command lines and before whatever section follows. Comment
 * markers are stripped, so the caller prints the result directly.
 */
export function usageBlock(src, prefix = invocationPrefix()) {
  const lines = String(src).split("\n");
  const out = [];
  let sawCommand = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("//")) break;                    // the comment block ended
    if (!out.length && LICENCE_LINE.test(line)) continue; // the licence header is not the synopsis
    const isBlank = line.trim() === "//";
    if (isBlank && sawCommand) break;                     // the synopsis closed
    if (isBlank && !out.length) continue;                 // no leading blank where the header was
    if (/^\/\/\s{2,}\S/.test(line)) {                       // an indented command line
      sawCommand = true;
      // The reader can copy this one, so it carries the form that will work where they are standing.
      out.push(line.replace(COMMAND_LINE_VERB, `$1${prefix}clearotron`));
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/^\/\/ ?/gm, "");
}
