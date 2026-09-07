// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE BOTH-STAGES AGREEMENT GUARD — a converted stage's ORDERS and its GRANT, checked in all three
// directions, over every surface the seat reads rather than the one E12 can reach.
//
// ── WHY THIS IS NOT A SECOND E12 ─────────────────────────────────────────────────────────────────────
//
// E12's `toolOrderContract` attributes a doctrine file to a stage through `STAGES.skillReads`, so its
// population is `driver/skills/**`. Measured on the base of this branch: `doctrineReaders()` returns 18
// files, and neither `driver/stages.mjs` nor `driver/gateway.mjs` is one of them —
// `stagesOf("driver/stages.mjs")` is `[]`, so an ungranted order composed by the dispatch or by the repair
// ladder is invisible to it, in the two places a converted stage's orders actually live.
//
// This file supplies the union E12 cannot build, and asks three questions of it. Direction (c) reads THE
// SAME `TOOL_ORDER_BACKLOG` E12 reads — one excuse list, never two, which is the failure
// `contract-dictation-registry.mjs`'s own header calls "authoring number eight".
//
// ── WHAT IT FOUND, SO THE GREEN BELOW IS KNOWN TO BE A TRANSITION ────────────────────────────────────
//
// Both live members were red before the fixes that ship in the same commit:
//
//   (a) `skeptic` held `search_run_artifacts` — the sanctioned read surface  unlocked as the
//       replacement for its measured Bash reads — and NO served text named it. Grep the base commit: the
//       only hits are comments, the grant table, the server module and tests. The seat was handed a
//       capability it could not know about.
//   (b) `correctiveMessage`'s max-tokens branch ordered "CALL THE WRITE TOOL" for a tool-written artifact,
//       on BOTH stages.  swept the warm repair surface and stopped there; the cold one kept ordering
//       a write from seats whose grant no longer carries `Write`.
//
// Direction (c) is green and NOT vacuous: it reproduces exactly the two `skeptic` rows already named on
// 's backlog, which is what proves the union reaches `phase2-execution.md`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
import { NARRATIVE_FILE, FINDINGS_FILE, synthesisCallPaths } from "../synthesis-record.mjs";

import { STAGES, paths as stagePaths, resolveSkillReads, writeReturn } from "../stages.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { providerUnavailableRegisterTools, RECORDING_STAGES, RECORDING_TOOLS, allowedToolsFor, toolGroupsForStage } from "../engine/mcp/gather-config.mjs";
import { REGISTER_PROVIDER } from "../driver.config.mjs";
import { warmPatchMessage, correctiveMessage, draftCarryEligible, toolWrittenArtifact, TOOL_WRITTEN_ARTIFACTS, TOOL_WRITTEN_DIRS, TOOL_WRITTEN_PATTERNS } from "../gateway.mjs";
import { editRepairTail, fullWriteTail } from "../repair-contract.mjs";
import { knownToolNames, TOOL_ORDER_BACKLOG } from "../contract-dictation-registry.mjs";
import { PROVIDER_CONDITIONAL_MARKERS,
  agreementFindings, reproducedBacklog, bareGrant, WRITE_ORDER_MARKERS, INSTRUCTION, SURFACE,
  ATTEMPT_1, REPAIR,
} from "../recording-agreement.mjs";
// — THE ONE REGISTRY. Before it, `unionFor` walked `warmPatchMessage` and `correctiveMessage` and
// nothing else, and this module's own header called a composer wired anywhere else "the residual gap".
// That gap was then MEASURED, on matter-frame: a live order to hand-write an artifact whose only writer
// is the driver, on a stage whose grant no longer carries `Edit`, while this guard reported the stage
// clean in all three directions. The union derives from the registry now, so a composer joins it on the
// commit that registers it — and driver/test/repair-composer-registry.test.mjs is what makes registering
// it the only way to reach a seat at all.
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";
import { CODE_BUILT_SECTIONS } from "../pipeline.mjs";

const DRIVER = fileURLToPath(new URL("../", import.meta.url));

// A synthetic run dir. Nothing is read from it — `paths()` is pure string composition, and every surface
// below is composed, never loaded off a real run. That is what lets this file run in CI with no fixtures.
const P = stagePaths("/tmp/recording-agreement-probe");
const CTX = Object.freeze({
  // `axis` is a REAL ordinal, not null: a fan-out stage's artifact is `report-cards/<ord>.md` and its
  // dispatch names that path, so a null axis would give direction (b) nothing to match and it would
  // report clean on a stage whose whole risk is 26 files instead of one ( conversion 5).
  paths: P, profile: {}, intakeAsks: [], framework: null, axes: [], axis: "1",
  job: { marks: ["PROBEMARK"], markName: "PROBEMARK", classes: [9], goods: "probe goods", rawRequest: "probe" },
});

// ── THE SECOND LANE ( item B) ──────────────────────────────────────────────────────
//
// Every recording stage lived in `stages.mjs` until knockout-assess. This file resolved a stage's
// dispatch as `STAGES[stage].message(CTX)`, so the first stage from the knockout table did not read as
// a defect — it threw on `undefined.message`, which is the honest outcome and better than the
// alternative: `resolveSkillReads` returns `[]` for a stage it does not know, so a lane-blind union
// would have carried the dispatch and NO doctrine, and reported three clean directions over a stage
// whose skill files it never opened.
//
// THE TWO LANES TAKE DIFFERENT CONTEXT SHAPES, which is why the lane record carries its ctx rather than
// this file passing one CTX everywhere. The knockout dispatch is composed per CHUNK — the fan-out unit
// on this lane is a chunk, not an axis — so its context supplies the chunk coordinates the clearance
// context has no field for.
//
// `chunkTotal: 2` with `chunkNo: 0` ON PURPOSE: chunk 0 of 2 is the FIRST-chunk branch of a run that has
// a continuation, so the composed dispatch carries the batch/framework clause. A single-chunk context
// would compose a message no multi-chunk run ever sees.
const KO_CTX = Object.freeze({
  // ONE CONTEXT, BOTH KNOCKOUT STAGES, and the union of their fields rather than a context per stage.
  // `knockout-frame` composes from `{K, job, profile}` and `knockout-assess` from the chunk coordinates;
  // a lane whose two dispatches took disjoint contexts would need a table keyed by stage, which is a
  // second place to forget. The fields are additive and no stage reads another's.
  job: { marks: ["PROBEMARK"], markName: "PROBEMARK", classes: [9], goods: "probe goods",
    rawRequest: "probe", customer: null, upfrontInstructions: null, deadline: null },
  profile: { industry: "probe industry", defaultClasses: [9] },
  K: koPaths("/RUN"),
  chunkNo: 0,
  chunkMarks: [{ name: "PROBEMARK" }],
  chunkTotal: 2,
  framework: { framework_key: "probe", bands: [{ label: "High" }, { label: "Low" }] },
  // A REAL SHIPPED DECK, and it has to be. The dispatch names the framework path, and this file's pointer
  // scan follows every `skills/**.md` a message names and READS it — deliberately, because a dispatch
  // ordering a seat to read a file that is not there is this module's own subject. An invented path is
  // therefore not a harmless fixture: it is an unreadable pointer, and the guard fails on it exactly as
  // it would on a real one. `risk-framework-triage.md` is the triage deck this lane actually rates in.
  frameworkPath: "skills/prelim-search/risk-framework-triage.md",
  probeNote: null,
});

// The lane a stage's dispatch lives in, with the ctx that lane's `message` takes and the resolver for its
// declared reads. The clearance lane goes through the SHIPPED `resolveSkillReads`; the knockout lane has
// no shipped resolver because nothing in `koStage` reads `skillReads` — that table's own comment says the
// field is declarative there and that nothing checks it against the `reads([...])` in the message. This
// guard is its first consumer, which is the point: the field stops being decorative on the commit that
// makes a union out of it.
const LANES = Object.freeze([
  // `out` IS PER LANE BECAUSE THE FAN-OUT UNIT IS. The clearance driver calls `def.out(P, ctx.axis)`; the
  // knockout driver calls `def.out(K, chunkNo)` — a different paths object and a different ordinal. The
  // existing comment at the clearance call site records what a wrong second argument costs: passing the
  // whole context produced `report-cards/[object Object].md`, matched no artifact, and direction (b)
  // blamed the composer for four conversions. A lane whose `out` were called with the other lane's
  // arguments would reproduce exactly that, so each lane states its own call.
  Object.freeze({ surface: "dispatch:stages.mjs", table: STAGES, ctx: CTX,
    reads: (stage) => resolveSkillReads(stage, CTX) ?? [],
    out: (stage) => STAGES[stage].out?.(P, CTX.axis) ?? P[stage] }),
  Object.freeze({ surface: "dispatch:stages-knockout.mjs", table: KO_STAGES, ctx: KO_CTX,
    reads: (stage) => KO_STAGES[stage]?.skillReads ?? [],
    out: (stage) => KO_STAGES[stage].out?.(KO_CTX.K, KO_CTX.chunkNo) }),
]);

/** The lane declaring this stage's dispatch. An undeclared stage is a finding, never a skip. */
function laneFor(stage) {
  const lane = LANES.find((l) => stage in l.table);
  assert.ok(lane, `${stage}: no stage table declares a dispatch for it. A recording stage whose lane is `
    + "undeclared here reads as a stage with no instructions at all, and every direction would go green "
    + "on the empty union that produces.");
  return lane;
}

/** A stage's declared doctrine reads, through its own lane's resolver. */
function skillReadsFor(stage) {
  return laneFor(stage).reads(stage) ?? [];
}

