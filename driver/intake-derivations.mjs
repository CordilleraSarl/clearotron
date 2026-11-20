// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// intake-derivations.mjs — what the driver derives in code from the intake's frame and variants: the intake asks, the
// scope ledger, the mechanical form band and the common-law grid spec.
//
// Moved out of pipeline.mjs unchanged, so that the intake step imports them instead of having them handed in.
import { recordedScopeLedgerRows } from "./clearance-variants-record.mjs";
import { GRID_SEATS, MEANING_SEAT, splitGridSpec } from "./common-law-receipts.mjs";
import { meaningAnglesAssertedNone, meaningAnglesFromMatterContext } from "./connotation-search.mjs";
import { markText, renderFormNeighbourhoodJson } from "./form-neighbourhood.mjs";
import { note, runLog } from "./log.mjs";
import { loadOrdinaryWords } from "./ordinary-words.mjs";
import { gridBatchFor } from "./profiles.mjs";
import { resultsPerCellOf } from "./provider-calls.mjs";
import { registerCapabilities } from "./register-unreachable.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { StageFailure } from "./run-outcome.mjs";
import { atomicWrite } from "./run-record.mjs";
import { droppedVariantFamilies, gridChannels, parseScopeLedgerJson, renderScopeLedgerJson, scopeJurisdictions, scopeLedgerJsonFromRows } from "./scope-ledger.mjs";
import { stage } from "./stage-dispatch.mjs";
import { paths } from "./stages.mjs";
import { famousMarkElements, parseVariantManifestModel } from "./variant-manifest-model.mjs";
import { frameAskedForWebGrid, frameWebChoiceFor, webGridOf } from "./web-grid.mjs";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// The DETERMINISTIC GRID CONTRACT — extracted from pipelineInner unchanged (item).
//
// It was inline, which meant `_driver/grid-spec.json` and the two A1 half-specs existed only if you had
// entered pipeline(). `--experiment common-law-half` therefore could not run at all: its prompt hands
// the plugin `grid_spec_path: _driver/grid-spec.half-<x>.json`, and nothing put that file in the
// sandbox. Now it is a named derivation the rig replays (stage-context.mjs CONTEXT_DERIVATIONS
// "grid-spec"), and pipelineInner calls exactly this.
//
// Reads ctx.gridVariants / ctx.profile / ctx.registerOnly and writes ctx.gridSpecPath + ctx.clHalfTerms,
// exactly as the inline block did. Nothing about WHAT it computes changed: `runCommonLaw` was
// `!ctx.registerOnly` at the call site, `run.runDir` is `ctx.paths.runDir`, and the canonical spec path
// is now the paths() key rather than the same string spelled inline.
export function deriveGridSpec(ctx) {
  const P = ctx.paths;
  // Deterministic grid contract (robust fix, 2026-06-14): write the EXACT terms × platforms the grid
  // will run as a code-owned spec. The perplexity plugin reads this, runs only these cells, and writes
  // common-law-grid.json ITSELF from the API response — the large grid JSON never round-trips through
  // the model's bounded turn-output (no truncation: measured on a dense beverages run) and the model never re-types
  // the keys or cells (no drops/mis-keys: NOVA PULSE/marble-anvil). The receipts gate joins against THIS
  // same file, so it can never demand a key the grid did not run. No profile (no dictated platforms) ⇒
  // legacy model-authored path (back-compat; the gate falls back to the prose manifest).
  ctx.gridSpecPath = null;
  ctx.clHalfTerms = null;   // A1 split — {a:[terms], b:[terms]} when the two-member split is armed below
  // — WHICH PATH, AND WHY. The 2026-08-12 round could not answer this from any artifact: one build
  // ran the unsplit stage and delivered, the next ran three halves and died, and the run records held
  // nothing that named the difference. The flag was a red herring both times — it is ON by default and
  // was ON for both — because the selector is a CONJUNCTION and it was a different term that differed.
  // Every branch below writes its own reason; the initial value is the one that actually decided the
  // 2026-08-11 codex R2 run (no grid spec authored at all), and it is the branch that emits NO event
  // today, which is why absence was the only signal and absence is not a record.
  // The three inputs are recorded, not just their verdict. Working hit exactly this wall: the
  // 2026-08-11 run authored no spec, `clearance-variants` had succeeded, and WHICH of the three conjuncts
  // was false could not be recovered from any artifact — so the round could name the path but not the
  // cause. A record that says "no spec" and not "no spec BECAUSE the profile carried no platforms" just
  // moves the same unanswerable question one step along.
  ctx.clSplitDecision = {
    path: "unsplit", reason: "no-grid-spec",
    detail: ctx.registerOnly
      ? "register-only run — no common-law grid is authored, so there is nothing to split"
      : "no dictated grid spec (legacy spec-less path) — the split partitions a spec, so with no spec it cannot arm",
    terms: null,
    spec_inputs: { registerOnly: Boolean(ctx.registerOnly), gridVariants: ctx.gridVariants?.length ?? 0, profilePlatforms: ctx.profile?.platforms?.length ?? 0 },
  };
  // AN EMPTY MARKETPLACE LIST STILL WRITES A GRID. A company may pick no marketplaces (the owner's ruling of
  // 2026-09-23), and the general-web cell and the meaning sweep ride in this spec: gating it on a non-empty
  // list switched both off with the stores, and the downgrade clamp then read the missing spec as a failed
  // sweep. The spec below is then the web cell plus whatever channels the matter frame names. Only a profile
  // with no list at all (legacy) takes the spec-less path.
  if (!ctx.registerOnly && ctx.gridVariants?.length && Array.isArray(ctx.profile?.platforms)) {
    const gridSpecPath = P.gridSpec;
    // #5 — required channels: a NAMED profile's curated platforms are authoritative. The GENERIC fallback
    // derives the channels from the MATTER FRAME's industry/goods reasoning (its "Search channels:" line) so
    // a regulated/B2B matter (veterinary pharma, say) searches its real channels (EMA/FDA registers) instead of
    // being forced onto — and invalidated by — consumer storefronts. No static class→channel table: the
    // frame names them the way a lawyer reasons about the vertical, so it generalises to ANY industry. The
    // deterministic grid runs grid-spec.platforms and the receipts gate joins the SAME file, so this is the
    // single, consistent lever. Frame named none ⇒ keep the profile default (back-compat, never worse).
    const matterMd = existsSync(P.matterContext) ? readFileSync(P.matterContext, "utf8") : "";
    // THE FRAME'S CHANNELS REACH THE GRID FOR EVERY PROFILE NOW, not only the generic one. A delivered
    // run swept the customer's eight storefronts while the frame named this matter's own ecosystem — a
    // plugin repository among them — and none of it was queried; the lawyer graded a plugin published
    // there. A named profile's list is the client's mandate, so it stands and the frame's channels run
    // BESIDE it; generic still replaces, because its list is a house default and that branch exists to
    // keep a regulated matter off consumer storefronts. gridChannels owns both readings.
    // Read once and reported below: a considered "none named" and an unreadable line are not one silence.
    const chosen = gridChannels({ profilePlatforms: ctx.profile.platforms,
      profileKey: ctx.profile.profileKey, matterMd });
    const channels = chosen.channels;
    const diag = chosen.diag;
    if (chosen.added.length) {
      note(`common-law channels: the matter frame named ${chosen.added.length} channel(s) the profile does not carry, added beside it — ${chosen.added.join(", ")}`);
      runLog(P.runDir, { event: "commonlaw-channels-added", added: chosen.added, from: "matter-frame" });
    } else if (ctx.profile.profileKey === "generic" && diag.channels.length) {
      note(`common-law channels derived from the matter frame (generic profile): ${diag.channels.join(", ")}`);
    } else if (diag.state === "all-rejected") {
      note(`common-law channels: the matter frame's "Search channels:" line named ${diag.offered.length} value(s) and NONE is domain-shaped, so every one was discarded and the profile's stand — ${diag.rejected.slice(0, 6).map((s) => JSON.stringify(s)).join(", ")}. The frame answered; the answer could not be used.`);
      runLog(P.runDir, { event: "commonlaw-channels-unusable", state: diag.state, rejected: diag.rejected.slice(0, 12) });
    } else {
      note(`common-law channels: ${diag.state === "no-document" ? "no matter-context file to read" : "the matter frame carries no \"Search channels:\" line"}, so the profile's ${channels.length} platform(s) stand.`);
      runLog(P.runDir, { event: "commonlaw-channels-unstated", state: diag.state });
    }
    // THE MEANING SWEEP IS THE MATTER FRAME'S LIST (ruled 2026-09-25). A meaning search runs at all because
    // of a live near-miss: a benign-reading name one letter off a major street-gang label, meaning sweep
    // skipped, clean PR claimed. The frame names the meanings and the languages that matter for this matter
    // (its "Meaning angles:" line, required on fresh runs by the matterContext validator); the driver
    // DICTATES them verbatim, exactly like the term×platform cells, and the plugin runs them on the general
    // web and records each into the ledger's extras.pr_risk[] — a tool-written receipt the model cannot
    // fabricate, and verify.mjs rejects a clean PR claim with no recorded queries. Two fixed shapes rode
    // beside the list, about 54 questions whatever the matter; they are gone. The count is ASSERTED in the
    // grid-spec event either way — a 0 is the frame's recorded `none`, never an absence.
    const angleQueries = meaningAnglesFromMatterContext(matterMd);
    // Only the frame's `none` is a decision. A missing line, or one naming nothing usable, would read to
    // the web step as that decision and skip the meaning search on a frame that never made it.
    const anglesAssertedNone = meaningAnglesAssertedNone(matterMd);
    if (!angleQueries.length && !anglesAssertedNone)
      throw new StageFailure("grid-spec",
        "the matter frame's \"Meaning angles:\" line is missing or names no usable question, and the frame did not assert none — so there is no meaning search to dictate, and an empty one would read as the frame's decision",
        undefined, { failClass: "deterministic" });
    // THE WEB GRID THE MATTER FRAME DECIDED (web-grid.mjs): the stores it did not set aside, for the mark
    // itself and the forms a buyer could confuse, and every spelling on the general web. A frame that was
    // never asked for those fields (a resumed older run) keeps every spelling on every channel.
    const choice = frameWebChoiceFor(P.runDir);
    const asked = frameAskedForWebGrid(P.runDir);
    const markNames = Array.isArray(ctx.job?.marks)
      ? ctx.job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean)
      : [ctx.job?.markName ?? ctx.job?.name].filter(Boolean);
    // THE FAMOUS-MARK CHECK: the elements the variants step flagged, each searched on the general web. A
    // manifest that cannot be read here flags none, which is the grid as it was before the flag.
    let famous = [];
    try { famous = famousMarkElements(parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"))); } catch { /* none */ }
    const web = webGridOf({ variants: ctx.gridVariants, channels, marks: markNames,
      forms: choice.forms, setAside: choice.setAside, decided: choice.forms !== null || asked, famous });
    const webCells = web.grids ? web.grids.reduce((n, g) => n + g.terms.length * g.platforms.length, 0) : web.terms.length * web.platforms.length;
    runLog(P.runDir, { event: "frame-web-grid", reading: web.grids ? (choice.forms !== null ? "frame-forms" : "mark-only") : "every-channel",
      forms: choice.forms?.length ?? null, stores: web.platforms.length - 1, stores_set_aside: web.setAside.filter((x) => x.store).length,
      forms_set_aside: web.setAside.filter((x) => x.form).length, unmatched: web.unmatched.length, cells: webCells,
      famous: web.famous?.length ?? 0 });
    if (!web.grids) note(`common-law grid: the matter frame was not asked for its stores and forms, so every spelling runs on every channel (${webCells} cells)`);
    else note(`common-law grid: ${web.platforms.length - 1} store(s) for ${web.grids.length > 1 ? web.grids[0].terms.length : 0} form(s), and ${web.terms.length} spelling(s) on the general web — ${webCells} cells${choice.forms === null ? "; the frame sent no forms, so the mark itself stands in for them" : ""}${web.setAside.length ? `; ${web.setAside.length} set aside by the frame with its reason` : ""}${web.famous?.length ? `; ${web.famous.length} element(s) flagged for the famous-mark check among the general-web searches` : ""}`);
    const gridSpec = {
      terms: web.terms,
      platforms: web.platforms, // the dictated stores + the general-web cell
      // THE BLOCKS: which terms run on which platforms, when the frame decided the grid. `menu` is every
      // channel the frame chose from, and `set_aside` what it left out with its reason, for the record and
      // the audit workbook; neither dictates a cell.
      ...(web.grids ? { grids: web.grids, menu: web.menu, set_aside: web.setAside } : {}),
      // The famous-mark check's cells, for the record: each is a general-web cell the grid above carries.
      ...(web.famous?.length ? { famous: web.famous } : {}),
      output_path: P.commonLawGrid,
      // SIZED BY THE CELLS THIS GRID RUNS, never larger than the profile's own figure (gridBatchFor).
      batch: gridBatchFor(ctx.profile, web.platforms.length),
      // disposition_required (P2-C §8b leg 2): the receipt-presence stamp arming the commonLaw validator's
      // receipts-disposition arm (the D1 ledger_required pattern — every fresh spec carries it; pre-P2-C
      // archived specs lack it, so replay verdicts never flip). splitGridSpec spreads the connotation
      // object, so the stamp rides the halves harmlessly (the half validator skips the connotation gate).
      // — dispositions_path rides the CANONICAL spec too, not only the halves. Until this it was
      // written by splitGridSpec alone, so the three paths that reach an UNSPLIT grid — the split flag
      // off, a single-term grid, a resume of a pre-split run — named the seat no file to fill and the
      // meaning sweep fell back to a prose regime that no longer exists. The path is dictated HERE and in
      // splitGridSpec, from the same P.* factory, and derived nowhere: the grid tool writes the form, the
      // gateway unions it and the validator reads it, all from this one string.
      // `none_named` is the frame's asserted zero carried to the seat that owns the sweep, so an empty list
      // reads as the frame's decision and never as a spec the driver failed to write.
      connotation: { queries: angleQueries, ...(anglesAssertedNone ? { none_named: true } : {}), disposition_required: true,
        dispositions_path: P.commonLawDispositions },
      // D1 fail-closed stamp: the commonLaw validator refuses a missing plugin ledger ONLY for specs
      // carrying this field (receipt presence, never absence) — pre-D1 archived specs lack it, so
      // replay verdicts on old runs never flip while every fresh grid is ledger-or-fail.
      ledger_required: true,
      // HOW MANY RESULTS EACH CELL AND EACH MEANING QUERY ASKS FOR AND KEEPS, by report type, from the
      // run's frozen policy. A run frozen before the rule names none, and its program asks as it did.
      ...resultsPerCellOf(ctx.searchPolicy),
    };
    atomicWrite(gridSpecPath, JSON.stringify(gridSpec, null, 2) + "\n");   // B5 — the canonical grid-spec is never seen torn (the fail-closed join rejects a truncated read)
    ctx.gridSpecPath = gridSpecPath;
    runLog(P.runDir, { event: "grid-spec", terms: gridSpec.terms.length, platforms: gridSpec.platforms.length, connotation: angleQueries.length, connotation_derived: angleQueries.length });

    // ── A1 SPLIT (perf): the per-half spec sidecars for the two concurrent common-law members ────────
    // The canonical _driver/grid-spec.json above stays the FULL spec — the validator/receipts join, the
    // coverage-closure gap recompute and replay all key on it, stamped ledger_required exactly as before.
    // When the split is armed the driver ALSO writes one half-spec per member (grid-spec.half-a/b.json):
    // terms partitioned by the deterministic parity partition (common-law-receipts.splitGridTerms — a
    // term owns ALL its platforms in one half, so the per-variant count/identity joins hold at half
    // level), connotation queries partitioned the same way (each owned by exactly one half; the merge's
    // concat+dedup restores the full receipt set), each half writing its OWN ledger. The halves merge in
    // CODE into the canonical common-law-grid.json at gather fan-in, before anything downstream reads it.
    // Self-disarm case (single-member assembly kept VERBATIM): a single-term grid, which has nothing to
    // partition.
    //
    // item 8 deleted the `flag-off` case with CLEAROTRON_COMMONLAW_SPLIT. A resume of a PRE-SPLIT run (a
    // valid common-law-findings.md with no half files beside it) also kept the single-member assembly, and
    // that case is gone too: a run from an earlier build is no longer resumed, and a current run whose
    // grid has two or more terms splits on its first pass, from frozen inputs a resume derives the same
    // grid from. The single-term grid is why the ASSEMBLY stays: it reaches it without any switch, and
    // records its own reason.
    const splitTerms = gridSpec.terms.length;
    if (splitTerms < 2)
      ctx.clSplitDecision = { path: "unsplit", reason: "single-term-grid",
        detail: `the grid carries ${splitTerms} term(s) — there is nothing to partition into two halves`,
        terms: splitTerms };
    if (splitTerms >= 2) {
      const halves = splitGridSpec(gridSpec, {
        outputPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, P.commonLawGridHalf(h)])),
        // — dictated, so the grid tool names the same file the validator reads.
        dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, P.commonLawDispositionsHalf(h)])),
      });
      for (const h of GRID_SEATS) atomicWrite(P.gridSpecHalf(h), JSON.stringify(halves[h], null, 2) + "\n");
      // THE FRAME NAMED NO MEANING QUESTION, so the meaning seat has nothing to search. Its ledger is the
      // empty one the grid tool would have written, written here, so the merge and every check downstream
      // read a sweep of zero queries rather than a missing file; the seat is told not to run the tool.
      if (halves[MEANING_SEAT]?.connotation?.none_named === true)
        atomicWrite(P.commonLawGridHalf(MEANING_SEAT), JSON.stringify({ cells: [], extras: { pr_risk: [] }, gaps: [] }, null, 2) + "\n");
      ctx.clHalfTerms = { a: halves.a.terms, b: halves.b.terms };

      ctx.clSplitDecision = { path: "split", reason: "armed",
        detail: `${splitTerms} dictated terms, not a pre-split resume — the grid runs as ${GRID_SEATS.length} concurrent half-members`,
        terms: splitTerms,
        halves: Object.fromEntries(GRID_SEATS.map((h) => [h, halves[h]?.terms?.length ?? 0])) };
      //: connotation_<h> = 0 on the non-owning half is the ASSERTED ownership receipt, not a
      // missing sweep. The count that means "no meaning sweep was dictated at all" is the `grid-spec`
      // event's own `connotation:` field above; a reader comparing the two can tell them apart.
      // — connotation_a / connotation_b are now BOTH zero by construction, and that pair is the
      // regression signal this issue asked for: the gate that fired on 13 of 14 first attempts cannot
      // fire on a seat that owes nothing. connotation_m is where the sweep went.
      runLog(P.runDir, { event: "grid-split", terms_a: halves.a.terms.length, terms_b: halves.b.terms.length,
        connotation_a: halves.a.connotation.queries.length, connotation_b: halves.b.connotation.queries.length,
        connotation_m: halves[MEANING_SEAT].connotation.queries.length,
        connotationOwner: MEANING_SEAT });
    }
  }
}

