// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE JUDGES SEE THE INSTRUCTING LAWYER'S OWN QUESTIONS FROM THE ORDER (owner, 2026-10-01).
//
// The register step the judges replaced answered the lawyer's register-side questions from the band. The
// judges were handed the order and the client's materials and not those questions, so the step that judges
// the register no longer read them. The run freezes the order's questions at the frame
// (`_driver/intake-asks.json`); the order in the judges' message now carries them, each as asked, and an
// order that asked nothing composes exactly as before. Every name and question here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, stageInputs } from "../stages.mjs";
import { composeJudgmentMessage } from "../owner-judgment-run.mjs";
import { sandboxManifest } from "../stage-context.mjs";

function run({ asks = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "judge-asks-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const P = paths(dir);
  writeFileSync(P.instructedScope, JSON.stringify({ marks: ["VELTRIN"], classes: [9, 42], goods: "invented software", jurisdictions: ["CH"] }));
  if (asks) writeFileSync(P.intakeAsks, JSON.stringify({ ts: "2026-01-01T00:00:00Z", asks }));
  const message = composeJudgmentMessage({ P, profile: null, ratingScalePath: "scale.md", workedExamplesPath: "examples.md",
    readSkill: (rel) => `(${rel})`, tablePages: null });
  return { dir, P, message };
}

test("the order in the judges' message carries each question the instructing lawyer asked", () => {
  const asks = [{ ask: "Is VELTRAN in class 9 a problem in Switzerland?", owner: "synthesis" },
    { ask: "Check the owner VELTRIN AG for a portfolio.", owner: "common-law" }];
  const { dir, message } = run({ asks });
  try {
    const order = message.slice(message.indexOf("# The order"), message.indexOf("# The client's context"));
    for (const a of asks) assert.ok(order.includes(`- ${a.ask}`), `the order does not carry "${a.ask}"`);
    assert.ok(order.includes("The instructing lawyer's questions:"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an order that asked nothing composes exactly as before, and a replay of the judges holds the questions", () => {
  const without = run();
  const empty = run({ asks: [] });
  try {
    assert.doesNotMatch(without.message, /instructing lawyer/, "a question line appeared on an order that asked none");
    assert.equal(empty.message, without.message.replace(without.dir, empty.dir), "an empty question list changed the message");
    // The questions reach the judges, so the one-stage sandbox that replays them must hold the file; it stays
    // outside the freshness map, which every pass would trip by rewriting the file's timestamp.
    assert.ok(sandboxManifest("owner-judgment", without.P, { axes: [] }).some((e) => e.path === without.P.intakeAsks),
      "a replay of the judges would compose their order without the questions production gives them");
    assert.equal(stageInputs("owner-judgment", without.P, { axes: [] }).includes(without.P.intakeAsks), false,
      "the questions joined the freshness map, and their timestamp would re-judge every resume");
  } finally { rmSync(without.dir, { recursive: true, force: true }); rmSync(empty.dir, { recursive: true, force: true }); }
});
