// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// #1479 — the early-return half of #1010's vacuous-pass member.
//
// THE SHAPE. `if (corpus == null) return;` at the top level of a test arm. node:test counts a bare
// return as a PASS, so the arm reports its subject clean having measured none of it. The eleven
// conversions on #1479 fixed the instances; this stops the next one arriving.
//
// WHY THIS IS A DECLARATION TABLE AND NOT A BAN. The loop half has one correct remedy — assert the set
// non-empty. This half does not: the question is the CONDITION, not the shape. A bail can be right —
// when the skip is registered elsewhere, or the case is genuinely covered by another arm that really
// exists. So the detector reports the population and every survivor is declared WITH ITS REASON, at a
// line a reader meets.
//
// THE FIGURE IS 7, NOT 32. #1479 quoted 32 from `grep -E '^\s*if\s*\([^)]*\)\s*return\s*;'`, which
// counts `return` inside callbacks — where it means `continue` and skips nothing — and `return;` inside
// regex and template literals in assertions ABOUT the shape. `topLevelBails` tracks brace depth through
// the line and blanks literals first, so it counts only the spelling that actually bails an arm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { topLevelBails } from "../../shared/vacuous-pass.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SELF = "a-bail-on-an-unmeetable-precondition-is-a-skip.test.mjs";

/**
 * Sites where a top-level bail is CORRECT, each with the reason and — the part that matters — the
 * string in that file which makes the reason true. A declaration whose justification has gone is a
 * permanent hole, so the arm below fails when `contains` stops being present.
 */
export const BAIL_IS_DECLARED = [
  {
    file: "driver-dir-has-one-creator.test.mjs",
    contains: "t.skip(skipReason(GUARD)); return null;",
    why: "THE SKIP IS ALREADY REGISTERED, one frame up. This file's `grep()` helper calls "
       + "`t.skip(skipReason(GUARD))` and returns null when the corpus cannot be built; every "
       + "`if (!hits) return;` below it is the caller's control flow AFTER that skip, not a silent "
       + "bail. Converting them would call skip twice. The `contains` above is the helper line that "
       + "makes this true — if the helper stops skipping, this declaration fails with it and these "
       + "seven sites become real bails again.",
  },
  {
    file: "a-signal-immune-fixture-is-reaped-by-its-owner.test.mjs",
    contains: 'REAP_1847_FORCE_PREMISE_RED: "1"',
    why: "A RECURSION GUARD, NOT A MISSING MEASUREMENT. That file's wiring arm proves nothing can be "
       + "stranded when an arm reds, and the only way to see the `after`/`exit` wiring from inside the "
       + "file is to run the file AGAIN as a child with a red forced — so the arm bails when it finds "
       + "itself in that child, or it would spawn a run that spawns a run. It is not saying it could not "
       + "measure; it is the driver declining to be driven. A skip would be worse than the bail: it would "
       + "emit an undeclared skip inside the child run for every future execution. The `contains` above "
       + "is the line where the parent sets that variable on the child — if the arm stops driving a child, "
       + "the recursion it guards against cannot happen and this declaration must go with it.",
  },
];

const declaredFor = (file) => BAIL_IS_DECLARED.find((d) => d.file === file) ?? null;

const testFiles = () =>
  readdirSync(join(REPO, "driver", "test"))
    .filter((f) => f.endsWith(".test.mjs") && f !== SELF)
    .sort();

test("#1479 no test arm bails on an unmeetable precondition without saying so", () => {
  const undeclared = [];
  for (const f of testFiles()) {
    const hits = topLevelBails(readFileSync(join(REPO, "driver", "test", f), "utf8"));
    if (!hits.length || declaredFor(f)) continue;
    for (const h of hits) undeclared.push(`driver/test/${f}:${h.line}  ${h.text.slice(0, 90)}`);
  }
  assert.deepEqual(undeclared, [],
    `${undeclared.length} test arm(s) return early on a precondition they could not meet:\n  `
    + `${undeclared.join("\n  ")}\n\n`
    + "node:test counts a bare `return;` as a PASS, so each of these reports its subject clean having "
    + "measured none of it. Convert to `ctx.skip(skipReason(GUARD))` where the bail means \"I could not "
    + "measure\"; where the bail is right, add it to BAIL_IS_DECLARED with the reason.");
});

test("#1479 the declarations are not a hiding place — each names what makes it true, and it is still there", () => {
  assert.ok(BAIL_IS_DECLARED.length > 0, "an empty table would make the arm above assert nothing about declarations");
  for (const d of BAIL_IS_DECLARED) {
    const src = readFileSync(join(REPO, "driver", "test", d.file), "utf8");
    assert.ok(src.includes(d.contains),
      `${d.file} no longer contains "${d.contains}" — the reason this file's bails are declared has `
      + "outlived itself, so the declaration must go and the sites must be re-judged.");
    assert.ok(d.why.length > 120, "a reason that fits on one line is a silent exemption with a comment");
    // …and the file must still HAVE bails. A declaration for a file that no longer bails is dead weight
    // that would quietly excuse the next one added to it.
    assert.ok(topLevelBails(src).length > 0,
      `${d.file} no longer contains a top-level bail — remove its entry rather than leaving a standing excuse`);
  }
});

test("#1479 THE DETECTOR BITES, and does not bite the three shapes that are not bails", () => {
  // Assembled from parts: written verbatim, the planted bail would be a real one in a file this guard
  // reads. Fixtures live in template literals, which `topLevelBails` blanks — the same reason it does
  // not flag `assert.match(SRC, /if \(!RUN_DIR\) return;/)` in the two files that test for that shape.
  const bail = ["if (a) ", "return", ";"].join("");
  // The skip fixture is assembled for the SAME reason, and `every-skip-is-declared` proved it twice.
  // Spelled out in the template, it was read by that guard as a real skip in this file and demanded a
  // declaration for a string that never runs. Spelled out in THIS COMMENT explaining that, it was read
  // again — the sentence warning about the spelling used the spelling. Two guards, one lesson: a
  // fixture, or a note about a fixture, that writes the thing verbatim will be read as an instance.
  const skipCall = ["ctx.", "skip", '("no corpus")'].join("");

  const real = `test("x", () => {\n  ${bail}\n  assert.ok(1);\n});`;
  assert.equal(topLevelBails(real).length, 1, "a top-level bail must be seen — a detector that sees nothing certifies everything");

  const inCallback = `test("x", () => {\n  arr.forEach((v) => { ${bail} });\n  assert.ok(1);\n});`;
  assert.deepEqual(topLevelBails(inCallback), [],
    "inside a callback `return` is a continue and skips no assertion — this is the over-count #1479 measured");

  const remedy = `test("x", (ctx) => {\n  if (a) return ${skipCall};\n  assert.ok(1);\n});`;
  assert.deepEqual(topLevelBails(remedy), [], "the remedy returns a VALUE and must never be reported as the defect");

  const nested = `test("x", () => {\n  if (a) {\n    if (b) { ${bail} }\n  }\n  assert.ok(1);\n});`;
  assert.deepEqual(topLevelBails(nested), [], "a bail two blocks deep is not the top level of the arm");
});