// Frame-omission design — CODE-DERIVE scope-ledger.json from the validated clearance-variants prose
// `### Scope ledger` table (so the JSON is authored by the driver, not the model, and matches the prose
// by construction — exactly the deriveCoverageLedgerJson pattern). NEVER-KILL: a manifest with no/unparseable
// Scope ledger (legacy artifacts, a terse run) logs a note and skips the write; the frame-diff then reads the
// manifest prose directly. The scope ledger is an optimization for the frame-diff, never a delivery gate.
export function deriveScopeLedgerJson(ctx) {
  const P = ctx.paths;
  if (!existsSync(P.variantManifest)) return;
  try {
    // ── CONVERSION 3 — THE PARSE IS DELETED ON THE RECORDED PATH, NOT MOVED ───────────────────────
    //
    // This used to be the only way the ledger existed: re-read the `### Scope ledger` markdown TABLE out
    // of the prose manifest, on fixed column positions, and serialise what came back. The rows arrive
    // TYPED now, so the driver serialises them straight — through the same `scopeLedgerJsonFromRows` the
    // prose path ends in, which is what makes the two byte-identical for the same rows by construction.
    //
    // The prose parse SURVIVES for a manifest this build did not write — archived and replayed runs, and
    // any run whose seat took the dictated path. The anchor rule: a new way in, never a replacement.
    const recordedRows = recordedScopeLedgerRows(P.runDir);
    const json = recordedRows
      ? scopeLedgerJsonFromRows(recordedRows)
      : renderScopeLedgerJson(readFileSync(P.variantManifest, "utf8"));
    const tmp = P.scopeLedger + ".tmp";
    writeFileSync(tmp, json);
    renameSync(tmp, P.scopeLedger);
    // The SOURCE is recorded beside the event: "serialised from the call" and "parsed out of the prose"
    // are different facts about a run, and a reader of an archived ledger must be able to tell which.
    runLog(P.runDir, { event: "scope-ledger-derived", source: recordedRows ? "typed-call" : "prose-parse" });
  } catch (e) {
    note(`clearance-variants: scope-ledger derivation skipped (${String(e.message).slice(0, 100)}) — frame-diff reads the manifest prose`);
    runLog(P.runDir, { event: "scope-ledger-skipped", reason: `derive_failed:${String(e.message).slice(0, 80)}` });
  }
}

