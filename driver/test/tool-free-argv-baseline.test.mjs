// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PER-STAGE RETRIEVAL SURFACE OF ALL ELEVEN TOOL-FREE STAGES, PINNED BEFORE THE FIRST CONVERSION.
//
// O3 is a DIFFERENTIAL obligation: the retrieval surface of a converted stage must be byte-identical
// before and after. A differential needs a BEFORE, and **after the first conversion nobody can prove what
// the surface used to be** — the code that produced it is gone. This is that record, and the only moment
// it can be taken is now, while `RECORDING_STAGES` is still `{}`.
//
// ── WHY THIS IS NOT THE BASELINE ALREADY SHIPPED ──────────────────────────────────────────────
//
// `engine.gather.test.mjs`'s "A1/O3b BASELINE" asserts that `buildClaudeArgs`, called with no mcpConfig
// and no allowedTools, pushes neither flag. That pins the ARGV BUILDER. It is correct and it is not
// enough: it never names a stage, so it cannot answer "what was blind-frame's surface before?" — the
// question O3 is actually about. Between the map and the argv sits gateway.mjs's `const groups = toolGroupsForStage(name)` —
//
//     const groups = toolGroupsForStage(name);
//     if (groups.length) { … buildGatherMcpConfig(groups) … allowedToolsFor(groups) … }
//
// — an `if` two call sites from the map anyone would read, and the whole reason A1 says to assert on the
// argv. This walks each of the eleven stages THROUGH that resolution and records what the engine ends up
// being handed.
//
// ── WHAT A CONVERSION PR DOES WITH THIS ────────────────────────────────────────────────────────────
//
// A stage entering the recording category flips `groups.length` from 0 to non-zero, so it gains
// `--mcp-config`, `--strict-mcp-config` AND `--allowedTools` where it had none. That is O3b, and it is a
// deliberate strengthening. What must NOT change is any OTHER stage's row here. A conversion PR moves its
// own stage's expectation and leaves the other ten byte-identical, or it widened a surface it never
// mentioned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, TOOL_FREE_STAGES, RECORDING_STAGES, recordAxisFor, seatWritesForGroups, PER_CHUNK_STAGES, PER_AXIS_STAGES } from "../engine/mcp/gather-config.mjs";
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { readFileSync } from "node:fs";

// The gateway's own resolution (gateway.mjs:667-672), reproduced call for call. Not a paraphrase: if this
// drifts from the gateway the baseline stops describing the engine, so the drift test below pins it.
function surfaceFor(stage) {
  const groups = toolGroupsForStage(stage);
  let mcpConfig, allowedTools;
  if (groups.length) {
    const cfg = buildGatherMcpConfig(groups, { sessionKey: "k", agent: "a", runDir: "/RUN" });
    mcpConfig = cfg ? JSON.stringify(cfg) : undefined;
    allowedTools = allowedToolsFor(groups);
  }
  const { args } = buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN", mcpConfig, allowedTools });
  return {
    groups: groups.length,
    allowedTools: args.includes("--allowedTools"),
    mcpConfig: args.includes("--mcp-config"),
    strictMcpConfig: args.includes("--strict-mcp-config"),
  };
}

// THE RECORD. Every tool-free stage, today, at the argv. The eleven are READ from TOOL_FREE_STAGES, not
// recalled: the first draft of this table listed narrative-refutation, which is NOT tool-free, and the set-
// equality test below caught it. That is the test earning its place on its own author. `false/false/false` is the whole point: these
// stages are constrained by NOTHING — starvation here is the absence of retrieval servers, never a
// constraint on tools. blind-frame's row used to sit here saying "makes no tool call", which claimed more
// than anything enforced — it is now CONVERTED (see CONVERTED_BEFORE below), and the remaining rows'
// reason strings were rewritten to state what the driver enforces rather than what the dictation asks.
// skeptic's row followed it out in the second conversion, the same way: retired below, never deleted.
// — THE BASELINE IS EMPTY, AND EMPTY IS THE FINISHED STATE. The last three rows were the send
// stages, retired here by DELETION rather than by conversion: the delivery mode that was their only
// caller left the product, so there was no stage left to give a recording transport to. Their rows are
// NOT moved to CONVERTED_BEFORE — that table is the before-half of a differential, and a differential
// against a stage that no longer exists measures nothing. The eight conversions below are the record
// that survives.
//
// A NEW ROW HERE IS A FINDING, not maintenance: it means a stage was added that the driver passes no
// tool arguments at all, which is the state every one of the eight started in.
const BASELINE = Object.freeze({});

