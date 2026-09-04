// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-arm-that-produced-nothing-is-not-ok.test.mjs — the sandbox's own inputs made a false green look true.
//
//. `--experiment <stage>` printed OK and recorded ok:true on an arm where the seat made
// ZERO tool calls, wrote nothing, and produced no output. The output file was present, the right size, and
// parsed — because the SANDBOX had copied the canonical run's document in as a declared input, under the
// name a reader checks. Every surface a reader would consult agreed, and all of them were wrong.
//
// This is the class at its worst: the sandbox supplies the evidence that makes the false green look true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armProduced, readArmSurfaces, producedNothingLine } from "../experiment-honesty.mjs";

const FULL = { wrote: false, toolCalls: 0, typedCalls: 0, outputSha: "aaa", dispatchSha: "aaa" };

test("1966 THE DEFECT: nothing written, no calls, output identical to the sandbox's copy", () => {
  const r = armProduced(FULL);
  assert.equal(r.verdict, "produced-nothing", r.why);
  assert.match(r.why, /wrote nothing/);
  assert.match(producedNothingLine("register-digest", r.why), /PRODUCED NOTHING/);
  assert.match(producedNothingLine("register-digest", r.why), /is NOT a pass/);
  assert.match(producedNothingLine("register-digest", r.why), /copy the sandbox put there as an INPUT/);
});

test("1966 any ONE positive tell settles it — each alone is enough to have produced something", () => {
  for (const [field, value, label] of [
    ["wrote", true, "an expected artifact was written"],
    ["toolCalls", 3, "tool calls"],
    ["typedCalls", 2, "typed calls"],
  ]) {
    const r = armProduced({ ...FULL, [field]: value });
    assert.equal(r.verdict, "produced-something", `${label}: ${r.why}`);
  }
  // And an output that differs from the copy is production, whatever else is silent.
  assert.equal(armProduced({ ...FULL, outputSha: "bbb" }).verdict, "produced-something");
});

test("1966 `wrote` is THREE-valued — null is a stage with nothing to emit, NEVER a condemnation", () => {
  // The trap this arm exists for. `wrote` is true/false when the stage has expected files and NULL when it
  // has none. A falsy test would refuse every stage that emits nothing by design — the over-wide shape
  // that gets a check turned off within a day.
  const r = armProduced({ ...FULL, wrote: null });
  assert.equal(r.verdict, "could-not-tell", "a stage with nothing to emit was condemned as producing nothing");
  assert.match(r.why, /wrote \(absent\)/);
  assert.notEqual(r.verdict, "produced-nothing");
});

test("1966 an unreadable surface is COULD-NOT-TELL, never a refusal", () => {
  // Refusing on what could not be read would be this defect facing the other way.
  for (const patch of [{ toolCalls: null }, { typedCalls: null }, { outputSha: null }, { dispatchSha: null }]) {
    const r = armProduced({ ...FULL, ...patch });
    assert.equal(r.verdict, "could-not-tell", `${JSON.stringify(patch)} produced ${r.verdict}`);
    assert.match(r.why, /not concluding an arm produced nothing from what was not measured/);
  }
  assert.equal(armProduced({}).verdict, "could-not-tell");
});

test("1966 the surfaces are READ from the arm's own dir, and an absent typed-call dir is zero", () => {
  const root = mkdtempSync(join(tmpdir(), "exp-1966-"));
  const dd = join(root, "_driver");
  mkdirSync(dd, { recursive: true });
  const out = join(root, "register-findings.md");
  writeFileSync(out, "the canonical document, copied in as an input\n");
  // The attempt record's LAST row is the one that counts.
  writeFileSync(join(dd, "register-digest.jsonl"),
    JSON.stringify({ attempt: 1, wrote: true }) + "\n" + JSON.stringify({ attempt: 2, ok: true, wrote: false }) + "\n");

  const io = {
    readFile: (f) => { try { return readFileSync(f, "utf8"); } catch { return null; } },
    listDir: (d) => { try { return readdirSync(d); } catch { return null; } },
    sha256: () => "aaa",
    driverPath: (base, ...p) => join(base, "_driver", ...p),
  };
  const s = readArmSurfaces({ shadowDir: root, stage: "register-digest", outputPath: out, io });
  assert.equal(s.wrote, false, "it did not take the LAST attempt row");
  assert.equal(s.typedCalls, 0, "an absent typed-call directory must read as zero calls, not as unknown");
  assert.equal(s.toolCalls, null, "an absent tool-call log is UNKNOWN — the file is written when calls happen");
});