// CODE-DERIVE the mechanical FORM band from the manifest's distinctive element(s): the model picks WHICH token
// is distinctive (judgment — "TRIPHEN" out of "VEL TRIPHEN"); the MACHINE generates that token's COMPLETE form
// neighbourhood (edit-1 ∪ phonetic-family ∪ visual-confusable ∪ transliteration). This is the model-free FORM
// floor that fixes the generation lottery (the vendor cannot reach a first-consonant swap — live-verified on the
// incident where a benign-reading given name sat one consonant off a major street-gang label). Written to form-neighbourhood.json; the register funnel searches it (OR-stacked, count-first)
// and the form-axis oracle (mechanicalFormGapDirectives) checks every near-form was dispatched. NEVER-KILL
// (mirrors deriveScopeLedgerJson): no element / unparseable → log + skip; the register degrades to the model's
// manifest variants — never worse than today.
// 2026-07-18 — the floor is seeded from the VALIDATED variant-manifest.json and scoped by the variant-layer
// rows of the scope ledger. Both artifacts already existed; neither was read here. See scope-ledger.mjs
// droppedVariantFamilies and renderFormNeighbourhoodJson for the two defects this closes.
// 2026-08-03 — the SEED SET is the union of every distinctive element the manifest names, and falls
// back to the job's own mark when it names none, so the floor stops moving with the model's choice of anchor
// and can no longer be empty. See the VARIANT FLOOR section of form-neighbourhood.mjs.
export function deriveFormNeighbourhood(ctx) {   // @internal — exported for its call-site test
  const P = ctx.paths;
  // — an ABSENT prose manifest no longer returns without an artifact. It used to, and that was the
  // zero-semantics hole at its widest: no manifest ⇒ no form-neighbourhood.json ⇒ compileRegisterPlan's
  // bandFor(null) ⇒ a plan with ZERO floor entries, and nothing anywhere saying the floor was missing.
  // The floor's fallback seed is the job's own MARK, which is run input and cannot go missing with a
  // model turn, so the derivation now runs regardless and the prose is read when it happens to exist.
  const manifestMd = existsSync(P.variantManifest) ? readFileSync(P.variantManifest, "utf8") : "";
  let markets = [], droppedAxes = [];
  try {
    const rows = parseScopeLedgerJson(readFileSync(P.scopeLedger, "utf8"));
    markets = scopeJurisdictions(rows);
    // the form families judgment ruled out for THIS mark, with reasons, in its own scope ledger
    droppedAxes = droppedVariantFamilies(rows);
  } catch { /* scope ledger optional — markets are informational; no ledger ⇒ nothing dropped (fail-open) */ }
  // NOT scoped here: the transliteration SCRIPT set. `markets` is passed through but never narrows
  // SUPPORTED_SCRIPTS, so latin-diacritic/german/nordic/cyrillic/greek run on every matter regardless of the
  // jurisdictions judgment applied. That is what generated the five Drivers Haven diacritics — but the fold-dedupe
  // in formNeighbourhood removes them at the source, and the surviving cross-script forms (ß→ss, Cyrillic and
  // Greek homoglyphs) are genuinely distinct strings that cost one term each. Deferred deliberately: narrowing
  // scripts by market is a coverage decision, and the harm it was meant to fix is already gone.
  // the validated sibling is authoritative for the dominant element; prose seeding is the fallback
  let model = null;
  try { model = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")); } catch { /* prose fallback */ }
  try {
    // The MARK is the floor's fallback seed and the only input to it that is not model output —
    // resolved exactly as every other job-mark consumer resolves it (stages.mjs blind-frame).
    const mark = ctx.job.marks ?? ctx.job.markName ?? ctx.job.name ?? "";
    // The active register's own declaration: `false` leaves the mixed-alphabet look-alike spellings out of
    // the band and lists them as not searched, with the reason its index gives. Undeclared changes nothing.
    const caps = registerCapabilities(ctx.register);
    const mixedScriptQuery = caps?.mixedScriptQuery ?? null;
    const ow = loadOrdinaryWords("en"), json = renderFormNeighbourhoodJson(manifestMd, { markets, droppedAxes, model, mark, ordinaryWords: ow.words, mixedScriptQuery, nativeScriptIndex: caps?.nativeScriptIndex ?? null });   // an unloadable word list removes nothing
    const tmp = P.formNeighbourhood + ".tmp";
    writeFileSync(tmp, json);
    renameSync(tmp, P.formNeighbourhood);
    let exact = 0, floor = 0, added = 0, seededFrom = "", seeds = [], notSearched = 0, mixedNotSearched = 0;
    try {
      const o = JSON.parse(json);
      exact = o.elements.reduce((a, e) => a + (e.band?.exactQueries?.length ?? 0), 0); notSearched = o.elements.reduce((a, e) => a + (e.band?.ordinaryWordDifferentSound?.length ?? 0), 0);
      mixedNotSearched = o.elements.reduce((a, e) => a + (e.band?.mixedScriptNotSearched?.length ?? 0), 0);
      floor = o.variant_floor?.counts?.floor ?? 0;
      added = o.variant_floor?.counts?.model_added ?? 0;
      seededFrom = String(o.seeded_from ?? "");
      seeds = o.elements.map((e) => `${e.role}:${e.element}`);
    } catch { /* counts are telemetry only */ }
    // The SEED SET is logged by name, because it is the input that decides whether two runs of the same
    // matter can produce the same floor — a floor count alone cannot tell a stable run from a re-anchored one.
    runLog(P.runDir, { event: "form-neighbourhood-derived", exact, floor, modelAdded: added, droppedAxes, seeds, seededFrom, ordinaryWordNotSearched: notSearched, ...(mixedScriptQuery === false ? { mixedScriptNotSearched: mixedNotSearched } : {}), ...(ow.error ? { ordinaryWordListError: ow.error } : {}) });
    // The fallback is not a quiet degrade: it means this run's variant floor rests on the mark alone
    // because the stage named no usable element. Loud, so the absence is a finding and not a shrug.
    if (seededFrom.startsWith("job mark"))
      note(`clearance-variants: variant floor seeded from the JOB MARK — the manifest named no usable distinctive element (${floor} floor terms generated; the floor is complete, its seed is not the model's)`);
  } catch (e) {
    // The reason is carried WHOLE. It used to be truncated to 80 characters into the runLog and
    // 100 into the note, which cut the part that says WHICH cause fired — and the empty floor this path
    // produces is invisible downstream: compileRegisterPlan's bandsFor(null) returns [], so the plan
    // compiles and freezes with no floor entries and no error, looking healthy. This line is the only
    // record that the mechanical floor is missing from the run, so it says the whole of why.
    const why = String(e.message);
    note(`clearance-variants: form-neighbourhood derivation skipped (${why}) — register falls back to the manifest variants, so this run has NO mechanical form floor`);
    runLog(P.runDir, { event: "form-neighbourhood-skipped", reason: `derive_failed:${why}`, mark: markText(ctx.job.marks ?? ctx.job.markName ?? ctx.job.name ?? "") });
  }
}
// A6 — the intake-ask register. Parse the matter-frame's "### Intake asks" section into
// machine rows, freeze them at _driver/intake-asks.json (temp+rename), and expose ctx.intakeAsks to
// every downstream message builder. Section missing on a fresh run ⇒ ONE save-only followup
// (the grid-ledger-followup posture), then proceed with [] + a logged note — never-kill, replay-safe
// (archived runs simply have no sidecar and all consumers falsy-skip).
export function parseIntakeAsks(matterContextMd) {   // @internal
  const m = String(matterContextMd ?? "").match(/^###\s*Intake asks\s*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im);
  if (!m) return null;                                        // section absent (legacy / model miss)
  const asks = [];
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (!t.startsWith("-")) continue;
    if (/^-\s*none stated\b/i.test(t)) return [];
    const q = t.match(/^-\s*ask:\s*"([^"]+)"\s*(?:\|\s*owner:\s*([a-z-]+))?/i)
      ?? t.match(/^-\s*"?(.+?)"?\s*(?:\|\s*owner:\s*([a-z-]+))?\s*$/i);   // tolerant fallback shape
    if (q && q[1]?.trim()) asks.push({ ask: q[1].trim(), owner: (q[2] ?? "synthesis").toLowerCase() });
  }
  return asks;
}
export async function deriveIntakeAsks(ctx) {
  const { run, paths: P } = ctx;
  const readAsks = () => { try { return parseIntakeAsks(readFileSync(P.matterContext, "utf8")); } catch { return null; } };
  let asks = readAsks();
  if (asks == null) {
    note(`[intake-asks] matter-context has no "### Intake asks" section — one save-only followup`);
    await stage("matter-frame", ctx, {
      force: true, trigger: "intake-asks-followup",
      // ── CONVERSION 2 — THIS WAS AN EDIT ORDER AND IS NOW A CALL ─────────────────────────
      //
      // It used to say: "APPEND that section at the END of the file … ONE Edit that adds the new section
      // after the last line", closed by `editRepairTail`. It called itself "the purest edit case in the
      // driver", and the argument was real at the time — a full re-emission would have re-typed a frame
      // whose every other line `validators.matterContext` string-compared against
      // _driver/instructed-scope.json, so risking the whole file to add a heading was the worse trade.
      //
      // THAT ARGUMENT IS GONE, and it did not survive by being overruled — the conversion dissolved it.
      // The seat no longer types the instructed scope (the driver stamps it), and it no longer types any
      // line shape at all. Re-sending the frame is now re-sending a handful of typed values, so "one small
      // Edit beats a big re-emission" is comparing against a re-emission that no longer exists.
      //
      // WORTH KNOWING FOR THE REMAINING CONVERSIONS: the agreement guard does NOT see this composer.
      // It walks `warmPatchMessage` and `correctiveMessage`, and this is a third, bespoke one — so on this
      // stage the guard reported clean while a live hand-write order stood here. The hand sweep over every
      // site naming `P.matterContext` is what found it. That is the residual gap the guard's own module
      // documents, now measured rather than predicted.
      followup: repairFollowup("matter-frame:intake-asks-followup", {}),
    });
    asks = readAsks();
  }
  if (asks == null) { runLog(run.runDir, { event: "intake-asks-missing" }); asks = []; }
  ctx.intakeAsks = asks;
  try {
    const tmp = paths(run.runDir).intakeAsksJson;
    writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), asks }, null, 2));
    renameSync(tmp, paths(run.runDir).intakeAsks);
  } catch { /* best-effort sidecar; ctx carries the rows for this run */ }
  // item 14a — UNCONDITIONAL, like every other AD-4 counter. This was the last one still written inside
  // an `if`, and it is a bad one to leave: "the requester asked for nothing in particular" and "nobody
  // ever read the request for asks" are different facts about a run, and a missing row made them the
  // same fact. The ask register drives a delivery section and a closure gate, so a reader who cannot
  // tell those apart cannot tell an empty section from a skipped step. `asks` stays capped-free (the
  // list is small by construction) and an empty run writes `count: 0` and `asks: []`.
  runLog(run.runDir, { event: "intake-asks", count: asks.length, asks: asks.map((a) => a.ask) });
}
