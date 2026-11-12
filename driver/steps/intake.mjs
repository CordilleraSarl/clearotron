// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/intake.mjs — the matter frame, its variants and the plan the searches run from.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { parseManifestVariants, variantsParseFailure } from "../common-law-receipts.mjs";
import { note, runLog } from "../log.mjs";
import { decideAxes } from "../stages.mjs";
import { readFileSync } from "node:fs";

export async function runIntake({ P, ctx, job, opts, run }, helpers) {
  const { StageFailure, attachRegisterPlan, deriveFormNeighbourhood, deriveGridSpec, deriveIntakeAsks, deriveScopeLedgerJson, inScopeClassList, must, stage, verifyAndRecordHouseElement } = helpers;
  // Phase 0 done in code (slug/codename/run-dir/customer). Phase 1+2 stages:
  must(await stage("matter-frame", ctx), "matter-frame");
  await deriveIntakeAsks(ctx);   // A6: freeze the intake-ask register (one save-only followup if the section is missing)
  must(await stage("clearance-variants", ctx), "clearance-variants");
  deriveScopeLedgerJson(ctx);   // frame-omission design: code-derive scope-ledger.json from the validated prose (never-kill)
  deriveFormNeighbourhood(ctx); // mechanical FORM band: code-derive form-neighbourhood.json from the manifest's distinctive element(s) — the model-free form floor the register funnel searches (never-kill)
  await verifyAndRecordHouseElement(ctx, opts);   // ask the register who owns the frame's proposed house element, BEFORE the plan is compiled from it
  attachRegisterPlan(ctx);      // WS2 (B3): compile/freeze/reuse the deterministic register plan (flag-gated; frozen plan wins on resume; never-kill on mint)

  // Phase 2b slice 1 — the jx candidate fold (the native-language investigation): native-script
  // register candidates for the
  // frozen policy's jxLanes component, folded run-local onto the transliteration-numeric axis so the
  // unit spawn (axis-from-plan below), coverage skeleton, taint chain and clean gates inherit with
  // zero new wiring. Lazy import (a plain clearotron never loads jx machinery — byte-identical off);
  // never-kill inside runJxCandidateFold (a degraded lane logs + receipts, the Latin plan stands).
  if (ctx.searchPolicy?.components?.jxLanes && ctx.registerPlan) {
    const { runJxCandidateFold } = await import("../jx.mjs");
    const jxr = await runJxCandidateFold(ctx, job, opts,
      { runLog: (d, row) => runLog(d, row), note, inScopeClasses: inScopeClassList(job, ctx.profile).map(String) });
    if (jxr.cause && !jxr.folded) runLog(run.runDir, { event: "jx-candidate-fold-skipped", cause: jxr.cause });
  }

  const manifestForAxes = readFileSync(P.variantManifest, "utf8");
  const axes = decideAxes(manifestForAxes);
  // WS2 (B3) — in plan mode the PLAN is the search authority: any axis it carries entries
  // for must spawn, or its qids would read as unexecuted at fan-in for a unit that never existed.
  if (ctx.registerPlan) for (const a of new Set(ctx.registerPlan.entries.map((e) => e.axis))) {
    if (!axes.includes(a)) { axes.push(a); runLog(run.runDir, { event: "axis-from-plan", axis: a }); }
  }
  // Grid key dictation + batching (2026-06-12, Ember Guard truncation): the common-law message hands
  // the worker the EXACT matrix keys the receipts gate will demand (dictate, don't infer — kills the
  // key-mismatch class) and a batch plan sized under the measured-safe grid (~105 cells/call): the
  // 224-cell single call truncated mid-matrix and correctly hard-failed three times.
  ctx.gridVariants = parseManifestVariants(manifestForAxes);
  // — ZERO VARIANTS IS AN ANSWER OR A FAILURE, AND THE DIFFERENCE DECIDES A DELIVERED CLEARANCE.
  // Zero here silently disarms the split at the guard below (`ctx.gridVariants?.length`), the run takes
  // the legacy spec-less path, and it delivers CLEAN over a dictated meaning sweep that never ran. That
  // is what happened on 2026-08-15: 84 variants written, 0 reachable, clean delivery.
  //
  // The parser cannot tell "this matter has no variants" from "I could not find the table" — but this
  // caller can, because the audit reports what it SAW. Loud, and deterministic: the manifest is on disk
  // and a re-sample re-derives the identical failure, so the ladder has nothing to offer it.
  {
    const why = variantsParseFailure(manifestForAxes);
    if (why) throw new StageFailure("variants", why, undefined, { failClass: "deterministic" });
  }
  ctx.axes = axes;
  // Register-only (2026-07-21): the clearance shape with its unregistered-use half removed. ONE
  // predicate, read from the FROZEN policy, joined by everything below — the grid spec, the gather
  // fan-out, the three grid-assuming recovery passes, the stage prompts and the risk statement's
  // basis. An archived run whose frozen policy predates the component reads as grid-ran, unchanged.
  const runCommonLaw = !ctx.registerOnly;   // derived once at policy freeze, so a resume carries it too
  if (!runCommonLaw) runLog(run.runDir, { event: "register-only", commonLawGrid: false });
  runLog(run.runDir, { event: "axes", axes });
  note(`gather axes: ${axes.join(", ")}${runCommonLaw ? " + common-law" : " (register only — no common-law / marketplace grid)"}`);

  deriveGridSpec(ctx);   // — the grid contract is a NAMED derivation the --experiment rig replays

  // Phase 4 slice 2 — the zh SERP platform grid. item 8 removed the CLEAROTRON_JX_SERP_GRID arm;
  // the condition that remains is the one the run already discloses, the product carrying jxLanes.
  // Never-kill inside runJxSerpGrid; runs pre-gather so its findings exist for the nativeread unit,
  // and the unit itself still refuses on a killed lane, an absent lane decision or no SERP capability
  // — each with a cause that reaches the slice statement.
  if (ctx.searchPolicy?.components?.jxLanes) {
    const { runJxSerpGrid } = await import("../jx-units.mjs");
    const sg = await runJxSerpGrid(ctx, job, opts, { runLog: (d, row) => runLog(d, row), note });
    if (sg.cause && !sg.ran) runLog(run.runDir, { event: "jx-serp-grid-skipped", cause: sg.cause });
  }
  return { axes, runCommonLaw };
}
