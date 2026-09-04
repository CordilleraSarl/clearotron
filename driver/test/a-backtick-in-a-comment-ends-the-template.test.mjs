// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-backtick-in-a-comment-ends-the-template.test.mjs — the renderers parse, and the reason they might not.
//
// THE TRAP. The renderers build their documents inside template literals, and the comments explaining
// what they are doing live INSIDE those literals. A backtick in one of those comments — the obvious way
// to quote a class name or a selector — ends the literal, and the rest of the file becomes garbage
// module code.
//
// It fails at IMPORT time, which is the worst place for it: every consumer of the module breaks at
// once, and the error names a token nobody wrote. Twice in one day, in one file:
//
//     SyntaxError: Unexpected identifier 'exportPDF'      ← from `exportPDF` in a script comment
//     SyntaxError: Unexpected identifier 'details'        ← from `details.scope` in an HTML comment
//
// portal-report.test.mjs pins this rule for the bridge's injected script. Nothing pinned it for the
// document renderers, which is where both of those landed.
//
// WHY THIS SPAWNS `node --check` RATHER THAN IMPORTING. A test that imports a broken module cannot
// report on it — the test FILE fails to load, and the runner says so about the test rather than about
// the renderer. Parsing in a subprocess means this arm survives the very failure it exists to name, and
// it names the file and line the way the syntax error does.
//
// It does not make the build safer than it was: a broken renderer already fails loudly everywhere. What
// it adds is the CAUSE. "A backtick in a comment inside a template literal ends it" is a sentence
// somebody can act on; "Unexpected identifier 'details'" is not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every module on the publish/render surface, ENUMERATED. A maintained list rots the first time a file
 *  is added and nobody remembers this arm; the directory is the list. */
const renderers = () => [
  ...readdirSync(join(DRIVER, "publish")).filter((n) => n.endsWith(".mjs")).map((n) => join(DRIVER, "publish", n)),
  join(DRIVER, "portal-report.mjs"),
];

/** null when the file parses; otherwise its WHOLE syntax error, never a truncation of it.
 *
 *  A first cut returned the first three lines, and node puts the file:line, the offending source and the
 *  caret there — the word "SyntaxError" is on line five. So the arm asserting the failure IS a syntax
 *  error read text that had already been cut off, and reported a working check as broken. Truncating a
 *  verdict and then asserting on it is the same mistake in a smaller box. */
const parses = (file) => {
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); return null; }
  catch (e) { return String(e.stderr ?? e.message).trim(); }
};

/** The one line of a syntax error worth putting in a failure message. */
const firstLines = (err) => String(err).split("\n").filter(Boolean).slice(0, 2).join(" · ");

test("every renderer parses — and if one does not, the reason is usually a backtick in a comment", () => {
  const files = renderers();
  assert.ok(files.length >= 5, `the enumeration found ${files.length} modules — the directory shape drifted, not the code`);
  const broken = files.map((f) => [f, parses(f)]).filter(([, err]) => err);
  assert.deepEqual(broken.map(([f, err]) => `${f.replace(DRIVER, "driver")}: ${firstLines(err)}`), [],
    "a renderer does not parse. If the error names a token nobody wrote, look for a ` in a comment "
    + "inside a template literal — it ends the literal and turns the rest of the file into module code.");
});

test("CONTROL: a backtick in a comment inside a template literal is caught", () => {
  // Without this the arm above passes just as loudly on a checker that cannot fail.
  //
  // The plant reproduces the SHAPE rather than editing a real renderer: it is the exact mistake, twice
  // made — a comment inside an HTML template literal quoting a name in backticks — and building it here
  // means the control does not depend on any particular comment surviving in any particular file, which
  // is a dependency that rots. The real files are the arm above; this proves the instrument.
  const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "backtick-"));
  const good = join(dir, "good.mjs");
  const bad = join(dir, "bad.mjs");
  const mod = (comment) => `export const page = (x) => \`
    <div class="sec">
      <!-- ${comment} -->
      <p>\${x}</p>
    </div>\`;
`;

  writeFileSync(good, mod("details.scope is the shared vocabulary"));
  assert.equal(parses(good), null, "control: the same module without a backtick parses");

  writeFileSync(bad, mod("`details.scope` is the shared vocabulary"));
  const err = parses(bad);
  assert.ok(err, "control: a backtick in that comment must fail the check, or this arm can never fire");
  assert.match(err, /SyntaxError/, "…and it fails as a syntax error, which is how it reaches a reader");
});
