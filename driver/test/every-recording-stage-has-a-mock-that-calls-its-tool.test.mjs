// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A CONVERSION HAS A HARNESS HALF, AND NOTHING CHECKED THAT IT EXISTED.
//
// Converting a stage moves its artifact from "the seat writes it" to "the driver renders it from a typed
// call". Three things must land together: the grant, the doctrine, and the MOCK — because the mock plays
// the seat, and a mock that never makes the record call leaves the driver with nothing to render.
//
// Conversion 9 landed the first two and missed the third. The result was not subtle: 176 arms red across
// two CI shards, 220 log lines reading `missing_file: ...senior-eye-review.md`, on a change whose own
// affected-set had passed 168 arms locally.
//
// ── WHY THE LOCAL RUN WAS GREEN, WHICH IS THE PART WORTH ENCODING ───────────────────────────────────
//
// The affected set was chosen by grepping for files that REFERENCE the symbols the change edited. That
// finds the grant tables and the agreement guards. It cannot find `pipeline.mock.test.mjs` or the e2e
// splits, because they name none of those symbols — they merely DISPATCH the stage. For a stage
// conversion the right selector is "what dispatches this stage", never "what imports what I edited", and
// no amount of care about the first selector reaches the second.
//
// This arm removes the need to remember that. It is derived from `RECORDING_KEYS`, so a stage joins the
// population by converting, and the failure names the stage and the tool rather than a missing file three
// layers downstream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RECORDING_KEYS, RECORDING_STAGES, RECORDING_TOOLS } from "../engine/mcp/gather-config.mjs";

const FIXTURES = fileURLToPath(new URL("./mock-stage-fixtures.mjs", import.meta.url));
const src = () => readFileSync(FIXTURES, "utf8");

/** The record tool a stage's grant carries — derived, never a second hand-written stage→tool list. */
function recordToolFor(stage) {
  const row = RECORDING_TOOLS[stage];
  const tokens = Array.isArray(row) ? row : String(row ?? "").split(/\s+/);
  const rec = tokens
    .map((t) => String(t).match(/^mcp__recording-[a-z0-9-]+__([a-z0-9_]+)$/))
    .filter(Boolean)
    .map((m) => m[1])
    .filter((n) => n.startsWith("record_"));
  return rec[0] ?? null;
}

test("#1893 every recording stage has a mock branch that drives its record tool", () => {
  const stages = Object.keys(RECORDING_STAGES);
  // FLOOR. A walk over an empty category reports clean, which is how this arm would go quiet on the day
  // somebody re-keyed the table.
  assert.ok(stages.length >= 8, `only ${stages.length} recording stage(s) — the table is not being read`);
  assert.ok(RECORDING_KEYS.size >= stages.length,
    "fewer recording KEYS than recording stages — the derivation this arm walks is broken");

  const text = src();
  const missing = [];
  for (const stage of stages) {
    const tool = recordToolFor(stage);
    assert.ok(tool, `${stage}: no record_* tool in its pinned grant — this arm cannot check a stage it `
      + "cannot name a tool for, and reporting it clean would be worse than failing here");
    // ✕ KEYED ON `recordMockToolCall`, AND THE FIRST CUT KEYED ON THE WRONG THING.
    //
    // It asserted an `if (/<tool>/.test(msg))` branch, because seven of the nine have one. `blind-frame`
    // does not — it is the FALLTHROUGH case, handled after every explicit branch — so the arm reported it
    // as unwired on a tree where it has worked since conversion 1. A guard that fails on the one member
    // shaped differently from the rest is measuring the shape, not the property.
    //
    // The property is that the MOCK RECORDS THE CALL. `recordMockToolCall(runDir, "<tool>", ...)` is what
    // writes the started/settled pair a real transport would, and it is present for all nine regardless of
    // how the branch is reached. Matching the bare tool name instead would pass on a COMMENT naming it,
    // which every conversion leaves behind whether or not it wired anything.
    const wired = new RegExp(`recordMockToolCall\\(\\s*[A-Za-z_$][\\w$]*\\s*,\\s*["']${tool}["']`);
    if (!wired.test(text)) missing.push(`${stage} -> ${tool}`);
  }
  assert.deepEqual(missing, [],
    "these recording stages have no mock branch naming their record tool. The driver renders their "
    + "artifact from that call, so a mock seat that never makes it leaves the file absent and every test "
    + "that DISPATCHES the stage fails on `missing_file` — 176 arms, three layers from the cause. Add a "
    + "branch to applyStageWrites that drives the production receiver:\n  " + missing.join("\n  "));
});

test("#1893 …and no recording stage still has a hand-written fixture body for its artifact", () => {
  // The other half of the same agreement. A surviving fixture body is the mock taking the path the
  // conversion deleted — it would keep every test green while the tool call never happened, which is the
  // shape that makes a conversion look done when only its grant landed.
  const text = src();
  const offenders = [];
  for (const basename of ["senior-eye-review.md", "skeptic-flags.md", "frame-diff.md", "matter-context.md",
    "blind-frame.json", "doubt-closure.md", "report-overview.md", "variant-manifest.md"]) {
    // `if (name === "<artifact>")` is the fixture-branch form. A mention in a COMMENT is not one, which is
    // why this keys on the predicate rather than on the filename appearing anywhere.
    if (new RegExp(`if\\s*\\(\\s*name\\s*===\\s*["']${basename.replace(".", "\\.")}["']`).test(text)) {
      offenders.push(basename);
    }
  }
  assert.deepEqual(offenders, [],
    "a converted artifact still has a `if (name === ...)` fixture body in mock-stage-fixtures.mjs. The "
    + "mock would write it directly instead of driving the record call, so the conversion's own transport "
    + "would never be exercised by any test: " + offenders.join(", "));
});