/**
 * A recording stage's artifact, DERIVED — stage → its granted record tool → the gateway row that names
 * that tool. No second hand-written stage→file list, and a conversion that grants a record tool without
 * adding its `TOOL_WRITTEN_ARTIFACTS` row fails here by name rather than by checking one direction less.
 */
function artifactsFor(stage, held) {
  // BOTH tables, because conversion 5 added a second shape. A per-ordinal artifact has no distinct
  // basename — a card is `26.md` — so it is declared by its DIRECTORY, and its name here is the
  // run-relative shape the dispatch would actually name. Reading only the basename table would have made
  // the first fan-out conversion invisible to direction (b), which is the direction that catches a
  // surviving hand-write order.
  const rows = [
    ...[...TOOL_WRITTEN_ARTIFACTS].filter(([, v]) => held.has(v.tool)).map(([basename]) => basename),
    ...[...TOOL_WRITTEN_DIRS].filter(([, v]) => held.has(v.tool)).map(([dir]) => `${dir}/${CTX.axis}.md`),
    // ALL THREE TABLES, and the third is this conversion's. A per-chunk artifact at the RUN ROOT can be
    // keyed by neither basename nor directory, so it is declared by a pattern — and a pattern the
    // ENUMERATION cannot walk is invisible here while the lookup answers correctly, which would leave
    // direction (b) reporting clean on a stage it never examined. The row carries a derived `sample`
    // precisely so this walk has a concrete member to name.
    ...TOOL_WRITTEN_PATTERNS.filter((v) => held.has(v.tool)).map((v) => v.sample),
  ];
  // ✕ THE FLOOR IS SCOPED TO THE RECORDING CATEGORY, because the population widened past it.
  //
  // Directions (a) and (c) are meaningful for EVERY stage; direction (b) needs an artifact a typed tool
  // owns, and an ordinary gather stage has none. So a stage outside the category returns an empty list
  // rather than failing — but it must never be a silent `continue`: the widened arm below COUNTS the
  // stages that return nothing and asserts the list, so a RECORDING stage that later loses its
  // TOOL_WRITTEN_ARTIFACTS row drops out of direction (b) loudly rather than quietly. That is the one
  // direction with a measured incident behind it, and it is the one an excuse-shaped branch would blind.
  if (stage in RECORDING_STAGES) {
    assert.ok(rows.length >= 1,
      `${stage}: NO TOOL_WRITTEN_ARTIFACTS row names a tool this stage holds. A conversion adds the grant `
      + "and the row together; the row is what makes a repair a CALL rather than a file write, and without "
      + "it direction (b) has no artifact to key on and would report clean.");
  }
  return rows;
}

/**
 * The instruction union for one stage: every text the seat is ORDERED by, enumerated BY WHEN IT IS READ.
 *
 * attempt-1 prose · the doctrine it is told to read and follow exactly · the warm repair rung · the cold
 * corrective. The last two are COMPOSED BY CALLING their real composers over the stage's real failure
 * tokens, never by listing their branches — which is why a branch added inside either one is in the union
 * on the commit that adds it.
 *
 * THE FAILURE TOKENS ARE THE STAGE'S OWN. `contractElements` declares what each element can fail on, and
 * `draftCarryEligible` is the shipped predicate for "this token reaches the warm lane at all". Inventing a
 * token instead produced two phantom findings on the first cut of this file: a made-up `invalid_file:x:y`
 * falls through branches the real tokens never reach, and the guard reported a defect in text no seat can
 * be handed.
 */
function unionFor(stage, artifacts) {
  const lane = laneFor(stage);
  const union = [{ surface: lane.surface, kind: INSTRUCTION, phase: ATTEMPT_1, text: lane.table[stage].message(lane.ctx) }];

  for (const rel of skillReadsFor(stage)) {
    union.push({ surface: `skill:driver/${rel}`, kind: INSTRUCTION, phase: ATTEMPT_1, text: readFileSync(join(DRIVER, rel), "utf8") });
  }

  // ── DOCTRINE THE DISPATCH NAMES AT RUNTIME, WHICH `skillReads` CANNOT HOLD ──────────────────────────
  //
  // register-unit's dispatch orders, in prose: "Read and follow skills/prelim-register/providers/<name>.md
  // for THIS provider's exact tool names + operator vocabulary." That file is chosen by CLEAROTRON_DATABASE
  // at dispatch time, so it can never be a `skillReads` literal — and a union built from the literals alone
  // has not read a document the seat is explicitly ordered to read and follow.
  //
  // Measured before this existed: over all 16 stages the widened check reported `register_image_fetch` and
  // `register_record_fetch` as granted-but-never-ordered on register-unit, while the deck the dispatch
  // names holds both. Two findings, both false, both cleared by following the pointer.
  //
  // ✕ A POINTER NAMING NO FILE IS A FINDING, NOT A SKIP. A dispatch that orders a seat to read a file
  // which is not there is exactly this module's subject, so the read is allowed to throw. The probe this
  // was prototyped in swallowed it in a try/catch and that was wrong — it would have hidden the one defect
  // the pointer-following is most likely to surface.
  const alreadyRead = new Set(skillReadsFor(stage));
  for (const m of lane.table[stage].message(lane.ctx).matchAll(/skills\/[A-Za-z0-9._\/-]+\.md/g)) {
    const rel = m[0];
    if (alreadyRead.has(rel)) continue;
    alreadyRead.add(rel);
    union.push({ surface: `pointer:driver/${rel}`, kind: INSTRUCTION, phase: ATTEMPT_1,
      text: readFileSync(join(DRIVER, rel), "utf8") });
  }

  // `out(P, axis)` — THE AXIS, not the whole context. The driver calls it `def.out(P, ctx.axis)`, and a
  // per-axis stage builds its path FROM that argument: passing CTX produced
  // `report-cards/[object Object].md`, which matched no artifact, so the cold corrective was measured
  // handing a converted card seat the WRITE-TOOL form and direction (b) blamed the composer. Invisible
  // for four conversions because a non-fan-out `out` ignores its second argument entirely.
  const out = lane.out(stage) ?? artifacts[0];
  const files = [Array.isArray(out) ? out[0] : out].filter(Boolean);
  const tokens = Object.values(lane.table[stage].contractElements ?? {}).flatMap((e) => e.tokens ?? []);
  const warmFails = ["missing_file",
    ...artifacts.flatMap((a) => tokens.map((t) => `invalid_file:${a}:${t}`)).filter(draftCarryEligible)];
  for (const f of warmFails) {
    union.push({ surface: `warm-repair:${f}`, kind: INSTRUCTION, phase: REPAIR, text: warmPatchMessage(f, files) });
  }
  // The COLD corrective takes tokens the warm lane refuses too — that is the whole point of the split —
  // so it is asked about every declared token plus both max-tokens shapes, wrapped and bare.
  const coldFails = ["missing_file", "max_tokens_no_output",
    ...artifacts.flatMap((a) => tokens.flatMap((t) => [`invalid_file:${a}:${t}`, `max_tokens_no_output:invalid_file:${a}:${t}`]))];
  for (const f of coldFails) {
    union.push({ surface: `cold-corrective:${f}`, kind: INSTRUCTION, phase: REPAIR, text: correctiveMessage("BASE", 2, f, files) });
  }
  // THE BESPOKE COMPOSERS, DERIVED. `stage: "*"` is walked for EVERY stage on purpose: those composers
  // compute their stage at the call site (`redo(label, …)` is keyed on the ARTIFACT so conversions
  // inherit it), so pinning them to one stage would leave the tool-vs-edit branch — the branch that
  // motivated this whole issue — walked for none.
  for (const c of REPAIR_COMPOSERS) {
    if (c.stage !== stage && c.stage !== "*") continue;
    // A wildcard composer's FIXED samples name one stage's tool, and walking those against every stage
    // reads as "blind-frame is ordered to call record_report_card" — which is an artifact of the sample,
    // not of the tree. `samplesForStage` builds the walking stage's own, which is what the call site does.
    const samples = c.samplesForStage
      ? c.samplesForStage({ stage, tool: RECORDING_TOOLS[stage]?.tool ?? RECORDING_TOOLS[stage], file: files[0] ?? artifacts[0] })
      : c.samples;
    for (const s of samples)
      union.push({ surface: `bespoke-repair:${c.key}/${s.name}`, kind: INSTRUCTION, phase: REPAIR, text: c.compose(s.args) });
  }
  return union;
}

/**
 * THE SURFACES THAT ARE PROVIDER-CONDITIONAL BY CONSTRUCTION —.
 *
 * The active provider's own deck is selected BY the provider (the dispatch names
 * `skills/prelim-register/providers/<name>.md` at runtime), so it cannot assert a capability of a
 * deployment it does not describe. Derived from the provider name, never a list anyone maintains.
 *
 * An UNRESOLVED provider yields an empty set — no guess. And the derivation fails LOUD rather than
 * silent: if decks move, this stops matching and the findings come BACK, which is the safe direction
 * for a rule whose job is to suppress them.
 */
function providerConditionalSurfacesFor() {
  if (!REGISTER_PROVIDER) return new Set();
  return new Set([`pointer:driver/skills/prelim-register/providers/${REGISTER_PROVIDER}.md`]);
}

/** Everything the guard needs for one stage, resolved once. */
function subjectFor(stage) {
  const held = bareGrant(allowedToolsFor(toolGroupsForStage(stage)));
  const artifacts = artifactsFor(stage, held);
  return { stage, granted: held, artifacts, union: unionFor(stage, artifacts), toolUniverse: knownToolNames(),
    // — the deployment's own withheld set, derived from the table that does the
    // excluding. Passed HERE and at the every-stage walk below, because a predicate the check
    // computes and the caller never hands it is the shape was about.
    backlog: TOOL_ORDER_BACKLOG, providerUnavailable: providerUnavailableRegisterTools(),
    providerConditionalSurfaces: providerConditionalSurfacesFor() };
}

