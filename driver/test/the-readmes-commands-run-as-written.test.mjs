// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ROOT DOCUMENTS' COMMANDS RUN AS WRITTEN —.
//
// The README opened with `clearotron demo` as the third line of its quickstart. On a fresh clone that is
// `command not found`, exit 127: this repository IS the `clearotron` package, and npm links a package's
// `bin` into `node_modules/.bin` only for its DEPENDENTS, never for itself. Measured on a real clone
// before the fix, and the first thing any reader does with this project.
//
// INSTALL.md already had this right and carries the reasoning. The two documents contradicted each other,
// and the one a newcomer reads first was the wrong one.
//
// ── THE LEGITIMATE BARE FORMS, AND WHY THIS IS NOT A BLANKET RULE ───────────────────────────────────
//
// `clearotron install` writes a shim to ~/.local/bin, so after installing, the short form works and
// INSTALL.md says so. Those sentences are ABOUT the shim and must keep the bare form — rewriting them to
// `npx` would make the document contradict itself.
//
// THE SECOND EXCEPTION ARRIVED WITH THE README REWRITE. The paragraph above was
// written when every reader arrived by cloning, and `npx` was the only form that worked for all of them.
// The README now opens with `npm install -g clearotron`, which puts the binary on `PATH` — measured, by
// packing the tarball, installing it to a clean prefix and running `clearotron demo` from an empty
// directory under a fresh HOME. After that line, the bare form is the correct one and `npx` would be the
// odd instruction. So the rule is not "which file" but "what has the document already told the reader":
// a bare site is correct where its own document has already said to install globally.
//
// Both exceptions are ASSERTED, not assumed — every surviving bare site must be one or the other, and
// the control below still proves INSTALL.md's shim paragraph has not been silently rewritten away.
//
// Note what this arm is and is not. It checks the FORM. It cannot prove a command runs, and the issue is
// explicit that a reviewer who greps has checked the string and not the claim — the claim was checked by
// running each command from a fresh clone, which no unit test can stand in for. This exists so the drift
// does not come back silently between those runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BARE = /(?<!npx )\bclearotron (?=[a-z])/;
const NPX = /npx clearotron [a-z]/g;

/** Root-level markdown only: these are the documents a newcomer meets before anything else. */
const rootDocs = () => readdirSync(ROOT).filter((f) => f.endsWith(".md"));

/**
 * Sites, with each bare one carrying the PARAGRAPH it sits in.
 *
 * Paragraph, not line, and the difference is not cosmetic — it is a bug this file had when first written.
 * INSTALL.md's exception runs to several sentences: the one naming the shim is one line, and the one
 * saying the product's own advice follows suit is another. Judged line by line, the second sentence looks
 * like a stray bare command and the guard reds on correct prose. The unit the exception applies to is the
 * paragraph, so that is the unit tested.
 */
/** The line a document tells the reader to put the binary on `PATH`; Infinity when it never does. */
const GLOBAL_INSTALL = /npm install -g clearotron/;

function sites() {
  const bare = [], npx = [];
  for (const f of rootDocs()) {
    const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
    // Line-based, so a bare command BEFORE the install line is still caught: the reader executing the
    // quickstart top to bottom has not run it yet at that point.
    const installedAt = lines.findIndex((l) => GLOBAL_INSTALL.test(l));
    const globalFrom = installedAt === -1 ? Infinity : installedAt + 1;
    // Paragraph index per line: blank lines separate, so consecutive prose shares one number.
    const para = [];
    let n = 0;
    for (const line of lines) { if (line.trim() === "") n++; para.push(n); }
    const textOf = (k) => lines.filter((_, i) => para[i] === k).join(" ");
    lines.forEach((line, i) => {
      if (BARE.test(line)) bare.push({ file: f, line: i + 1, text: line.trim(), paragraph: textOf(para[i]), afterGlobalInstall: i + 1 > globalFrom });
      npx.push(...(line.match(NPX) ?? []).map(() => ({ file: f, line: i + 1 })));
    });
  }
  return { bare, npx };
}

test("every command form in a root document is the one that works for the reader who followed it", () => {
  const { bare, npx } = sites();

  // ANTI-VACUITY. If the scan matched nothing at all it would pass this file forever while the README
  // rotted. The corrected form must be present in quantity before its absence means anything.
  assert.ok(npx.length >= 20,
    `found only ${npx.length} \`npx clearotron\` site(s) across the root documents — this scan is reading `
    + "almost nothing, so the assertion below would be free");

  // THE EXCEPTION, ASSERTED. A bare site is allowed only where the sentence is about the PATH shim that
  // `clearotron install` writes — the one place the short form is the correct thing to show.
  for (const s of bare) {
    if (s.afterGlobalInstall) continue;   // the document put the binary on `PATH` further up
    assert.match(s.paragraph, /short form|on your `PATH`|stop typing/,
      `${s.file}:${s.line} uses the bare \`clearotron\` form with nothing above it that put the binary on `
      + "`PATH`. For a reader who cloned, that is command-not-found (exit 127, measured) — either write it "
      + "as `npx clearotron`, or give the document an `npm install -g clearotron` line before this point.");
  }
});

test("the shim sentences that keep the bare form are still there — the exception is not a dead letter", () => {
  // A CONTROL for the arm above. If somebody rewrote INSTALL.md's short-form paragraph to `npx`, the loop
  // above would pass over an empty list and this file would quietly stop testing anything. It would also
  // be wrong: the paragraph exists to tell a reader they may stop typing `npx`.
  const { bare } = sites();
  assert.ok(bare.length > 0,
    "no bare `clearotron` remains anywhere in the root documents. That is not the goal: INSTALL.md's "
    + "paragraph about the PATH shim must show the short form, or it contradicts what it is explaining.");
  assert.ok(bare.some((s) => s.file === "INSTALL.md" && /short form|on your `PATH`|stop typing/.test(s.paragraph)),
    "INSTALL.md no longer shows the short form in its PATH-shim paragraph, so the exception this control "
    + "guards has become a dead letter — the paragraph exists to tell a reader they may stop typing `npx`.");
  // The SECOND exception gets the same control, for the same reason: if the README stopped showing the
  // bare form, `afterGlobalInstall` would be skipping nothing and the arm above would quietly narrow.
  assert.ok(bare.some((s) => s.afterGlobalInstall),
    "no bare site follows a global-install line anywhere, so that exception is exercising nothing.");
});
