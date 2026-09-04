// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the mock writes the file the prompt names, whatever its extension.
//
// The write mandate used to filter on `.md`. widened the ABSOLUTE-path arm to `.md|.json` when
// blind-frame's out() became blind-frame-model.json, and left the TARGETED-EDITS and re-emit arms alone.
// So a REPAIR of a JSON-output stage matched nothing and the mock wrote nothing — and the chain that
// produces is a lie about the model: the validator re-judges byte-identical content, fails identically,
// the identical-signature break ends the ladder, and the test reports "the model could not fix it" when
// the mock never asked it to. The harness reading its own silence as a capability finding.
//
// These assert the PROPERTY — the prompt names a path, the mock writes that path — rather than listing
// today's non-markdown stages. A corpus assertion stops meaning anything the moment a stage is renamed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyStageWrites } from "./mock-stage-fixtures.mjs";
import { editRepairTail, appendRepairTail } from "../repair-contract.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "mock-mandate-"));

// — THESE TWO MOVED OFF blind-frame-model.json, and the move is the point rather than an adjustment.
// They asserted that a repair tail naming that file made the mock WRITE it. After the conversion no repair
// tail may name it at all: the seat holds no Write, and gateway's warm-patch branch sends it back through
// `record_blind_frame`. A test that kept demanding the hand-write would be defending the path this PR
// deleted — the same shape as the `/anchor/` assertion found one PR ago. `findings.json` carries the
// property now: it is a.json output with a real fixture, so the property is unchanged, only its
// witness moved. The blind-frame direction is asserted below, in the opposite sense.
test("#293: a repair tail naming a .json output is written — the JSON-output stage is not silently skipped", () => {
  const out = join(dir(), "findings.json");
  applyStageWrites(`The findings are wrong.\n\n${editRepairTail(out)}`, []);
  assert.ok(existsSync(out), "the mock wrote the file the repair tail named");
  const model = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(model && typeof model === "object", "and wrote the stage's real fixture, not a placeholder");
});

test("#293: the append tail carries the same property — both repair shapes name their target the same way", () => {
  const out = join(dir(), "findings.json");
  applyStageWrites(`Rows are missing.\n\n${appendRepairTail(out)}`, []);
  assert.ok(existsSync(out));
});

test("#1092: the mock REFUSES to hand-write blind-frame-model.json, loudly — no fixture, no silent markdown", () => {
  // The conversion's own property, in the direction that matters. If a repair tail ever names this file
  // again, the mock must not quietly satisfy it: the seat cannot write it, so a mock that could would make
  // the suite green on a dispatch no real seat could obey. The fall-through guard's throw IS the assertion.
  const out = join(dir(), "blind-frame-model.json");
  assert.throws(() => applyStageWrites(`The frame is wrong.\n\n${editRepairTail(out)}`, []),
    /no fixture for blind-frame-model\.json/,
    "the mock silently wrote a file only the driver may write");
  assert.ok(!existsSync(out), "…and wrote nothing on the way to refusing");
});

test("#293: a markdown target still works — the fix widened the mandate, it did not move it", () => {
  // The target moved from matter-context.md to case-law-findings.md, and the reason is the point of the
  // test below: matter-context.md is DRIVER-WRITTEN now (conversion 2), so a mock that still hand-wrote it
  // would be asserting the mandate still reaches a path no seat may take. case-law is a gather stage and
  // is not on the conversion list, so this target stays seat-written.
  const out = join(dir(), "case-law-findings.md");
  applyStageWrites(`Write your output to this ABSOLUTE path (create parent dirs if needed): ${out}\n`, []);
  assert.ok(existsSync(out));
  assert.match(readFileSync(out, "utf8"), /# Case-law grounding/);
});

test("a DRIVER-WRITTEN artifact is refused whatever its extension — not only the .json ones", () => {
  // The generalisation conversion 2 forced. The fall-through guard caught `.json` only, so a converted
  // stage whose artifact is MARKDOWN walked straight through it and got the generic body — the mock
  // taking the path the conversion deleted, inside the harness that is supposed to prove it closed.
  // Derived from TOOL_WRITTEN_ARTIFACTS, so conversions 3-6 inherit the refusal with their row.
  const md = join(dir(), "matter-context.md");
  assert.throws(() => applyStageWrites(`Write your output to this ABSOLUTE path: ${md}\n`, []),
    /no fixture for matter-context\.md — the driver writes it, off the `record_matter_frame` call/,
    "the mock hand-wrote an artifact whose only writer is the driver");
  assert.ok(!existsSync(md), "…and wrote nothing on the way to refusing");

  // The markdown twin of an already-converted stage, which was only ever safe because its stage
  // side-writes. Now it is safe BY NAME.
  const prose = join(dir(), "frame-diff.md");
  assert.throws(() => applyStageWrites(`Write your output to this ABSOLUTE path: ${prose}\n`, []),
    /no fixture for frame-diff\.md/);
});

test("#293: the mandate is anchored on the path, not on a known extension", () => {
  // The guarantee that matters: whatever a future stage names its output, the mock writes THAT. An
  // unknown basename has no fixture, so the mock reports it wrote nothing — the honest answer, and a
  // different one from silently matching no path at all.
  const out = join(dir(), "some-future-stage.yaml");
  const summary = applyStageWrites(`Apply the fix by TARGETED EDITS to ${out} using the Edit tool: fix it.`, []);
  assert.match(summary, /some-future-stage\.yaml/,
    "the mock resolved the target and said what it did with it, rather than falling through in silence");
});