// ── the population, and the arm that stops it emptying ───────────────────────────────────────────────

test("the population is the RECORDING category itself — a conversion enters this guard by landing its row", () => {
  const stages = Object.keys(RECORDING_STAGES);
  assert.ok(stages.length >= 2,
    "fewer than two recording stages — this file is asserting about a category that lost its members, "
    + "not passing. blind-frame (#1148) and skeptic (#1154) are both converted on this base.");
  // The three tables that must agree on membership, so no stage can be half-converted and unwatched.
  assert.deepEqual(Object.keys(RECORDING_TOOLS).sort(), stages.sort(),
    "RECORDING_TOOLS and RECORDING_STAGES disagree on membership — one of them is not describing the category");
});

// ── NON-VACUITY, asserted by naming tokens that MUST be present ─────────────────────────────────────
//
// `resolveSkillReads` has a try/catch fallback and `message(ctx)` can return a thinner string on a bare
// context, so an empty or truncated union would report three clean directions. The registry documents this
// exact failure one guard over — a tool universe that came back EMPTY while reporting a clean pass — and
// its cure is the one used here: assert a token the union is KNOWN to contain, never that it is non-empty.

test("direction (c)'s tool universe is REAL — an empty one would pass every stage silently", () => {
  // The failure this arm exists for has already happened once, one guard over: the registry's first cut
  // set `process.env.CLEAROTRON_DATABASE` and re-asked, every provider answered "not set", the tool
  // universe came back EMPTY, and the whole tool-order contract was inert while reporting a clean pass.
  // Direction (c) walks the universe, so a universe of nothing is a direction that cannot fire.
  //
  // ASSERTED BY NAMING A TOOL THAT MUST BE THERE, never by a length check — the registry's own cure. A
  // count can be satisfied by anything; a name cannot.
  const universe = knownToolNames();
  assert.ok(universe.includes("perplexity_research"),
    "the tool universe does not carry perplexity_research — it did not resolve, and direction (c) is now "
    + `walking ${universe.length} name(s) and finding nothing by construction`);
  assert.ok(universe.includes("record_skeptic"),
    "the tool universe does not carry a record tool, so direction (c) cannot see the category it is about");
});

test("every recording stage's union is real — it names the stage's own record tool and its own artifact", () => {
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const { union, granted, artifacts } = subjectFor(stage);
    const all = union.map((m) => m.text).join("\n");
    const recordTool = [...granted].find((t) => t.startsWith("record_"));
    assert.ok(recordTool, `${stage}: no record_* tool in its grant — the category's defining member is missing`);
    assert.ok(all.includes(recordTool), `${stage}: the union does not name ${recordTool}; it did not reach the dispatch`);
    for (const artifact of artifacts) {
      assert.ok(all.includes(artifact), `${stage}: the union does not name ${artifact}; it did not reach the repair surfaces`);
    }
    // SKILL DOCS: ASSERTED IN BOTH DIRECTIONS, because doubt-closure (conversion 6) is the first recording
    // stage that declares NONE. A bare "carries a skill doc" check reads a legitimately skill-less stage as
    // a truncated union — and worse, it would have gone on passing for the seven stages that do have them
    // while saying nothing about whether the collector reached the right ones. So ask the declaration:
    // a stage with skillReads must have them in the union, and a stage without must NOT — a skill surface
    // appearing for a stage that was never given one means the collector reached something else's.
    const declaredSkills = skillReadsFor(stage).length;
    const unionSkills = union.filter((m) => m.surface.startsWith("skill:")).length;
    if (declaredSkills) {
      assert.ok(unionSkills > 0, `${stage}: declares ${declaredSkills} skill doc(s) and the union carries none — it did not reach them`);
    } else {
      assert.equal(unionSkills, 0, `${stage}: declares no skill docs, so the union must carry none; ${unionSkills} means the collector reached a surface this stage was never given`);
    }
    assert.ok(union.some((m) => m.surface.startsWith("warm-repair:")), `${stage}: the union carries no warm repair rung`);
    assert.ok(union.some((m) => m.surface.startsWith("cold-corrective:")), `${stage}: the union carries no cold corrective`);
  }
});

// ── the three directions, over the real corpus ───────────────────────────────────────────────────────

test("#865 — a recording stage's grant and its orders AGREE, in all three directions", () => {
  const findings = [];
  for (const stage of Object.keys(RECORDING_STAGES)) findings.push(...agreementFindings(subjectFor(stage)));
  assert.deepEqual(findings.map((f) => `${f.direction} · ${f.stage} · ${f.tool ?? f.surface}`), [],
    "a converted stage's orders and its grant disagree:\n"
    + findings.map((f) => `  ${f.direction} · ${f.stage} · ${f.tool ?? ""} @ ${f.surface ?? "-"}\n    ${f.why}`).join("\n"));
});

test("…and direction (c)'s green is a MEASUREMENT, not an empty union — the backlog rows still reproduce", () => {
  // The ratchet, and the anti-vacuum arm in one. `contract-dictation.test.mjs` asserts every backlog row
  // still reproduces through E12; this asserts the recording-stage rows still reproduce through the union
  // E12 cannot build. If the union ever stops reaching `phase2-execution.md`, direction (c) goes green for
  // the wrong reason and this arm is what says so.
  const seen = [];
  for (const stage of Object.keys(RECORDING_STAGES)) seen.push(...reproducedBacklog(subjectFor(stage)));
  const expected = TOOL_ORDER_BACKLOG
    .filter((b) => b.stage in RECORDING_STAGES)
    .map((b) => ({ stage: b.stage, tool: b.tool }));
  assert.ok(expected.length > 0,
    "no backlog row names a recording stage any more — either #865 closed them (delete this expectation "
    + "with the rows) or the registry moved, and direction (c) is now unexercised by any real member");
  // SORTED BY (stage, tool), not by tool alone. Tool-only was not a TOTAL order: the moment two recording
  // stages shared a backlog tool the comparator tied, both sides kept their input order, and the two input
  // orders differ (one walks RECORDING_STAGES, the other walks TOOL_ORDER_BACKLOG). It went unnoticed while
  // exactly one recording stage had a row; conversion 3 added the second and it failed on the ORDER of two
  // identical pairs. A comparator that ties on the compared value is a sort that does not sort.
  const byPair = (a, b) => (a.stage.localeCompare(b.stage) || a.tool.localeCompare(b.tool));
  assert.deepEqual(seen.sort(byPair), expected.sort(byPair),
    "the backlog rows this guard reproduces are not the backlog rows the registry names for these stages. "
    + "FEWER means the union stopped reaching the file that carries the order — direction (c) is going green "
    + "on an empty read. MORE means a new member appeared and nobody named it.");
});

// ── ANTI-ROT: the write-order markers still match what the composers actually emit ───────────────────

// The hand-written artifact the marker arm drives its warm-patch case on: a stage output that NO
// TOOL_WRITTEN_ARTIFACTS row claims. Derived so a conversion re-points it rather than falsifying it —
// see the case itself for the run in which a hard-coded name went stale. A conversion that eventually
// claims every artifact here must replace this sample with a fixture that is DECLARED hand-written,
// never let the arm run on nothing: the assertion below refuses an empty set by name.
const HAND_WRITTEN_SAMPLE = ["common-law-findings.md", "case-law.md", "placement-recommendations.md", "register-band.json"]
  .find((f) => !TOOL_WRITTEN_ARTIFACTS.has(f)) ?? null;

// ── THE PATTERN TABLE MUST AGREE WITH ITSELF ───────────────────────────────────
//
// The third table is the only one whose declaration and whose members are stated SEPARATELY: the basename
// table's key IS the artifact, and a directory row's members are whatever is in the directory. A pattern
// row carries a regex AND a `sample`, and nothing joined them — so a row whose sample did not match its
// own pattern would hand the enumeration an artifact name the lookup answers `null` for, and direction
// (b) would key on a file no repair surface can resolve. Silent, and in the failing direction.
//
// Found while writing up what reds on drift, which is the answer to a question worth being asked: the
// pattern-vs-producer half could not drift because the pattern is IMPORTED from the module that builds
// the path, and the row-vs-population half was already covered by artifactsFor's own floor. This half was
// not covered by either, and it is the one a future row will trip.
test("every pattern row agrees with itself — the sample matches the regex and resolves back to that row", () => {
  assert.ok(TOOL_WRITTEN_PATTERNS.length > 0,
    "TOOL_WRITTEN_PATTERNS is empty — the fan-out-at-the-run-root shape has no members, so this arm and "
    + "artifactsFor's third spread both walk nothing while reporting clean");

  for (const row of TOOL_WRITTEN_PATTERNS) {
    assert.match(row.sample, row.re,
      `${row.tool}: the row's own sample "${row.sample}" does not match its own pattern. artifactsFor names `
      + "the sample and every repair surface resolves through the pattern, so the guard would key on an "
      + "artifact the lookup cannot find and direction (b) would go quiet on this stage");

    // THE JOIN, and it is the point: the enumeration's name, put through the SHIPPED accessor, must come
    // back as THIS row. A sample that matched its own regex but resolved elsewhere — shadowed by an exact
    // row, or swallowed by a declared directory — would be worse than one that resolved to nothing.
    const resolved = toolWrittenArtifact(`/run/${row.sample}`);
    assert.equal(resolved?.tool, row.tool,
      `${row.tool}: its sample resolves to ${JSON.stringify(resolved?.tool ?? null)} through toolWrittenArtifact, `
      + "not to this row. The enumeration and the lookup disagree about who owns this artifact");

    // OVER-MATCH AGAINST EXACTLY-KEYED ARTIFACTS. A pattern that also matches one is the shape that
    // re-routes someone else's repair to a tool that cannot write it. The lookup prefers the exact row so
    // the live path survives it, but the enumeration would double-count and the next pattern added might
    // not be so lucky in its ordering.
    for (const basename of TOOL_WRITTEN_ARTIFACTS.keys()) {
      assert.doesNotMatch(basename, row.re,
        `${row.tool}'s pattern also matches "${basename}", which has its own exact row. Two rows claiming `
        + "one artifact is a repair aimed at whichever the reader consulted first — anchor the pattern");
    }
  }
});