// THE BEFORE HALF OF THE DIFFERENTIAL. A converted stage's row is RETIRED from BASELINE, not deleted —
// this is what each measured as while tool-free, and a conversion's whole claim is a change against it.
// skeptic's row was measured on clean main (4508f126) before its conversion, same walk, same values.
const CONVERTED_BEFORE = Object.freeze({
  "blind-frame": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  "skeptic": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // frame-diff's row, RETIRED rather than deleted by the third conversion. Measured on the same walk as
  // the two above, and identical to them — every tool-free stage is passed no tool arguments at all, which
  // is the fact the differential below is a change against.
  "frame-diff": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // matter-frame, retired by conversion 2 — and the FIRST retirement that matters to the differential in
  // its own right. The three above were already measured at zero Bash or near it; this stage was measured
  // at 21 calls with a write, so its row is the record of what a genuinely tool-USING stage looked like
  // before it was constrained for the first time.
  "matter-frame": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // prelim-variants, retired by conversion 3 — measured on the same walk as the four above and identical
  // to them. Its differential is not the argv flags (every converted stage gains those) but what the
  // stage stopped being TRUSTED to do: it hand-wrote two artifacts a downstream parser then re-read, and
  // the row is the record of the surface it was passed while that was true.
  "prelim-variants": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // report-overview, retired by conversion 4. The row is UNCHANGED from the one that sat in BASELINE —
  // moved, never re-measured, because it is a historical fact about a stage that no longer exists in that
  // state. It is also the heaviest measured Bash user to convert so far (O3c: 61 calls, 8 writes / 17
  // attempts), so the differential below is the largest change in kind the category has recorded.
  "report-overview": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // knockout-assess, retired by the KNOCKOUT lane's first conversion ( item B). The row
  // is zeros like most of the table, and the zeros mean something different here: every other stage in
  // this table was a clearance-pipeline stage that COULD have been granted tools and was not. This one
  // sits on a separate lane that had no typed return path at all — `toolGroupsForStage` returned [] for
  // both its stages, and for the chunk label it returned [] even AFTER a row existed, until tracker issue
  // 2003 taught the resolver the lane's `#` separator.
  //
  // MEASURED PRE-CONVERSION, on main at de06260, through the same walk: `knockout-assess` and
  // `knockout-assess#0` both resolved to no groups, no allowedTools, no mcpConfig. Historical fact about
  // a stage that no longer exists in that state; not to be re-measured or edited to fit.
  "knockout-assess": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // knockout-frame, retired by the knockout lane's SECOND and last conversion ( item
  // C). Zeros again, and for the same reason as the row above: the lane had no typed return path at all
  // until item B, and this stage held none until item C. It is also the only row here whose BEFORE state
  // covered BOTH suffix forms as well as the bare name â a stage with no RECORDING row falls straight
  // through the separator block, so `#` and `:` resolved to nothing rather than throwing.
  //
  // MEASURED PRE-CONVERSION on main at 7d9b2fd, through this file's own `surfaceFor` on a detached
  // checkout: `knockout-frame`, `knockout-frame#0` and `knockout-frame:2` each gave
  // {groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false}. Historical fact about a
  // stage that no longer exists in that state; not to be re-measured or edited to fit.
  "knockout-frame": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // ✕ narrative-refutation, retired by conversion 9 — AND THE FIRST ROW IN THIS TABLE THAT IS NOT ZEROS.
  // Every stage converted before it was tool-free beforehand, which made "the BEFORE row is all-false"
  // look like a property of conversion. It was a property of the population: those stages had nothing to
  // lose at the argv because they were passed nothing. This one already held `perplexity` and `band` and
  // was already constrained by an allowlist, so its differential is not "gained flags" at all — the flags
  // were there. What changed is INSIDE the allowlist: `Write` and `Edit` left it. Measured on defa33c,
  // the tip before the conversion landed.
  "narrative-refutation": { groups: 2, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
  // synthesis, retired by conversion 10 — the SECOND non-zero row, and it settles
  // what the row above could only suggest. narrative-refutation being the first non-zero BEFORE row left
  // "the BEFORE row is all-false" looking like a rule with one exception; two exceptions is a population.
  // Same differential in kind as the reviewer's: the flags were already there (perplexity, band and
  // declination, already behind an allowlist), and what changed is INSIDE the allowlist — `Write` and
  // `Edit` left it, and one recording server key joined, so `groups` goes 3 -> 4. MEASURED on 44c7f5e,
  // the tip before the conversion landed, through this file's own surfaceFor walk — never inferred from
  // the group list.
  "synthesis": { groups: 3, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
  // report-card, retired by conversion 5. UNCHANGED from the row that sat in BASELINE — moved, never
  // re-measured. The heaviest Bash user in the whole corpus (O3c: 91 calls, 64 writes / 224 attempts),
  // and the first stage to convert whose measured writes were the artifacts themselves, 26 a run.
  "report-card": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // doubt-closure, retired by conversion 6 — the LAST of the eight, and the row is UNCHANGED from the one
  // that sat in BASELINE: moved, never re-measured, because it is a historical fact about a stage that no
  // longer exists in that state. Its BASELINE reason string said in as many words "which is why it does
  // not convert", resting on O3c's 72 Bash calls / 9 writes across 16 attempts. That was a description of
  // a measurement, not a ruling, and the measurement resolves the other way once you ask what the calls
  // REACH: re-measured at 113 calls / 19 attempts, every one of them inside the three citable files the
  // seeded `Read` grant serves whole, plus 11 housekeeping calls and one attempt's 13-line scratch script
  // that opened those same three files. Nothing it demonstrably used reached outside them.
  "doubt-closure": { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
  // register-digest, retired by conversion 11 — the THIRD non-zero row, and the first whose BEFORE state
  // already carried TWO groups of different kinds: `band` (retrieval) and `coverage` (a typed transport
  // on its own key). Same differential in kind as the two rows above — the flags were already there, and
  // what changed is INSIDE the allowlist: `Write` and `Edit` left it and one recording key joined, so
  // `groups` goes 2 -> 3. MEASURED off origin/main's own grant pin at the tip before the conversion
  // landed (recording-grant-preservation.test.mjs recorded `groups: ["band", "coverage"]` with an
  // allowlist and a config), never inferred from the current group list — which would read the AFTER
  // state and call it the before.
  "register-digest": { groups: 2, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
});

test("the baseline names EVERY tool-free stage and no others — the list cannot drift out from under it", () => {
  // A baseline covering ten of eleven stages would pass every assertion below while the eleventh
  // converted unrecorded. Set equality, both directions.
  assert.deepEqual(Object.keys(BASELINE).sort(), Object.keys(TOOL_FREE_STAGES).sort(),
    "TOOL_FREE_STAGES and this baseline must name the same stages; a stage added or removed needs its row recorded or retired deliberately");
});

test("every tool-free stage's argv surface matches the pinned baseline, stage by stage", () => {
  const measured = {};
  for (const stage of Object.keys(TOOL_FREE_STAGES)) measured[stage] = surfaceFor(stage);
  assert.deepEqual(measured, { ...BASELINE },
    "a tool-free stage's retrieval surface moved. If this is a conversion, move ONLY that stage's row and say so in the PR; if it is not, a surface widened without anyone naming it");
});

test("the walk is reading a real argv — the same resolution with groups produces the flags", () => {
  // Without this, all twelve rows above are satisfied by a buildClaudeArgs that pushes nothing ever, and
  // the baseline would record an artefact of a broken walk as the engine's behaviour.
  const { args } = buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN",
    mcpConfig: "{}", allowedTools: "Read Write" });
  assert.ok(args.includes("--allowedTools"), "the argv builder does not push an allowlist it was given — this test reads nothing");
  assert.ok(args.includes("--strict-mcp-config"), "…nor the strict flag that rides with a config");
  assert.ok(args.includes("--mcp-config"));
});

test("the category holds EXACTLY the stages whose rows were retired — pinned by name, both directions", () => {
  // INVERTED, never deleted. This asserted `RECORDING_STAGES` was empty; blind-frame's conversion made
  // that false, and deleting the check would have retired the only thing tracking which BASELINE rows
  // stopped describing current state. Now it pins the membership by name in both directions, so a second
  // conversion that forgets to retire its row goes red, and so does a retired row for a stage that never
  // converted.
  assert.deepEqual(Object.keys(RECORDING_STAGES).sort(), Object.keys(CONVERTED_BEFORE).sort(),
    "the recording category and the retired-row table disagree; every converted stage keeps its BEFORE row here and no others");
  assert.deepEqual(Object.keys(BASELINE).filter((s) => s in RECORDING_STAGES), [],
    "a converted stage is still in BASELINE — its row describes what it WAS, and belongs in CONVERTED_BEFORE");
});

test("⭐ THE ARGV DIFFERENTIAL — blind-frame gained all three flags, and gained NO retrieval server", () => {
  // The category's founding comment demands exactly this: "it must be asserted at the argv level, not
  // inferred from this map." Before and after, measured through the same walk, on the same stage.
  const before = CONVERTED_BEFORE["blind-frame"];
  const after = surfaceFor("blind-frame");

  assert.deepEqual(before, { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
    "the BEFORE record moved; it is a historical measurement and must not be edited to fit");
  assert.deepEqual(after, { groups: 1, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
    "blind-frame's argv surface is not what the conversion claims");

  // THE CHANGE IN KIND, stated as the flip it is: a stage that was constrained by NOTHING is now
  // constrained. That is what removes ambient Bash, and it is the whole safety question O3c answered.
  assert.equal(before.allowedTools, false);
  assert.equal(after.allowedTools, true);

  // AND NO RETRIEVAL SERVER — the one promise this category can actually prove. The grant is the stage's
  // own record tool and the seeded stage I/O, and nothing else; no bridge, no register, no perplexity.
  const granted = allowedToolsFor(toolGroupsForStage("blind-frame")).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.startsWith("mcp__")), ["mcp__recording-blind-frame__record_blind_frame"],
    "blind-frame holds an mcp tool that is not its own record tool — the retrieval surface widened, which is the one thing this category promised not to do");
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")), [], "…and no wildcard bridge grant");

  // THE NAME ROUND-TRIPS TO THE CONSUMER. contract-dictation-registry.mjs:67 parses grant tokens with
  // /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/ — the KEY takes hyphens and not underscores, the TOOL the reverse.
  // A key legal where it is declared and unparseable where it is read grants nothing while reading as
  // granted, so this asserts the LITERAL argv token against the regex that consumes it.
  assert.match(granted.find((t) => t.startsWith("mcp__")), /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/,
    "the resolved grant token does not parse in the registry that reads it — it would read as no grant at all");
});

test("⭐ THE ARGV DIFFERENTIAL — skeptic gained all three flags, and gained NO retrieval server", () => {
  // Same walk, same shape as blind-frame's differential above — per stage and with its own literals,
  // because a generalised loop that derived the expected token from the key under test would be the
  // declaration checking itself. The BEFORE row was measured on clean main before the conversion.
  const before = CONVERTED_BEFORE["skeptic"];
  const after = surfaceFor("skeptic");

  assert.deepEqual(before, { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
    "the BEFORE record moved; it is a historical measurement and must not be edited to fit");
  assert.deepEqual(after, { groups: 1, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
    "skeptic's argv surface is not what the conversion claims");

  // THE CHANGE IN KIND: constrained by NOTHING, now constrained. This is what removes ambient Bash —
  // and unlike blind-frame's, skeptic's removal has a measured COST: O3c saw 7 Bash READS across 11
  // attempts (grep/sed). Those now go through the seeded `Read` grant or surface as visible refusals.
  assert.equal(before.allowedTools, false);
  assert.equal(after.allowedTools, true);

  // AND NO RETRIEVAL SERVER — the one promise this category can actually prove. The grant is the
  // stage's own record tool, the SANCTIONED READ SURFACE, and the seeded stage I/O — nothing else; no
  // bridge, no register, no perplexity — and NOT blind-frame's record tool either (Shape 2: a
  // sibling's tool is never granted).
  //
  // search_run_artifacts is 's ratification-hold unlock, path 1: O3c measured skeptic's only Bash
  // use as READS (7 calls, 0 writes / 11 attempts — literal-token greps over the run's own
  // register-findings.md / common-law-findings.md, plus two section reads of its served skill doc, which
  // the seeded Read grant covers). The tool replaces the artifact half of those reads with a scoped,
  // read-only, run-dir-bounded literal search — a READ over the run's own tree, not retrieval: it dials
  // nothing and reaches nothing outside CLEAROTRON_BAND_RUN_DIR.
  const granted = allowedToolsFor(toolGroupsForStage("skeptic")).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.startsWith("mcp__")).sort(), [
    "mcp__recording-skeptic__record_skeptic",
    "mcp__recording-skeptic__search_run_artifacts",
  ], "skeptic holds an mcp tool outside its pinned pair (record + sanctioned read) — either the retrieval surface widened or a sibling's tool leaked in; both are the disease this category exists to prevent");
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")), [], "…and no wildcard bridge grant");

  // THE NAMES ROUND-TRIP TO THE CONSUMER — same regex, same reason as blind-frame's: a key legal where
  // it is declared and unparseable where it is read grants nothing while reading as granted. EVERY
  // token, not the first found: the read tool is exactly the one a first-found check would skip.
  for (const token of granted.filter((t) => t.startsWith("mcp__"))) {
    assert.match(token, /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/,
      `${token} does not parse in the registry that reads it — it would read as no grant at all`);
  }
});

test("⭐ THE ARGV DIFFERENTIAL — report-overview gained all three flags, and gained NO retrieval server", () => {
  // Conversion 4, and the biggest change in kind the category has recorded: O3c measured this stage at
  // 61 Bash calls with 8 WRITES across 17 attempts — an order of magnitude past blind-frame's zero. Its
  // own literals, like every differential here; a loop deriving the expected token from the key under
  // test would be the declaration checking itself.
  const before = CONVERTED_BEFORE["report-overview"];
  const after = surfaceFor("report-overview");

  assert.deepEqual(before, { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
    "the BEFORE record moved; it is a historical measurement and must not be edited to fit");
  assert.deepEqual(after, { groups: 1, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
    "report-overview's argv surface is not what the conversion claims");

  // THE CHANGE IN KIND: constrained by NOTHING, now constrained. A shell seat that reaches for `wc -m`
  // on attempt 18 gets a refusal it can SEE — those checks are the record tool's now, on every call.
  assert.equal(before.allowedTools, false);
  assert.equal(after.allowedTools, true);

  // AND NO RETRIEVAL SERVER. This stage's declared reads are the two files its dispatch names, so
  // it gets no search tool either — the grant is its record tool and the seeded stage I/O, nothing else.
  const granted = allowedToolsFor(toolGroupsForStage("report-overview")).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.startsWith("mcp__")), ["mcp__recording-report-overview__record_report_overview"],
    "report-overview holds an mcp tool that is not its own record tool — the retrieval surface widened, which is the one thing this category promised not to do");
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")), [], "…and no wildcard bridge grant");

  // The literal argv token against the regex that consumes it (contract-dictation-registry.mjs:67) — a
  // key legal where it is declared and unparseable where it is read grants nothing while reading granted.
  assert.match(granted.find((t) => t.startsWith("mcp__")), /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/,
    "the resolved grant token does not parse in the registry that reads it — it would read as no grant at all");
});

test("⭐ THE ARGV DIFFERENTIAL — report-card gained all three flags, on the DISPATCHED name, and gained NO retrieval server", () => {
  // Conversion 5, and the heaviest Bash user in the corpus: O3c measured 91 calls with 64 WRITES across
  // 224 attempts. Its own literals, like every differential here.
  const before = CONVERTED_BEFORE["report-card"];
  const after = surfaceFor("report-card");

  assert.deepEqual(before, { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
    "the BEFORE record moved; it is a historical measurement and must not be edited to fit");
  assert.deepEqual(after, { groups: 1, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
    "report-card's argv surface is not what the conversion claims");
  assert.equal(before.allowedTools, false);
  assert.equal(after.allowedTools, true);

  // AND UNDER THE NAME IT IS ACTUALLY DISPATCHED BY. This is the obstacle conversion 5 existed to solve:
  // `stageOnce` builds `label = name + ":" + axis` and hands THAT to the gateway, and the recording
  // lookup is an exact Map.get. A differential measured only on the bare name would have passed while
  // every real card turn resolved to no grant at all — measured before the fix, on a stage that HAD one:
  // `report-overview` returned its group and `report-overview:2` returned [].
  assert.deepEqual(surfaceFor("report-card:1"), after, "the dispatched (axis-suffixed) name does not resolve to the same surface as the bare one");
  assert.deepEqual(surfaceFor("report-card:26"), after, "…and it is not the ordinal that decides it");

  const granted = allowedToolsFor(toolGroupsForStage("report-card:7")).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.startsWith("mcp__")), ["mcp__recording-report-card__record_report_card"],
    "report-card holds an mcp tool that is not its own record tool — the retrieval surface widened, which is the one thing this category promised not to do");
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")), [], "…and no wildcard bridge grant");
  assert.match(granted.find((t) => t.startsWith("mcp__")), /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/,
    "the resolved grant token does not parse in the registry that reads it — it would read as no grant at all");
});

test("a fan-out recording stage that does NOT declare perAxis THROWS rather than granting nothing", () => {
  // The hardening that closes this door permanently. `report-overview` is a recording stage WITHOUT
  // `perAxis`, so an axis-suffixed lookup on it is a contradiction: either the stage started fanning out
  // without declaring it, or something built a label it should not have. Both silent defaults pick a
  // side — returning [] grants nothing while the dictation orders a call, which is exactly the failure
  // conversion 5 had to discover by measurement. So it refuses.
  assert.throws(() => toolGroupsForStage("report-overview:2"), /does NOT declare/,
    "an undeclared fan-out resolved silently — the next conversion would find out in production");
  // …and the declared one does not throw, so the guard is not simply refusing every suffix.
  assert.deepEqual(toolGroupsForStage("report-card:2"), ["recording-report-card"]);
});

// ── — THE SECOND SUFFIX FORM, AND THE ONE THAT HAD NO BRANCH AT ALL ─────────────
//
// The knockout lane dispatches chunks as `<stage>#<n>` (`pipeline-knockout.mjs`: label =
// `${name}#${chunkNo}`). Until this landed, `#` appeared NOWHERE in gather-config, so a `#`-suffixed
// label missed the exact lookup, never reached the colon branch, and fell through to `[]` — the same
// silently-absent grant the colon branch exists to prevent, one separator over. It had never fired
// because no knockout stage carries a RECORDING row yet: the trap was waiting exactly where the next
// conversion lands.
test("2003: a '#'-fanned recording stage that does NOT declare perChunk THROWS rather than granting nothing", () => {
  assert.throws(() => toolGroupsForStage("report-overview#2"), /does NOT declare/,
    "a '#'-suffixed label on a recording row resolved silently — the knockout conversion would find out in production");
  assert.throws(() => toolGroupsForStage("report-overview#2"), /perChunk/,
    "…and the refusal names the flag the row must declare, not the one the other separator wants");
  // assert.throws returns undefined — capture the error to read it.
  let err; try { toolGroupsForStage("report-overview#2"); } catch (e) { err = e; }
  assert.match(err.message, /RECORDING row for "report-overview"/, "…and it names the ROW to edit");
});

test("2003: the ':' form is unchanged — generalizing the block did not move the separator that already worked", () => {
  assert.deepEqual(toolGroupsForStage("report-card:2"), ["recording-report-card"], "declared perAxis still resolves");
  assert.throws(() => toolGroupsForStage("report-overview:2"), /perAxis/, "undeclared perAxis still throws, and still names perAxis");
  assert.deepEqual(toolGroupsForStage("report-overview"), ["recording-report-overview"], "the bare name is untouched");
});

test("2003: a stage with NO recording row is unaffected by either separator", () => {
  // ── DERIVED FROM THE TABLES, NOT NAMED ──────────────────────────────────────────
  //
  // knockout-frame was this arm's example and knockout-assess was its example before that. Both have now
  // converted ( items B and C), and an arm whose one named example keeps converting is
  // an arm that goes stale silently: this arm asserted the PRE-conversion state all the way through item
  // C's branch and never went red there, because a draft PR runs nothing.
  //
  // So the population is derived from the same tables the assertion is about — every stage on either lane
  // with no RECORDING row. The next conversion moves a stage out of it without anyone editing this arm,
  // and the arm keeps proving the same property about whatever is left.
  const rec = new Set(Object.keys(RECORDING_STAGES));
  const rowless = [...Object.keys(STAGES), ...Object.keys(KO_STAGES)].filter((s) => !rec.has(s));
  assert.ok(rowless.length > 0,
    "every stage on both lanes now holds a RECORDING row, so this arm proves nothing: the separator "
    + "block's fall-through has no member left to exercise. That is not a pass — retire this arm with the "
    + "branch it tests, or re-point it at a lane that still has one");

  for (const stage of rowless) {
    // The bare name is the control: a stage with no row must resolve the SAME way with a suffix as
    // without one. Asserting `[]` would only hold for a rowless stage that also holds no retrieval
    // group, which knockout-frame was and none of the survivors is.
    const bare = toolGroupsForStage(stage);
    assert.deepEqual(toolGroupsForStage(`${stage}#0`), bare,
      `${stage} has no RECORDING row and the '#' suffix moved its resolution — a rowless stage must fall `
      + "through the separator block untouched: no throw, no grant it did not already hold");
    assert.deepEqual(toolGroupsForStage(`${stage}:2`), bare,
      `${stage} has no RECORDING row and the ':' suffix moved its resolution`);
  }

  assert.deepEqual(toolGroupsForStage("synthesis#2"),
    ["perplexity", "band", "declination", "recording-synthesis"],
    "a stage resolved by its own explicit branch still short-circuits before the suffix block");
});

// ── item B — THE POSITIVE BRANCH NOW HAS A MEMBER ────────────────────────────────
//
// 2003 shipped with an arm asserting that NO row declared `perChunk`, because its positive path could not
// be exercised: the branch existed and nothing used it. That arm said, in as many words, that the PR
// adding the first row owns proving the positive case and deletes it. This is that replacement, written
// in the same PR that made it fail — which is what the handover was for.
test("1997B: the declared chunked row resolves its grant AND binds its ordinal, under the dispatched label", () => {
  // The label the knockout lane actually dispatches, not the bare stage name.
  assert.deepEqual(toolGroupsForStage("knockout-assess#0"), ["recording-knockout-assess"],
    "the chunk label resolves the grant — before 2003 this was [] and the seat held nothing");
  assert.deepEqual(toolGroupsForStage("knockout-assess#3"), ["recording-knockout-assess"],
    "…and it is not the ordinal that decides it");

  // THE BOUND ORDINAL IS THE DRIVER'S. Without this the acceptor cannot know which chunk it is writing,
  // and the only alternative — deriving identity from the payload's marks — would collapse the membership
  // guard into the decision it guards.
  assert.deepEqual(recordAxisFor("knockout-assess#0"), { stage: "knockout-assess", axis: "0" });
  assert.deepEqual(recordAxisFor("knockout-assess#3"), { stage: "knockout-assess", axis: "3" });
  assert.equal(recordAxisFor("knockout-assess"), null, "an unsuffixed label binds nothing");

  assert.ok(PER_CHUNK_STAGES.includes("knockout-assess"), "the population is DERIVED from the declaration");
  assert.equal(PER_AXIS_STAGES.includes("knockout-assess"), false,
    "declaring one fan-out form must not confer the other — a chunked stage is not an axis stage");

  // The grant carries the record tool and takes the hand-write tool away: the chunk file is the driver's.
  const granted = allowedToolsFor(toolGroupsForStage("knockout-assess#0")).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.startsWith("mcp__")),
    ["mcp__recording-knockout-assess__record_knockout_assess"], "one record tool, no widened retrieval surface");
  assert.equal(seatWritesForGroups(toolGroupsForStage("knockout-assess#0")), false,
    "seatWrites false — a grant that kept the writer would leave the old hand-written path executable");
});

