// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MODEL OF THE CURRENT GENERATION IS NAMED IN EVERY SPELLING IT ARRIVES IN.
//
// A tier goes to the program as a word, and the program answers with an id. When the vendor ships a new
// model of that tier the id changes under us, in four spellings at once — its own, a dated one, one for
// each cloud — and every one of them has to read as the same model or a client is told the wrong thing.
// The failures are quiet ones: a report that prints a tier word where a model name belongs, a per-model
// total split in half because two spellings of one model keyed apart, and a family comparison that
// cannot place an id and so refuses an honest turn.
//
// The generation this pins is the one that shipped while none of these readers had seen it. The ids are
// the vendor's published spellings for it, taken from its model page rather than guessed:
//
//   Claude API          claude-opus-5-5
//   Amazon Bedrock      anthropic.claude-opus-5-5
//   Google Cloud        claude-opus-5-5
//   Microsoft Foundry   claude-opus-5-5
//
// Nothing here calls a model. These are the readers, driven over the strings a run brings back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { rollupTokens, servedModels } from "../tokens.mjs";
import { resolveModel, modelFamily } from "../driver.config.mjs";

const mkRun = (stages) => {
  const runDir = mkdtempSync(join(tmpdir(), "clearotron-gen-"));
  mkdirSync(driverDir(runDir));
  for (const [stage, records] of Object.entries(stages))
    writeFileSync(driverDir(runDir, `${stage}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return runDir;
};
const attempt = (extra) => ({ attempt: 1, engine: "anthropic-agent", usage: { input: 10, output: 20 }, ...extra });

test("every spelling of the current top-tier model places in the same family", () => {
  for (const id of ["claude-opus-5-5", "anthropic/claude-opus-5-5", "claude-opus-5-5-20260922",
    "claude-opus-5-5[1m]", "CLAUDE-OPUS-5-5"])
    assert.equal(modelFamily(id), "opus", `${id} did not place as opus`);
  for (const id of ["claude-sonnet-5-5", "claude-haiku-5-5"])
    assert.equal(modelFamily(id), id.includes("sonnet") ? "sonnet" : "haiku", `${id} did not place in its family`);
  // A CLOUD SPELLING STAYS UNPLACED, and that is this reader's contract rather than a gap: `null` means
  // "this build recognises no family", the comparison it feeds reads unknown, and an unknown can never
  // manufacture a mismatch. It reads the same for the generation before this one, so nothing regressed.
  for (const id of ["us.anthropic.claude-opus-5-5-v1:0", "anthropic.claude-opus-5-5", "us.anthropic.claude-opus-5-v1:0"])
    assert.equal(modelFamily(id), null, `${id} now places a family, which changes what the gateway refuses`);
});

test("a dated id and an undated one resolve to one catalog entry, so a total is not split", () => {
  assert.equal(resolveModel("claude-opus-5-5"), "anthropic/claude-opus-5-5");
  assert.equal(resolveModel("claude-opus-5-5-20260922"), "anthropic/claude-opus-5-5");
  assert.equal(resolveModel("anthropic/claude-opus-5-5"), "anthropic/claude-opus-5-5");
});

test("a run served by the current model keys under one name, in whichever spelling each row carries", () => {
  const runDir = mkRun({
    "knockout-frame": [
      attempt({ model: "opus", modelUsed: "claude-opus-5-5", modelActual: "claude-opus-5-5" }),
      attempt({ model: "opus", modelUsed: "claude-opus-5-5", modelActual: "claude-opus-5-5-20260922" }),
    ],
  });
  try {
    const roll = rollupTokens(runDir);
    const keys = Object.keys(roll.byModel);
    assert.deepEqual(keys, ["claude-opus-5-5"], `one model landed under ${keys.length} keys: ${keys.join(", ")}`);
    assert.equal(roll.byModel["claude-opus-5-5"].output, 40);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the client is told the model that served the turn, in every cloud's spelling of it", () => {
  const listed = (rows) => {
    const runDir = mkRun({ "knockout-frame": rows });
    try { return servedModels(runDir); } finally { rmSync(runDir, { recursive: true, force: true }); }
  };
  assert.deepEqual(listed([attempt({ model: "opus", modelActual: "claude-opus-5-5" })]), ["claude-opus-5-5"]);
  assert.deepEqual(listed([attempt({ model: "opus", modelActual: "us.anthropic.claude-opus-5-5-v1:0" })]), ["claude-opus-5-5"],
    "a cloud's spelling of the model was not read as the model");
  assert.deepEqual(listed([attempt({ model: "opus", modelActual: "claude-opus-5-5@20260922" })]), ["claude-opus-5-5-20260922"],
    "the other cloud's spelling was not read as the model");
  // ONE MODEL REACHED TWO WAYS IS LISTED ONCE — the whole reason the spellings are normalised here.
  assert.deepEqual(listed([attempt({ model: "opus", modelActual: "claude-opus-5-5" }),
    attempt({ model: "opus", modelActual: "anthropic.claude-opus-5-5" })]), ["claude-opus-5-5"]);
  // A COMPANY'S OWN DEPLOYMENT NAME IS NOT A MODEL NAME, and must never reach a client: the turn is
  // listed as the tier it asked for. This is what keeps a deployment name off the report.
  assert.deepEqual(listed([attempt({ model: "opus", modelActual: "acme-prod-deployment" })]), ["Opus"]);
});