// ── OVER-MATCH AGAINST THE ARTIFACTS THAT HAVE NO ROW AT ALL ────────────────────────────────────────
//
// ✕ THE ARM ABOVE DOES NOT CATCH THE WORST CASE, and a plant proved it: replacing the anchored pattern
// with `/^knockout-assess/` — which swallows `knockout-assessment.md`, the merged prose document sitting
// in the same run root and still HAND-WRITTEN — passed every arm in this file.
//
// The reason is the shape of the population it walks. `TOOL_WRITTEN_ARTIFACTS.keys()` is the set of
// artifacts that HAVE a row; a hand-written artifact has none, by definition, so the one kind of file a
// pattern must never claim is the one kind that census cannot enumerate. An over-match check keyed on
// the tool-written tables is blind in exactly the direction that fails silently: the miss tells a seat
// to CALL a tool for a document it is supposed to write itself.
//
// The population that CAN see them is the lane's own path builder. Every string `koPaths` constructs is
// an artifact this lane names, and all of them are hand-written — the chunk is the one built by a
// function, and it is asserted from the other side. Derived, so a new artifact added to the lane joins
// this check without anyone remembering to add it.
test("a pattern never claims an artifact that has no row — the hand-written siblings in the same run root", () => {
  const K = koPaths("/RUN");
  const strings = Object.entries(K).filter(([, v]) => typeof v === "string");
  assert.ok(strings.length >= 3,
    `koPaths built ${strings.length} plain path(s) — this arm walks the lane's own artifacts and a near-empty `
    + "set would clear every pattern vacuously");

  // ── THE POPULATION IS PARTITIONED BY THE TABLE, NOT BY A LIST OF EXCEPTIONS ────────────────────
  //
  // When this arm was written every one of the lane's plain paths was hand-written. Converting the frame
  // stage ( item C) gave two of them rows — `knockout-plan.json` and
  // `knockout-frame.md` — and the arm failed, correctly: it was asserting they had none.
  //
  // The tempting repair is an exclusion list, and it would rot the moment a third artifact converts.
  // Instead the split is DERIVED from the same table the assertion is about: a path whose basename has a
  // row must resolve to that row's tool, and a path with no row must resolve to nothing. Both halves are
  // asserted, so the arm cannot be satisfied by everything drifting to one side.
  const claimed = strings.filter(([, p]) => TOOL_WRITTEN_ARTIFACTS.has(basename(p)));
  const unclaimed = strings.filter(([, p]) => !TOOL_WRITTEN_ARTIFACTS.has(basename(p)));
  assert.ok(unclaimed.length > 0,
    "every plain path this lane builds is now tool-written, so the over-match half of this arm has no "
    + "hand-written artifact left to protect. That is not a pass: re-point it at a lane that still has "
    + "one, or retire it with the branch it tests");

  for (const [key, path] of unclaimed) {
    const row = toolWrittenArtifact(path);
    assert.equal(row, null,
      `koPaths.${key} (${path}) resolves to ${JSON.stringify(row?.tool ?? null)}. It is hand-written and has no `
      + "row, so a table claiming it will tell a seat to call a tool that cannot write it — and because a "
      + "hand-written artifact is absent from every tool-written census, no other arm here can see this");
  }

  // THE OTHER HALF, so a table that stopped resolving anything cannot satisfy the loop above by making
  // every path unclaimed. A path WITH a row must resolve through the shipped accessor to that row.
  for (const [key, path] of claimed) {
    const row = toolWrittenArtifact(path);
    assert.equal(row?.tool, TOOL_WRITTEN_ARTIFACTS.get(basename(path))?.tool,
      `koPaths.${key} (${path}) has a row in TOOL_WRITTEN_ARTIFACTS but does not resolve to it through `
      + "toolWrittenArtifact — the table and the accessor disagree about who writes this artifact");
  }

  // THE OTHER SIDE, so the arm cannot pass by the resolver having stopped resolving anything at all.
  assert.equal(toolWrittenArtifact(K.assessChunk(0))?.tool, "record_knockout_assess",
    "the chunk artifact no longer resolves to its record tool — the arm above would then be asserting that "
    + "nothing resolves, which every broken resolver satisfies");
});

test("the marker arm's hand-written fixture still exists — an empty sample would pass every case vacuously", () => {
  assert.ok(HAND_WRITTEN_SAMPLE,
    "every candidate artifact is now tool-written, so the warm-patch marker case below has no hand-written "
    + "branch to drive. That is not a pass: re-point the sample at an artifact that is still the seat's, or "
    + "retire the case with the branch it tests.");
});

test("the write-order markers are INDEPENDENT of the composers but cannot go stale against them", () => {
  // WRITE_ORDER_MARKERS is deliberately not imported from the composers — a pattern derived from the thing
  // it detects compares a value with itself, the same reason RECORDING_TOOLS is literal. Independence
  // without this arm is just staleness waiting: a rephrasing would leave direction (b) matching nothing and
  // reporting clean. So every live composer is driven through the markers here.
  const hits = (text) => WRITE_ORDER_MARKERS.filter((m) => m.re.test(text)).map((m) => m.id);
  const cases = [
    ["writeReturn (prose path)", writeReturn("/run/out.md")],
    ["writeReturn (form path)", writeReturn("/run/out.md", ["/run/form.json"])],
    ["fullWriteTail", fullWriteTail("/run/out.md")],
    ["editRepairTail", editRepairTail("/run/out.md")],
    // The composer whose miss this guard found. Driven on a stage with NO tool-written row, which is the
    // branch that must keep ordering a write — a marker that stopped matching here would hide the defect
    // this file exists to have caught.
    ["correctiveMessage (max_tokens, hand-written artifact)",
      correctiveMessage("BASE", 2, "max_tokens_no_output:invalid_file:common-law-findings.md:findings_empty", ["/run/common-law-findings.md"])],
    // The fifth composer, and the one the marker list did not know about until the third conversion. Driven
    // on a stage whose sibling is NOT tool-written, which is the branch that must keep ordering a re-save.
    //
    // THE FIXTURE IS DERIVED, NOT NAMED, and conversion 11 is why. This case used to pass
    // `register-findings.md` as its hand-written example; that conversion made the document tool-written,
    // so the composer took the CALL branch, emitted no write order, and the arm failed — reporting a
    // stale marker list when nothing about the markers had moved. A canary that names a specific artifact
    // asserts the tree it was written on. `HAND_WRITTEN_SAMPLE` is any artifact NO tool-written row
    // claims, so the next conversion re-points it instead of breaking it, and the assertion below it
    // fails loudly rather than vacuously if that set ever empties.
    [`warmPatchMessage (sibling re-save, hand-written sibling: ${HAND_WRITTEN_SAMPLE})`,
      warmPatchMessage(`invalid_file:${HAND_WRITTEN_SAMPLE}:findings_empty`, [`/run/${HAND_WRITTEN_SAMPLE}`])],
  ];
  for (const [what, text] of cases) {
    assert.ok(hits(text).length > 0,
      `${what} composes a write order that NO marker matches. Direction (b) is now blind to it — add the `
      + `marker in the same commit as the rephrasing. Text: ${JSON.stringify(text.slice(0, 160))}`);
  }
});

test("…and the converted seats get the CALL form of that same corrective, not the write form", () => {
  // The other half of the fix, asserted where a reader will look for it: the branch is chosen by the
  // artifact, so it is proven per recording stage rather than on one example.
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const { granted, artifacts } = subjectFor(stage);
    for (const artifact of artifacts) {
      // THE TOOL IS THE ARTIFACT'S, NOT "the first record_ token in the grant". That heuristic held only
      // while every recording stage carried exactly one record tool, and synthesis is the first that does
      // not — it holds `record_declination` as well, and set order handed this arm the wrong one, so a
      // correct corrective failed. The artifact's own row names the tool that writes it, which is the
      // same question the corrective asks when it picks a branch.
      //
      // NOT CIRCULAR, and the distinction matters because this file refuses derived patterns elsewhere:
      // the composer reads this table to CHOOSE a branch; this arm asserts the composed TEXT names that
      // tool and that the stage is actually granted it. A table lookup compared against a rendered
      // message is not a value compared with itself.
      // Through `toolWrittenArtifact`, not the basename Map: a per-ordinal card (`report-cards/1.md`)
      // lives in TOOL_WRITTEN_DIRS and the basename lookup answers null for it. That accessor exists
      // precisely so no consumer has to remember there are two tables — gateway.mjs' own comment says
      // every consumer goes through it, and an arm that reached past it read one table and reported the
      // other's members as unconverted.
      const recordTool = toolWrittenArtifact(`/run/${artifact}`)?.tool;
      assert.ok(recordTool,
        `${stage}: ${artifact} is a converted stage's artifact with no TOOL_WRITTEN_ARTIFACTS row — the corrective cannot name a tool for it, and every repair of it falls back to a write order`);
      assert.ok([...granted].includes(recordTool),
        `${stage}: ${artifact}'s row names ${recordTool}, which this stage's resolved grant does not carry — the corrective would order a call the seat cannot make`);
      const text = correctiveMessage("BASE", 2, `max_tokens_no_output:invalid_file:${artifact}:x`, [`/run/${artifact}`]);
      assert.doesNotMatch(text, /CALL THE WRITE TOOL/,
        `${stage}: the cold corrective still orders the Write tool for ${artifact}, whose only writer is the driver`);
      assert.match(text, new RegExp(recordTool),
        `${stage}: the cold corrective names no tool at all for ${artifact} — the seat is told the write failed and given no way to retry it`);
    }
  }
});