// ── item C — THE UNFANNED RECORDING STAGE ───────────────────────────────────────
//
// The lane's second and last conversion, and the first recording stage that is not fanned AT ALL: no `:`
// axis, no `#` chunk. Every converted stage before it either resolved a suffix or was not a recording
// stage, so "an undeclared suffix throws" had only ever been proven against stages that declare the OTHER
// form. This stage declares neither, which makes it the first member of that case.
//
// Its BEFORE state is the CONVERTED_BEFORE row above: bare and both suffixes resolved to nothing at all.
// This is the AFTER, asserted in the PR that caused it — the same obligation item B's arm above was
// written to discharge.
test("1997C: the unfanned recording row resolves bare, and REFUSES both fan-out separators", () => {
  assert.deepEqual(toolGroupsForStage("knockout-frame"), ["recording-knockout-frame"],
    "the bare name resolves its grant — before this conversion it was [] and the seat held nothing");

  // ✕ NOT `[]`. A stage that HAS a row and is dispatched with a separator it never declared is a seat
  // resolving to no grant while its dictation orders a record call — the silent failure the 2003 block
  // exists to convert into a refusal. It must throw, and the message must name the ROW to edit.
  assert.throws(() => toolGroupsForStage("knockout-frame#0"), /RECORDING row for "knockout-frame"/,
    "the '#' form must refuse and name the row, not resolve to nothing");
  assert.throws(() => toolGroupsForStage("knockout-frame:2"), /RECORDING row for "knockout-frame"/,
    "…and the ':' form the same way");
  assert.throws(() => toolGroupsForStage("knockout-frame#0"), /perChunk/, "…the '#' refusal names perChunk");
  assert.throws(() => toolGroupsForStage("knockout-frame:2"), /perAxis/, "…and the ':' refusal names perAxis");

  // Neither fan-out population claims it, both directions. Declaring nothing must confer nothing.
  assert.equal(PER_CHUNK_STAGES.includes("knockout-frame"), false, "an unfanned stage is not a chunked stage");
  assert.equal(PER_AXIS_STAGES.includes("knockout-frame"), false, "…nor an axis stage");
  assert.equal(recordAxisFor("knockout-frame"), null, "an unfanned label binds no ordinal");

  // The grant is the record tool alone, and the hand-write tool is gone: both artifacts are the driver's.
  const granted = allowedToolsFor(toolGroupsForStage("knockout-frame")).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.startsWith("mcp__")),
    ["mcp__recording-knockout-frame__record_knockout_frame"], "one record tool, no widened retrieval surface");
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")), [], "…and no wildcard bridge grant");
  assert.equal(seatWritesForGroups(toolGroupsForStage("knockout-frame")), false,
    "seatWrites false — a grant that kept the writer would leave the old hand-written path executable, "
    + "which is the whole failure this conversion removes");
});

