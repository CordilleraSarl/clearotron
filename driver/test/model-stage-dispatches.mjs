// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Every model stage's opening message, composed from invented contexts, and every label the driver
// dispatches a stage under. Shared by the two tests that check what each stage is handed:
// every-model-stage-is-handed-the-instruction-files-it-declares.test.mjs and
// every-model-stage-is-handed-its-tools-on-both-engines.test.mjs. Not a test file itself.
//
// The contexts carry no customer, mark or owner of any real matter. The knockout lane is composed the way
// `koStage` composes it (driver/pipeline-knockout.mjs): the assess stage is also handed the framework deck
// the lane resolves, which its static `skillReads` does not list.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STAGES, paths, resolveSkillReads } from "../stages.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { TRIAGE_FRAMEWORK } from "../pipeline-knockout.mjs";
import { loadFrameworkManifest } from "../framework.mjs";
import { PER_AXIS_STAGES, PER_CHUNK_STAGES } from "../engine/mcp/gather-config.mjs";

export const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SKILLS = join(DRIVER, "skills");

// The house default, and a matter in the pharma class, which forces one more file onto the writer.
// Customer frameworks live in a customer store, not in this tree, so a store-only path is out of reach here.
export const CLEARANCE_CTXS = Object.freeze([
  Object.freeze({ label: "house default", ctx: Object.freeze({ profile: null, job: Object.freeze({}) }) }),
  Object.freeze({ label: "pharma matter", ctx: Object.freeze({ profile: null, job: Object.freeze({ classes: ["5"] }) }) }),
]);

/** One composed opening message per clearance stage and context: { name, label, message, declared }. */
export function clearanceDispatches(runDir) {
  const out = [];
  for (const [name, def] of Object.entries(STAGES)) {
    for (const { label, ctx } of CLEARANCE_CTXS) {
      const message = def.message({ ...ctx, paths: paths(runDir), axis: "primary-sweep", half: "a",
        finding: { ordinal: 1 }, run: { slug: "invented", codename: "invented" } });
      out.push({ name, label, message, declared: resolveSkillReads(name, ctx) });
    }
  }
  return out;
}

/** The knockout lane's three stages, composed from the lane's own context shape. */
export function knockoutDispatches(runDir) {
  const K = koPaths(runDir);
  const framework = loadFrameworkManifest((rel) => join(DRIVER, rel), TRIAGE_FRAMEWORK);
  const ctxs = {
    "knockout-frame": { K, job: {}, profile: {} },
    "knockout-assess": { K, job: {}, chunkNo: 0, chunkMarks: [{ name: "INVENTED NAME" }], chunkTotal: 1,
      framework, frameworkPath: TRIAGE_FRAMEWORK, frameworkMethod: null },
    "knockout-review": { K, evidenceLines: [], firstReadLines: [], exclusionNote: "" },
  };
  const missing = Object.keys(KO_STAGES).filter((n) => !ctxs[n]);
  if (missing.length) throw new Error(`no knockout context for ${missing.join(", ")}: add one so its instructions are checked`);
  return Object.entries(ctxs).map(([name, ctx]) => {
    const declared = [...(KO_STAGES[name].skillReads ?? [])];
    if (name === "knockout-assess") declared.push(TRIAGE_FRAMEWORK);
    return { name, label: "knockout", message: KO_STAGES[name].message(ctx), declared };
  });
}

export const everyModelStageDispatch = (runDir) => [...clearanceDispatches(runDir), ...knockoutDispatches(runDir)];

/**
 * Every label a model stage is dispatched under: the bare stage names of both lanes, and the suffixed forms
 * the driver uses, from the populations that DECLARE them (a per-axis or per-chunk recording row), plus the
 * register search unit's axis and the common-law half, which are named by their own lanes.
 */
export function everyDispatchedLabel() {
  return [...new Set([
    ...Object.keys(STAGES), ...Object.keys(KO_STAGES),
    // The register search unit is fanned out by axis, a card by its finding's ordinal.
    ...PER_AXIS_STAGES.map((s) => `${s}:${s === "register-unit" ? "primary-sweep" : "1"}`),
    ...PER_CHUNK_STAGES.map((s) => `${s}#1`),
    "common-law-half:b",
  ])];
}

/** The base stage a label dispatches. */
export const baseOf = (label) => String(label).split(/[:#]/)[0];