// ── SIX PLANTS — two stages by three directions, through the pure predicate ──────────────────────────
//
// Every green above is a walk over a corpus that happens to be clean. These are what make it a detection.
// Pure, so each is a few lines and nothing is written into the tree ('s reason for splitting the
// checker from its scan).

const plantBase = (stage) => ({
  stage, granted: new Set(["Read", "record_probe"]), artifacts: ["probe-artifact.json"],
  toolUniverse: ["record_probe", "perplexity_research"], backlog: [],
  union: [{ surface: "dispatch:probe", kind: INSTRUCTION, phase: ATTEMPT_1, text: "Call `record_probe` with your values." }],
});

test("PLANT (a): a granted tool no instruction names is caught, per stage", () => {
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const p = plantBase(stage);
    p.granted = new Set(["Read", "record_probe", "search_probe"]);       // granted, ordered nowhere
    const f = agreementFindings(p);
    assert.deepEqual(f.map((x) => [x.direction, x.tool]), [["granted-but-never-ordered", "search_probe"]],
      `${stage}: the predicate does not detect a granted tool that no instruction names`);
  }
});

test("PLANT (a) CONTROL: naming it in a SURFACE is not naming it in an instruction", () => {
  // The vacuity this direction would have if the mounted tool schema counted. A granted tool is always in
  // the schema, so a check that read it would pass for every tool in every grant, forever.
  const p = plantBase("blind-frame");
  p.granted = new Set(["Read", "record_probe", "search_probe"]);
  p.union.push({ surface: "tool-schema:probe", kind: SURFACE, text: "search_probe searches this run's artifacts." });
  assert.deepEqual(agreementFindings(p).map((x) => x.tool), ["search_probe"],
    "the tool schema silenced direction (a) — it must read INSTRUCTION members only, or it is vacuous by construction");
});

test("⭐ PLANT (a) #1190: a tool named ONLY in a repair rung is still granted-but-never-ordered", () => {
  // THE ARM THE ISSUE EXISTS TO ADD, and the reason the existing PLANT (a) never caught this: that one
  // names the tool NOWHERE, so it passes whether or not repair rungs count. This one names it in exactly
  // the place that must not count, which is also the place every conversion fills in for free — since
  // both rungs derive the tool name from TOOL_WRITTEN_ARTIFACTS, so adding that row silences (a).
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const p = plantBase(stage);
    p.granted = new Set(["Read", "record_probe", "search_probe"]);
    p.union.push({ surface: "warm-repair:probe", kind: INSTRUCTION, phase: REPAIR,
      text: "Call `search_probe` to find what you already recorded, then patch it." });
    p.union.push({ surface: "cold-corrective:probe", kind: INSTRUCTION, phase: REPAIR,
      text: "Use `search_probe` for the prior artifact before re-answering." });
    assert.deepEqual(agreementFindings(p).map((x) => [x.direction, x.tool]),
      [["granted-but-never-ordered", "search_probe"]],
      `${stage}: a repair-only mention satisfied direction (a) — the seat that needed to know the `
      + "capability existed had already acted by the time it read a repair rung");
  }
});

test("PLANT (a) #1190 CONTROL: the SAME text on an attempt-1 surface does satisfy (a)", () => {
  // Without this, the arm above is satisfied by a direction (a) that has stopped working altogether.
  const p = plantBase("blind-frame");
  p.granted = new Set(["Read", "record_probe", "search_probe"]);
  p.union.push({ surface: "skill:probe", kind: INSTRUCTION, phase: ATTEMPT_1,
    text: "Call `search_probe` to find what you already recorded, then patch it." });
  assert.deepEqual(agreementFindings(p), [],
    "an attempt-1 instruction naming the tool must satisfy (a) — otherwise the phase split has simply "
    + "broken the direction rather than narrowed it");
});

test("PLANT (a) #1190: an INSTRUCTION member with no phase is REFUSED, never defaulted", () => {
  // Either default picks a side silently, so the union must say. A throw and not a finding: findings are
  // claims about the engine, and an unphased member is a bug in whatever assembled the union.
  const p = plantBase("blind-frame");
  p.union.push({ surface: "mystery:probe", kind: INSTRUCTION, text: "Call `record_probe`." });
  assert.throws(() => agreementFindings(p), /mystery:probe.*attempt-1 or repair|phase/s,
    "an unphased instruction member was accepted — one of the two defaults would then be chosen for it");
});

test("PLANT (b): a hand-write order for a tool-owned artifact is caught, per stage and per marker", () => {
  for (const stage of Object.keys(RECORDING_STAGES)) {
    for (const marker of WRITE_ORDER_MARKERS) {
      const p = plantBase(stage);
      const sample = { "writeReturn:absolute-path": "Write your output to this ABSOLUTE path: /run/probe-artifact.json",
        "writeReturn:you-owe": "YOU OWE 2 FILES. 2. probe-artifact.json",
        "repair-tail:write-tool": "Write the COMPLETE file now at probe-artifact.json with the Write tool.",
        "repair-tail:edit-tool": "Apply TARGETED EDITS to probe-artifact.json using the Edit tool.",
        "corrective:max-tokens-write-tool": "CALL THE WRITE TOOL for probe-artifact.json as soon as it is ready.",
        "warm-sibling:re-save-complete": "Re-save the COMPLETE corrected JSON at /run/probe-artifact.json." }[marker.id];
      assert.ok(sample, `no plant sample for marker ${marker.id} — a marker added without one is unproven`);
      p.union.push({ surface: "repair:probe", kind: INSTRUCTION, phase: REPAIR, text: sample });
      const f = agreementFindings(p);
      assert.deepEqual(f.map((x) => x.direction), ["hand-write-ordered"],
        `${stage}: marker ${marker.id} does not detect a hand-write order for a tool-written artifact`);
    }
  }
});

test("PLANT (b) CONTROL: a write order naming a DIFFERENT file is not this defect", () => {
  // Direction (b) is keyed on the artifact, not on the grant. A stage may legitimately be told to write
  // something else; firing on that would make the guard unkeepable and earn itself an exemption list.
  const p = plantBase("skeptic");
  p.union.push({ surface: "repair:probe", kind: INSTRUCTION, phase: REPAIR, text: "Write the COMPLETE file now at scratch-notes.md with the Write tool." });
  assert.deepEqual(agreementFindings(p), [], "direction (b) fires on a write order for a file the typed tool does not own");
});

test("PLANT (c): an ordered tool the grant denies is caught, and its backlog row excuses it", () => {
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const p = plantBase(stage);
    p.union.push({ surface: "skill:probe", kind: INSTRUCTION, phase: ATTEMPT_1, text: "Run a `perplexity_research` query for the neighbour." });
    assert.deepEqual(agreementFindings(p).map((x) => [x.direction, x.tool]), [["ordered-but-not-granted", "perplexity_research"]],
      `${stage}: the predicate does not detect an order for a tool the grant denies`);

    // …and the SAME plant with the row present goes quiet — the excuse is the registry's, read here, not
    // a second list. A direction that could not be excused would be papered over with one.
    p.backlog = [{ stage, tool: "perplexity_research" }];
    assert.deepEqual(agreementFindings(p), [], `${stage}: a named backlog row does not excuse its own member`);
    // …and the row is then REQUIRED to still reproduce, which is what stops it outliving its defect.
    assert.deepEqual(reproducedBacklog({ ...p, backlog: [{ stage, tool: "perplexity_research" }] }),
      [{ stage, tool: "perplexity_research" }], `${stage}: an excused member is not re-derived, so its row can go stale unnoticed`);
  }
});

test("PLANT (c) CONTROL: a backlog row for ANOTHER stage does not excuse this one", () => {
  const p = plantBase("skeptic");
  p.union.push({ surface: "skill:probe", kind: INSTRUCTION, phase: ATTEMPT_1, text: "Run a `perplexity_research` query." });
  p.backlog = [{ stage: "some-other-stage", tool: "perplexity_research" }];
  assert.deepEqual(agreementFindings(p).map((x) => x.tool), ["perplexity_research"],
    "the excuse is not stage-scoped — one stage's named member would silence every other stage's");
});

test("PLANT: a tool named as a SUBSTRING is not a tool named", () => {
  // `record_probe` inside `record_probe_extra` is a different identifier. Without the word boundaries,
  // direction (a) would read a longer name as satisfying a shorter one and go green on nothing.
  const p = plantBase("blind-frame");
  p.granted = new Set(["Read", "record_probe"]);
  p.union = [{ surface: "dispatch:probe", kind: INSTRUCTION, phase: ATTEMPT_1, text: "Call `record_probe_extra` with your values." }];
  assert.deepEqual(agreementFindings(p).map((x) => [x.direction, x.tool]), [["granted-but-never-ordered", "record_probe"]],
    "a substring match satisfied direction (a) — `record_probe_extra` is not `record_probe`");
});