test("the resolution above still matches the gateway's — a paraphrase that drifts stops describing the engine", () => {
  // surfaceFor() reproduces gateway.mjs's `if (groups.length)` by hand, because the gateway's copy is
  // inside a 200-line function that cannot be called from here. That makes it a DUPLICATE, and a
  // duplicate is only as good as this check: the gateway must still gate on groups.length and still feed
  // buildGatherMcpConfig + allowedToolsFor.
  const src = readFileSync(new URL("../gateway.mjs", import.meta.url), "utf8");
  assert.match(src, /const groups = toolGroupsForStage\(name\);/, "the gateway no longer resolves groups by stage name this way");
  assert.match(src, /if \(groups\.length\) \{/, "the gateway no longer gates the whole grant on groups.length — the baseline's premise moved");
  assert.match(src, /gatherAllowedTools = allowedToolsFor\(groups\)/, "the gateway no longer derives the allowlist from the groups");
});

test("⭐ THE ARGV DIFFERENTIAL — doubt-closure gained all three flags and NO retrieval server, and the mechanical scope is now empty", () => {
  // Conversion 6, the last of the eight the sanctioned-equivalents design rules. Its own literals, like
  // every differential here.
  const before = CONVERTED_BEFORE["doubt-closure"];
  const after = surfaceFor("doubt-closure");

  assert.deepEqual(before, { groups: 0, allowedTools: false, mcpConfig: false, strictMcpConfig: false },
    "the BEFORE record moved; it is a historical measurement and must not be edited to fit");
  assert.deepEqual(after, { groups: 1, allowedTools: true, mcpConfig: true, strictMcpConfig: true },
    "doubt-closure's argv surface is not what the conversion claims");
  assert.equal(before.allowedTools, false);
  assert.equal(after.allowedTools, true);

  // THE POINT OF THIS STAGE'S CONVERSION, and it is not the flags. Its BASELINE row said the stage "does
  // not convert" because ambient Bash was reachable and heavily used. It is the allowlist that makes that
  // sentence false, so assert the allowlist rather than the intention: exactly `Read` plus its record
  // tool, and NO search surface — its reads are three enumerated files, which is frame-diff's case and
  // not matter-frame's. A `search_run_artifacts` here would be handing a search tool to a stage whose
  // reads can be listed, which the design forbids in as many words.
  const granted = allowedToolsFor(toolGroupsForStage("doubt-closure")).split(/[\s,]+/).filter(Boolean);
  assert.ok(granted.includes("Read"), "the seeded Read grant is what replaces the ambient Bash reads");
  assert.ok(granted.includes("mcp__recording-doubt-closure__record_doubt_closure"), "its record tool must be granted under its own key");
  assert.ok(!granted.some((t) => t.includes("search_run_artifacts")), "no search tool: this stage's reads are enumerable");
  assert.ok(!granted.includes("Write") && !granted.includes("Edit"),
    "seatWrites:false — the hand-write path must not be left executable beside the transport that replaced it");

  // AND THE SCOPE IS CLOSED — completely, since. Eight of eleven were converted; the three that
  // remained were the send stages, and they left with the delivery mode that was their only caller
  // rather than being converted. So the population is EMPTY, and empty is the finished state: a row
  // appearing here again means a NEW stage was added that the driver passes no tool arguments at all.
  assert.deepEqual(Object.keys(BASELINE).sort(), [],
    "the tool-free baseline should be empty — every stage that still exists either mounts a retrieval "
    + "server or holds a recording transport. A row here is a new instance of the class, not a leftover.");
});