// ──: THE UNION REACHES THE BESPOKE COMPOSERS ──────────────────────────────────────────────────

test("#1183: the union carries the registry's composers, and it is NOT vacuous", () => {
  // NON-VACUITY BY NAMING WHAT MUST BE THERE, never by a length check — this file's own cure, applied to
  // its newest arm. A registry walk that silently returned nothing would add no surfaces and every
  // direction would go on reporting clean, which is the shape exists to end.
  const surfaces = Object.keys(RECORDING_STAGES).flatMap((s) => subjectFor(s).union.map((u) => u.surface));
  const bespoke = surfaces.filter((s) => s.startsWith("bespoke-repair:"));
  assert.ok(bespoke.length >= 6, `only ${bespoke.length} bespoke repair surface(s) in the union — the registry walk is dead`);
  assert.ok(bespoke.some((s) => s.startsWith("bespoke-repair:matter-frame:intake-asks-followup")),
    "the composer whose defect was MEASURED must be in the union — it is the reason this arm exists");
  // …and the wildcard composers reach every stage, or the tool-vs-edit branch is walked for none.
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const u = subjectFor(stage).union.map((x) => x.surface);
    assert.ok(u.some((x) => x.startsWith("bespoke-repair:*:lint-repair")),
      `${stage} — the call-site-computed composers must be walked for every stage`);
  }
});

test("#1183 (planted): a bespoke composer that orders a hand-write of a TOOL-WRITTEN artifact is reported", () => {
  // The demonstration the issue asks for, on the `deriveIntakeAsks` shape that was the confirmed defect:
  // a followup closed by the shared edit tail, on a stage whose grant carries no write tool for that
  // artifact. Before the union derived from the registry, this text was invisible and the stage read
  // clean in all three directions.
  const stage = Object.keys(RECORDING_STAGES)[0];
  const base = subjectFor(stage);
  const target = base.artifacts[0];
  const planted = {
    ...base,
    union: [...base.union, {
      surface: "bespoke-repair:planted", kind: INSTRUCTION, phase: REPAIR,
      text: `Your ${target} is missing rows. ${editRepairTail(target)}`,
    }],
  };
  const before = agreementFindings(base).length;
  const after = agreementFindings(planted);
  assert.ok(after.length > before,
    "a hand-write order for a tool-written artifact must be REPORTED. If this passes, the union is being "
    + "walked but the direction that judges it is not reading the surfaces the registry adds.");
  assert.ok(after.some((f) => String(f.surface ?? "").includes("planted")),
    "…and the finding must name the planted surface, not merely count one more");
});

// ── THE ABSENCE AND ITS CAUSE ──────────────────────────────────────────────────
//
// A tool-written artifact can be missing because the seat never called its tool, or because every call
// was REFUSED. Those are different findings and the token was the same for both, so a stage that met a
// defect, was named it, and could not restate reported as a stage that never tried. gateway's judge now
// reads the transport's refusal journal on the missing-file branch — and the LOOKUP is what goes quiet
// if a row loses its function, so it is asserted here rather than only end-to-end.
test("#1893 the tool-written rows carry a refusal reader, and it reads a real journal", () => {
  const runDir = mkdtempSync(join(tmpdir(), "refusal-row-"));
  for (const f of [NARRATIVE_FILE, FINDINGS_FILE]) {
    const row = toolWrittenArtifact(join(runDir, f));
    assert.ok(row, `${f}: no tool-written row — the judge would take the hand-write branch`);
    assert.equal(typeof row.refusals, "function",
      `${f}: the row carries no refusal reader, so an exhausted stage reports "produced nothing" for a `
      + "run whose every call was turned away by name");
    // EMPTY FIRST, so the arm cannot pass on a reader that returns something for any input.
    assert.deepEqual(row.refusals(runDir), [], `${f}: a run with no journal must read as no refusals`);
  }
  // Plant one and read it back through the SAME row, so the reader is proven against the writer's own
  // path rather than against a shape this test invented.
  const { dir, refusals } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(refusals, JSON.stringify({ at: 1, reason: "synthesis_coverage_recommendation:planted" }) + "\n"
    + JSON.stringify({ at: 2, reason: "synthesis_ask_answers_misplaced:planted-last" }) + "\n");
  const read = toolWrittenArtifact(join(runDir, NARRATIVE_FILE)).refusals(runDir);
  assert.equal(read.length, 2, "both journal lines are read");
  assert.equal(read[read.length - 1].reason, "synthesis_ask_answers_misplaced:planted-last",
    "the LAST entry is the one the stage exhausted on — the judge reports that one, so order is load-bearing");
});

// ── THE POPULATION IS EVERY STAGE, NOT THE RECORDING CATEGORY ──────────────────
//
// Everything above asks its three questions of `RECORDING_STAGES` — 8 of 16 stages when this was
// written, 10 of 16 on the tree this lands on. The other six were asked nothing by this module, and the
// number moves every time a stage converts, which is the reason to stop keying on the category at all
// rather than to keep the sentence current. E12 cannot cover them either: its
// population is `driver/skills/**`, so neither the DISPATCH nor the repair ladder is in its reach.
//
// Directions (a) and (c) are meaningful for every stage. Direction (b) needs an artifact a typed tool
// owns, so it is intrinsically scoped — and the scoping is COUNTED AND NAMED below rather than skipped,
// because a recording stage that later loses its TOOL_WRITTEN_ARTIFACTS row must fall out of (b) loudly.
//
// ── WHAT A NAIVE WIDENING REPORTS, MEASURED BEFORE THIS WAS WRITTEN ────────────────────────────────
//
// Five findings, four of them false, from two causes that both had to be fixed first:
//
//   register-unit  register_image_fetch, register_record_fetch   the dispatch orders a PROVIDER DECK by
//       name and the union read only `skillReads` literals. Cleared by following dispatch-named pointers.
//   case-law       mcp__courtlistener__*, mcp__legaldatahunter__*   a bridge wildcard cannot be "named"
//       in prose by any dictation. Cleared by excluding wildcards in the module, with the cost stated.
//
// The fifth survives and is real: `register_batch_screen` is in register-unit's grant and named in no
// attempt-1 instruction under the provider CI runs. It is filed separately as its own defect rather than
// carried here as an exemption — see ``, which also records
// that this check's answer DIFFERS UNDER EACH OF SIX PROVIDERS and the suite drives one.
const EVERY_STAGE = Object.keys(STAGES);

test("tracker issue 1924: directions (a) and (c) hold for EVERY stage, not only the recording category", () => {
  assert.ok(EVERY_STAGE.length >= 16,
    `only ${EVERY_STAGE.length} stage(s) — the table is not being read, and a walk over a short list is `
    + "how this arm would report clean without covering anything");

  const noArtifact = [];
  const findings = [];
  for (const stage of EVERY_STAGE) {
    const held = bareGrant(allowedToolsFor(toolGroupsForStage(stage)));
    const artifacts = artifactsFor(stage, held);
    if (!artifacts.length) noArtifact.push(stage);
    findings.push(...agreementFindings({
      stage, granted: held, artifacts, union: unionFor(stage, artifacts),
      toolUniverse: knownToolNames(), backlog: TOOL_ORDER_BACKLOG,
      providerUnavailable: providerUnavailableRegisterTools(),   //
      providerConditionalSurfaces: providerConditionalSurfacesFor(),   //
    }));
  }

  // THE SKIP LIST IS ASSERTED, NOT COUNTED. A stage with no tool-written artifact is invisible to
  // direction (b) — legitimately, for an ordinary gather stage, and NOT legitimately for a recording one.
  // Pinning the membership means a conversion that loses its row appears here by name.
  assert.deepEqual(
    noArtifact.filter((s) => s in RECORDING_STAGES), [],
    "a RECORDING stage has no tool-written artifact, so direction (b) — the direction with a measured "
    + "incident behind it — silently checks nothing for it. Its TOOL_WRITTEN_ARTIFACTS row is missing.");
  assert.ok(noArtifact.length >= 1,
    "every stage has a tool-written artifact, which would mean the whole product converted — far likelier "
    + "is that `artifactsFor` stopped discriminating, in which case direction (b) is now vacuous for the "
    + "stages it was scoped away from");

  const shaped = findings.map((f) => `${f.direction} · ${f.stage} · ${f.tool ?? f.artifact ?? "?"}`).sort();
  // CLEARED, and lowered here in the same commit so the fix is recorded rather than
  // absorbed — which is what the message below asks of whoever clears one.
  //
  // The row was real and provider-dependent: under corsearch, register-unit held `register_batch_screen`
  // and no attempt-1 instruction named it. It is cleared by NAMING the capability in the funnel's own
  // doctrine rather than by narrowing the grant, and the distinction is the whole of it. Every record
  // `register_enumerate` returns is already batch-screened and already whole, and the frozen plan's
  // entries are fetched by the executor — so reaching for that tool means the QUERY is wrong, and
  // `prelim-register/unit.md` now says exactly that, for `register_record_fetch` and
  // `register_image_fetch` beside it. A seat told nothing about a tool it holds reaches for whatever the
  // doctrine DOES name and picks wrongly; that is the failure this direction is about, and naming closes
  // it. NARROWING THE GRANT WOULD CHANGE BEHAVIOUR and waits for a measurement of how often those
  // capabilities are actually reached for — nobody should tidy the grant on the strength of the doctrine
  // line alone.
  assert.deepEqual(shaped, [
  ], "the widened population's findings moved. A NEW row is a real disagreement between a stage's orders "
    + "and its grant — read it, do not pin it. A row VANISHING is the better news and still needs the "
    + "expectation lowered in the same commit, so the fix is recorded rather than absorbed.");
});

test("tracker issue 1924: the widened walk is real — it reaches a doc only the dispatch names", () => {
  // THE ANTI-VACUOUS ARM. Everything above passes just as well over a union that never loaded the
  // provider deck — it would simply report two more findings, and a reader lowering the expectation to
  // match would bake the blindness in. This asserts the pointer-following actually happened.
  const stage = "register-unit";
  const held = bareGrant(allowedToolsFor(toolGroupsForStage(stage)));
  const union = unionFor(stage, artifactsFor(stage, held));
  const pointers = union.filter((m) => m.surface.startsWith("pointer:"));
  assert.ok(pointers.length >= 1,
    `${stage}'s dispatch orders a provider deck by name and the union carries no pointer surface — the `
    + "runtime-named doctrine is not being read, and every tool the deck names will report as unordered");
  assert.ok(pointers.some((p) => /providers\//.test(p.surface)),
    `the pointer surfaces are ${pointers.map((p) => p.surface).join(", ")} — none is a provider deck, so `
    + "whatever is being followed is not the runtime-selected doctrine this arm is about");
  // …and the deck's CONTENT is in the union, not just its name: a surface whose text never loaded would
  // satisfy the two assertions above and answer no question at all.
  const deck = pointers.find((p) => /providers\//.test(p.surface));
  assert.ok(deck.text.length > 500,
    `${deck.surface} carries ${deck.text.length} bytes — the file was named but not read`);
});

// ── A TOOL NAMED IN A SHARED DOC IS ORDERED FOR EVERY READER OF IT ─────────────
//
// Six documents on this tree have more than one reader, two of them three readers. A tool token in one is
// ORDERED for every stage that reads it and GRANTED to at most one — so direction (c) fires, correctly,
// on a stage that had nothing to do with the change, and the failure names the innocent stage.
//
// Measured, converting the writer: adding `record_synthesis` to `synthesis-rules.md` failed as
//   ordered-but-not-granted · report-overview · record_synthesis @ skill:.../synthesis-rules.md
// report-overview reads that file and does not hold the tool. The finding is TRUE and the stage named is
// the wrong place to look.
//
// This arm asks the question at the DOC rather than at the stage, so the failure names the file and the
// token — which is where the edit has to happen — and fires once rather than once per innocent reader.
test("tracker issue 1924: a tool named in a multi-reader doc is granted to every reader of it", () => {
  const readers = new Map();                       // rel -> stages that are told to read it
  for (const stage of EVERY_STAGE) {
    for (const rel of skillReadsFor(stage)) {
      readers.set(rel, [...(readers.get(rel) ?? []), stage]);
    }
  }
  const shared = [...readers].filter(([, ss]) => ss.length > 1);
  // FLOOR. If the tree stops having shared docs this arm covers nothing, and a green would say the
  // opposite. Six today; the floor is deliberately below that so a legitimate consolidation does not red.
  assert.ok(shared.length >= 4,
    `only ${shared.length} multi-reader doc(s) found — the reader map is broken, not the tree`);

  const universe = new Set(knownToolNames());
  const offenders = [];
  for (const [rel, stages] of shared) {
    const text = readFileSync(join(DRIVER, rel), "utf8");
    for (const tool of universe) {
      if (!new RegExp(`(?<![A-Za-z0-9_])${tool}(?![A-Za-z0-9_])`).test(text)) continue;
      const without = stages.filter((s) => !bareGrant(allowedToolsFor(toolGroupsForStage(s))).has(tool));
      // NAMED BY DOC AND TOKEN, never by the innocent reader. The stages are listed as evidence, not as
      // the subject: the edit is to the sentence in the file, and pointing a reader at report-overview
      // sends them to a stage whose only involvement is that it was told to read something.
      if (without.length) offenders.push(`${rel} names ${tool}, not held by: ${without.join(", ")}`);
    }
  }
  // ✕ PINNED, NOT EMPTY, AND THE FIRST CUT OF THIS ARM HAD IT WRONG.
  //
  // It asserted `[]` and reported NINE rows, every one of them true and none of them a defect. The two
  // documents involved are explicitly multi-mode: `prelim-register/SKILL.md` says in its own header that
  // it "runs in one of two modes the orchestrator selects", and labels the sections **Unit mode (the
  // FUNNEL — Layer A)** and **Digest mode (judgment — Layer B)**. It names `register_enumerate` inside the
  // unit half and the band tools inside the digest half, and each stage holds the half it is dispatched
  // as. The sentences ARE scoped — in prose, which is the one thing a token match cannot read.
  //
  // So an empty expectation makes this a nuisance arm that nine correct rows fail forever, and the
  // predictable response to a nuisance arm is to delete it. Pinned instead: these nine are the mode-scoped
  // set as, and a TENTH is the finding. That is the same shape E3's own
  // `E3_EVIDENCE_UNRESOLVED` uses for the same reason — a known, reasoned residue is recorded rather than
  // absorbed, and the arm keeps its teeth for what arrives next.
  //
  // A row LEAVING this list is good news and still wants the entry removed in the same commit, or the
  // list slowly becomes a licence rather than a record.
  const MODE_SCOPED = [
    "skills/prelim-register/SKILL.md names band_lookup, not held by: register-unit",
    "skills/prelim-register/SKILL.md names band_record, not held by: register-unit",
    "skills/prelim-register/SKILL.md names band_shape, not held by: register-unit",
    "skills/prelim-register/SKILL.md names record_coverage, not held by: register-unit",
    // Conversion 11 — the TENTH row, and it is the same mode-scoped shape as the four above it rather
    // than the finding this list was left open for. The mention sits in SKILL.md's **Digest mode
    // (judgment — Layer B)** bullet, the same sentence that already names `record_coverage` and the band
    // tools; register-unit reads the shared spine and is dispatched as the FUNNEL, which that bullet is
    // explicitly not addressing. Scoping it further is not available — the spine is one file by design,
    // and the section labels are the scoping.
    "skills/prelim-register/SKILL.md names record_register_digest, not held by: register-unit",
    "skills/prelim-register/SKILL.md names register_enumerate, not held by: register-digest",
    "skills/prelim-register/SKILL.md names register_execute_plan, not held by: register-digest",
    "skills/prelim-search/synthesis-rules.md names band_lookup, not held by: report-overview",
    "skills/prelim-search/synthesis-rules.md names band_record, not held by: report-overview",
    "skills/prelim-search/synthesis-rules.md names perplexity_research, not held by: report-overview",
  ];
  assert.deepEqual(offenders.sort(), [...MODE_SCOPED].sort(),
    "a shared document names a tool that some of its readers cannot call, and it is not one of the ten "
    + "mode-scoped rows recorded above. Every reader is ORDERED by that document, so the call is "
    + "impossible for the ones without the grant and the shortfall reads as a model that chose not to. "
    + "Scope the sentence to the seat that holds the tool, grant it to the others, or drop the name — and "
    + "make the edit in the DOC named here, not in the stage a direction-(c) finding would have pointed "
    + `at:\n  ${offenders.join("\n  ")}`);
});

// ── — A SECTION THE DRIVER BUILDS IS NOT A SECTION A SEAT IS ORDERED ABOUT ───────
//
// THE DEFECT THIS EXISTS FOR, measured rather than imagined. The refutation reviewer was ordered to
// "verify the '## Answers to your instructions' section answers EACH of these verbatim intake asks …
// A missing or evasive answer is a FLAGGED CORRECTION" — months after that section became code-built from
// a register the transport validates at the call. Every clause was true when written. NOBODY EDITED IT
// WRONG: a stage underneath it got better and the sentence went false where it stood. That is the class,
// and a sentence nobody has a reason to re-read is where it lives.
//
// ── WHY THIS IS NOT A PROSE GATE ───────────────────────────────────────────────────────────────────
//
// "Does this sentence ORDER the seat to author or verify the section" is a question about intent, and a
// regex answering it is the shape that scored 31 false positives out of 32 on the coverage-claim gate and
// fired on the real sentence too. So the rule is positional and declared instead: a composed dispatch may
// not NAME a code-built heading at all, unless the site is declared below with the anchored phrase that
// makes it legitimate. Judgement happens once, by a human, at the declaration — not per-run by a pattern.
//
// The headings come from `CODE_BUILT_SECTIONS`, which the builders in pipeline.mjs emit FROM. A section
// joins this check by the same act that makes it code-built, and a hand-kept second list cannot drift
// from it because there is no second list.
const CODE_BUILT_MENTIONS_DECLARED = [
  {
    heading: CODE_BUILT_SECTIONS.askAnswers,
    requires: "Do NOT author",
    why: "report-overview is TOLD the section is not its to write, which is the opposite of ordering it "
      + "and is the reason the shell stopped drifting from the register. The anchor is the prohibition "
      + "itself, so a later edit that turned this into an instruction would lose the phrase and go red.",
  },
  {
    heading: CODE_BUILT_SECTIONS.onlyYou,
    requires: "For each client-facing line",
    why: "the refutation reviewer is asked to READ the rendered section as delivered prose and flag a term "
      + "of art a lay client would misread. That is neither authoring it nor verifying a contract the seat "
      + "owns — the wording comes from the typed actions register upstream, so a plain-English defect in it "
      + "is real, fixable, and exactly what a reviewer is for. The anchor is the clause that makes it a "
      + "READ: an edit turning this into an order to write or check the section loses that phrase.",
  },
  {
    heading: CODE_BUILT_SECTIONS.onlyYou,
    requires: "item, under",
    why: "the delivery contract names the section as WHERE a typed action lands, not as something to "
      + "write: \"Only a client-only ask … is a `# Actions` item, under …\". The seat sends actions and the "
      + "driver groups them under that heading, so naming the destination is how a seat knows which of its "
      + "asks belong there at all.",
  },
  {
    heading: CODE_BUILT_SECTIONS.onlyYou,
    requires: "also taught",
    why: "a HISTORICAL note in the same file, recording that this document once taught a section the "
      + "stage's dispatch forbade and the driver overwrote — three documents, three answers, settled by "
      + "there being no field for it. Retiring the sentence would delete the record of the defect, which "
      + "is the opposite of what this check is for.",
  },
];

test("tracker issue 1893 — no dispatch names a section the driver code-builds, except where declared", () => {
  const headings = Object.values(CODE_BUILT_SECTIONS);
  assert.ok(headings.length >= 4,
    `only ${headings.length} code-built heading(s) — CODE_BUILT_SECTIONS is not being read, and a walk `
    + "over a short list is how this arm would report clean while covering nothing");

  const offenders = [];
  for (const stage of EVERY_STAGE) {
    const held = bareGrant(allowedToolsFor(toolGroupsForStage(stage)));
    for (const m of unionFor(stage, artifactsFor(stage, held))) {
      // ── THE ANCHOR IS ON THE SAME LINE, AND THAT IS THE WHOLE STRENGTH OF THE RULE ──────────────
      //
      // A skill file arrives here as ONE message, so an anchor matched anywhere in `m.text` would let a
      // phrase at the top of a 400-line document license every mention below it — an exemption that
      // licenses what it never read. Matching per LINE keeps the declaration pointing at the sentence a
      // human actually judged.
      for (const [i, line] of m.text.split(/\r?\n/).entries()) {
        for (const h of headings) {
          // The BARE heading, so `## X` and `### X` both count: the level a dispatch writes is not the
          // level the builder emits — the retired reviewer order named `##` where the builder writes `###`.
          const bare = h.replace(/^#+\s*/, "");
          if (!line.includes(bare)) continue;
          const ok = CODE_BUILT_MENTIONS_DECLARED.some((d) =>
            d.heading.replace(/^#+\s*/, "") === bare && line.includes(d.requires));
          if (!ok) offenders.push(`${stage} · ${m.surface}:${i + 1} · names "${bare}"`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    "a composed dispatch names a section the DRIVER writes. The seat cannot author it and cannot be held "
    + "to it, so an order about it spends attention on a failure the code made unrepresentable — and it "
    + "goes false without anybody editing it, which is why nobody notices.\n"
    + "  Retire the sentence, or — if the mention is legitimate, as a prohibition is — declare the site in "
    + "CODE_BUILT_MENTIONS_DECLARED with the anchored phrase that makes it so.\n"
    + `  ${offenders.join("\n  ")}`);
});

test("tracker issue 1893 — …and the arm can fail: a planted order naming a code-built section is caught", () => {
  // A GUARD WHOSE POPULATION IS CURRENTLY CLEAN PROVES NOTHING UNTIL IT IS DRIVEN. The plant is the exact
  // shape that was live for months: an instruction to VERIFY the section, in a message that carries no
  // prohibition, so the declared exception cannot rescue it.
  const headings = Object.values(CODE_BUILT_SECTIONS);
  const planted = `And verify the "## Answers to your instructions" section answers EACH intake ask.`;
  const caught = headings.filter((h) => {
    const bare = h.replace(/^#+\s*/, "");
    if (!planted.includes(bare)) return false;
    return !CODE_BUILT_MENTIONS_DECLARED.some((d) =>
      d.heading.replace(/^#+\s*/, "") === bare && planted.includes(d.requires));
  });
  assert.deepEqual(caught, [CODE_BUILT_SECTIONS.askAnswers],
    "the retired sentence, replayed, is not caught — the arm above would have passed over the defect it "
    + "was written for");

  // …and the DECLARED shape is not caught, so the rule discriminates rather than banning the word.
  const legitimate = `Do NOT author a "### Answers to your instructions" subsection — the driver code-builds it.`;
  const wrongly = headings.filter((h) => {
    const bare = h.replace(/^#+\s*/, "");
    if (!legitimate.includes(bare)) return false;
    return !CODE_BUILT_MENTIONS_DECLARED.some((d) =>
      d.heading.replace(/^#+\s*/, "") === bare && legitimate.includes(d.requires));
  });
  assert.deepEqual(wrongly, [],
    "a prohibition was flagged as an order. A rule that cannot tell them apart bans the sentence that "
    + "keeps the shell honest, and whoever hits it will delete the prohibition to get green.");
});

// ── — A PROVIDER CANNOT SERVE IT, AND THE ORDER SAYS SO ──────────────────────────
//
// Direction (c) reads "the dispatch names a tool the grant lacks" as a disagreement. That is right when
// the engine forgot and wrong when the active provider cannot serve it AND the dispatch says so in the
// same breath. On a clarivate deployment it made register-unit red on a configuration three layers agree
// about, with a message asserting a BEHAVIOURAL defect — so the honest response was to go hunting in the
// register lane and find nothing. Green in CI because CI runs corsearch, which withholds nothing.
//
// ✕ THE RULE EXCUSES THE ORDER, NEVER THE TOOL, and the difference is two real defects. Measured on a
// signa deployment, which withholds THREE register tools: one mention carries the carve-out and two do
// not. Excusing provider-unavailable TOOLS would have cleared the false alarm and silenced both true ones.
const CONDITIONAL_ORDER = "Run the provider phonetic capability on a token (`register_expand_phoneme` then\n"
  + "`register_enumerate`). **`register_expand_phoneme` is not offered by every provider** — where the\n"
  + "active provider's doc says the variant PREVIEW is unavailable, skip that call and run\n"
  + "`register_enumerate` `match_mode:phonetic` directly on the token.";
const CAPABILITY_ASSERTION = "Your register key also carries `register_record_fetch` and `register_image_fetch`.";
const findingsFor = (text, providerUnavailable) => agreementFindings({
  stage: "register-unit", granted: new Set(), artifacts: [],
  union: [{ surface: "skill:probe.md", kind: INSTRUCTION, phase: ATTEMPT_1, text }],
  toolUniverse: new Set(["register_expand_phoneme", "register_image_fetch"]),
  backlog: [], providerUnavailable: new Set(providerUnavailable),
}).filter((f) => f.direction === "ordered-but-not-granted").map((f) => f.tool).sort();

test("2019: an order that CARRIES the carve-out, for a tool the provider cannot serve, is not a finding", () => {
  assert.deepEqual(findingsFor(CONDITIONAL_ORDER, ["register_expand_phoneme"]), [],
    "the false alarm: the provider deliberately withholds the tool and the order says to skip it where "
    + "that is so — three layers agreeing, reported as a behavioural defect");
});

test("2019: the SAME tool, ordered WITHOUT a carve-out, is still a finding", () => {
  assert.deepEqual(findingsFor("Run `register_expand_phoneme` on the dominant token.", ["register_expand_phoneme"]), ["register_expand_phoneme"],
    "an unconditional order for a tool the provider cannot serve is exactly what direction (c) is for — "
    + "the rule must excuse the ORDER, never the tool");
});

test("2019: a capability ASSERTION about an unavailable tool is still a finding — the signa case", () => {
  // `unit.md:59` says the seat's key carries these. On signa that is false, and it is the true finding a
  // wholesale excuse would have silenced.
  assert.deepEqual(findingsFor(CAPABILITY_ASSERTION, ["register_image_fetch"]), ["register_image_fetch"],
    "a sentence asserting a capability the provider lacks is not a carve-out, and telling a seat it holds "
    + "a tool it does not hold is the defect this direction exists to catch");
});

test("2019: the carve-out must be in THIS order's own block, not three sections away", () => {
  const far = "Run `register_expand_phoneme` on the dominant token.\n\n"
    + "Unrelated section about something else entirely.\n\n"
    + "**`register_batch_screen` is not offered by every provider** — skip it where unavailable.";
  assert.deepEqual(findingsFor(far, ["register_expand_phoneme"]), ["register_expand_phoneme"],
    "a carve-out elsewhere in the document excused an unconditional order — a whole-document match would "
    + "excuse anything once one carve-out exists anywhere");
});

test("2019: the rule does NOT reach a tool the provider serves — only the ones it withholds", () => {
  assert.deepEqual(findingsFor(CONDITIONAL_ORDER, []), ["register_expand_phoneme"],
    "with an empty unavailable set the carve-out must NOT excuse anything: a tool the provider serves and "
    + "the grant lacks is an ordinary disagreement, and the carve-out phrasing is not a licence");
});

test("2019 ANTI-ROT: every marker still matches the live dispatch it was written for", () => {
  // The same arm WRITE_ORDER_MARKERS carries, for the same reason: these match declared PROSE, and prose
  // is edited. A marker that stops matching anything is a rule that silently stopped applying.
  const unit = readFileSync(join(DRIVER, "skills/prelim-register/unit.md"), "utf8");
  const live = PROVIDER_CONDITIONAL_MARKERS.filter((k) => k.re.test(unit));
  assert.ok(live.length >= 1,
    "no provider-conditional marker matches the register unit dispatch any more. Either the carve-out was "
    + "reworded — in which case this table needs the new phrasing — or it was deleted, in which case the "
    + "order is now unconditional and the finding it stopped producing was real:\n  "
    + PROVIDER_CONDITIONAL_MARKERS.map((k) => k.id).join("\n  "));
});
