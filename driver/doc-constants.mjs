// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doc-constants.mjs — the shipping docs that RESTATE a code constant, bound to the constant they quote.
//
// WHY. A number a doc spells out has no link to the declaration it came from, so it survives the change
// that moved it and goes on reading as current. existed because a one-instance fix (PR) missed
// a second occurrence of the same figure in the same file; this is the structural form of that lesson.
// The drift is already real in this tree — see THE DRIFT THIS DOES NOT COVER, below.
//
// THE SHAPE is `FIELD_CONSUMERS` in profiles.mjs: a manifest naming a code symbol and a file, and a
// grep test in driver/test that fails CI when the two disagree. What is different here, and is the whole
// point, is that FIELD_CONSUMERS asserts PRESENCE only (`src.includes(symbol)`). A guard that only
// grepped for a number would be satisfied by a doc that stopped mentioning it — the sentence gets
// reflowed, the figure falls out, and the guard reports a pass on a doc that now says nothing. So every
// row is checked TWICE, with two different failures:
//
//   1. the restatement is PRESENT   — the pattern matches at all
//   2. the restatement is CORRECT   — its capture equals the value derived from code
//
// NECESSARY, NOT SUFFICIENT — the same posture as FIELD_CONSUMERS. This proves a doc quotes today's
// figure. It does not prove the sentence around the figure is true, and no grep could.
//
// EVERY VALUE BELOW IS DERIVED, NEVER TYPED. A hardcoded "eight" beside the constant would be a third
// copy of the number and would drift with the other two. That is why the words are spelled from the
// integer and the timings are computed by calling the model rather than restated from it.
//
// ── WHAT IS IN SCOPE ────────────────────────────────────────────────────────────────────────────────
//
// SHIPPING docs: the ones a reader is meant to act on today — the root README/INSTALL, docs/*.md, the
// architecture pack, the dispatched MCP skill packs.
//
// NOT the working design notes. Those are DATED RECORDS — they open by naming the day they were read
// off the engine — and several were the SPEC a constant was built from rather than a description of it.
// Binding one would turn CI red on a historical document at every future re-fit of a weight, and the
// only way to green it would be to rewrite the record. They drift by design; that is what a snapshot is.
// They are also withheld from the public tree, so a row pointing at one would cite a path half this
// file's readers cannot open.
//
// THE RULE THAT FALLS OUT, for whoever adds a row: bind a number only where the document is meant to be
// TRUE TODAY. A record of what was decided is not that, and a guard that cannot tell the two apart gets
// silenced rather than fixed.
//
// So the design notes are NOT covered here, and two of them HAVE drifted — measured 2026-08-17 while
// building this, reported on with the specifics, and deliberately not catalogued in this file: a
// list of today's stale figures would itself go stale, which is the exact defect this file exists to
// stop. The shape, for a reader without the documents: BOTH still quote a per-search name cap of twenty
// against the eight below, one of them attributing it to a `maxMarks` field that is no longer live —
// search-policy.test.mjs asserts the resolved policy carries no such key, and two further suites assert
// it can never reach a client surface, so what survives in the tree is its retirement notes, those
// guards and two inert test fixtures. The second also restates the whole effort formula — divisor,
// per-call weight, register base and per-class term — from a fit that has since been renormalised. Its
// TURNAROUND half is still exact, which is why the timings asked for could be bound through README
// and INSTALL instead of through it.

import { maxNamesFor } from "./products.mjs";
import { MAX_JURISDICTIONS } from "./enqueue-schema.mjs";
import { STAGES } from "./stages.mjs";
import { quoteBoundsFor } from "./effort-model.mjs";
// Both of these are OUTSIDE driver/, and that is the point: the two figures and are about
// live in `bin/` and in a provider, and a manifest that could only reach driver/ would have had nothing
// to bind them to. Neither import has a load-time side effect — `bin/start.mjs` guards its bootstrap
// behind `isMain` (driver/test/start-command.test.mjs already imports it), and `index-store.js` pulls
// only `node:sqlite`.
import { resolvePorts } from "../bin/start.mjs";
import { FRESHNESS_HOURS } from "../providers/uspto-local/src/index-store.js";

// ── deriving each figure in the spelling its doc uses ────────────────────────────────────────────────

const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

/** The prose docs write "eight names", not "8 names". Spelled FROM the constant so it cannot drift off it. */
export function spell(n) {
  const w = WORDS[n];
  if (!w) throw new Error(`doc-constants: no word for ${n} — extend WORDS, do not type the word into a row`);
  return w;
}

const stageTimeouts = Object.values(STAGES).map((s) => Number(s?.timeoutSec) || 0);

/** Levers as effort-model.mjs wants them. Since there is no clearance "ceiling" to model: the
 *  lane adders were refuted by the delivered walls and every clearance quotes ONE ruled range, so the
 *  bounds come from the clearance row itself rather than from a maximally-levered example. */
const KNOCKOUT_LEVERS = { pipeline: "knockout", caseLaw: false, nativeLanguage: false, territories: [] };
const CLEARANCE_LEVERS = { pipeline: "clearance", caseLaw: false, nativeLanguage: false, territories: [] };

const asMinutes = (hours) => String(Math.round(hours * 60));
/** `String` gives 1.5 → "1.5" and 3 → "3", which is exactly how the docs write them. */
const asHours = (hours) => String(hours);

/**
 * Every quantity a bound doc quotes, computed from its declaration. Exported so the test's failure
 * message and this table read the same number, and so a reader can print them.
 */
export const DERIVED = {
  knockoutMaxNames: spell(maxNamesFor("knockout-search")),
  maxJurisdictions: String(MAX_JURISDICTIONS),
  stageCount: String(Object.keys(STAGES).length),
  longestStageMinutes: asMinutes(Math.max(...stageTimeouts) / 3600),
  stageTimeoutSumHours: (stageTimeouts.reduce((a, b) => a + b, 0) / 3600).toFixed(1),
  // — BOTH ends, for the reason the clearance rows below already give: a doc
  // quoting one end of a range lets the other move silently. This was a single scalar taken from
  // `highHours`, so a 5-10 quote would have left both docs asserting "10 minutes" as the whole quote.
  knockoutLowMinutes: asMinutes(quoteBoundsFor(KNOCKOUT_LEVERS).lowHours),
  knockoutHighMinutes: asMinutes(quoteBoundsFor(KNOCKOUT_LEVERS).highHours),
  clearanceLowHours: asHours(quoteBoundsFor(CLEARANCE_LEVERS).lowHours),
  clearanceHighHours: asHours(quoteBoundsFor(CLEARANCE_LEVERS).highHours),
  // — the engine door's default, read through the resolver rather than off the literal, so a
  // change to how the default is chosen (not merely to the number) also has to come past this.
  mcpPort: String(resolvePorts({}).mcp),
  // — the two clocks a stale index refuses on. `dataLagDays` is DERIVED from the hours, because
  // INSTALL.md explains the 96 by spelling out the four days it is made of, and a typed "four" beside
  // a computed 96 is the third copy this whole file exists to prevent.
  syncLagHours: String(FRESHNESS_HOURS.sync),
  dataLagHours: String(FRESHNESS_HOURS.data),
  dataLagDays: spell(FRESHNESS_HOURS.data / 24),
};

// ── the manifest ────────────────────────────────────────────────────────────────────────────────────
//
// `doc` is repo-root-relative. `pattern` must carry EXACTLY ONE capture group, around the figure and
// nothing else — the test asserts that, because a pattern with no group would compare `undefined` to
// the expected value and fail for the wrong reason on every run.
//
// Patterns key on the phrase immediately around the number, not on the whole sentence: an editor may
// rewrite the paragraph without tripping this, but deleting the figure fails arm 1 by design. When a
// legitimate rewording moves the phrase, the fix is to update the pattern here — which is the moment
// somebody re-reads the number, and the moment the guard is for.

export const DOC_CONSTANTS = [
  // ── knockout maxNames ─────────────────────────────────────────────────────────────────────────────
  {
    constant: "knockout maxNames",
    source: { file: "products.mjs", symbol: "SPECS knockout-search .maxNames (via maxNamesFor)" },
    expected: () => DERIVED.knockoutMaxNames,
    doc: "docs/DELIVERY.md",
    pattern: /knockout accepts up to (\w+) names/,
  },
  {
    constant: "MAX_JURISDICTIONS",
    source: { file: "enqueue-schema.mjs", symbol: "MAX_JURISDICTIONS" },
    expected: () => DERIVED.maxJurisdictions,
    doc: "docs/INTAKE.md",
    pattern: /deduped case-insensitively; max (\d+)/,
  },
  // A dispatched skill pack, not prose: an assistant reads this figure out to a requester, so a stale
  // one here is a wrong answer given to a client rather than a wrong line in a manual.
  {
    constant: "MAX_JURISDICTIONS",
    source: { file: "enqueue-schema.mjs", symbol: "MAX_JURISDICTIONS" },
    expected: () => DERIVED.maxJurisdictions,
    // — moved out of mcp-server/packs/ when the connector skills became a Claude Code plugin.
    // The binding follows the text, not the path: this guard is why the move could not silently drop a
    // figure the doc is bound to restate.
    doc: "skills/clearotron-ops/SKILL.md",
    pattern: /Names or codes both read; max (\d+)/,
  },

  // ── the STAGES count ──────────────────────────────────────────────────────────────────────────────
  {
    constant: "STAGES count",
    source: { file: "stages.mjs", symbol: "Object.keys(STAGES).length" },
    expected: () => DERIVED.stageCount,
    doc: "docs/architecture/04-configuration-reference.md",
    pattern: /All (\d+) stages, exactly as declared/,
  },
  // README wraps between the figure and the word after it, so this one has to match across the newline.
  {
    constant: "STAGES count",
    source: { file: "stages.mjs", symbol: "Object.keys(STAGES).length" },
    expected: () => DERIVED.stageCount,
    doc: "INSTALL.md",
    pattern: /and the (\d+)\s+together sum to/,
  },

  // ── the stage timeouts, in aggregate ──────────────────────────────────────────────────────────────
  {
    constant: "longest stage timeout",
    source: { file: "stages.mjs", symbol: "max timeoutSec" },
    expected: () => DERIVED.longestStageMinutes,
    doc: "INSTALL.md",
    pattern: /Every stage carries a timeout — the longest is (\d+) minutes/,
  },
  {
    constant: "longest stage timeout",
    source: { file: "stages.mjs", symbol: "max timeoutSec" },
    expected: () => DERIVED.longestStageMinutes,
    doc: "INSTALL.md",
    pattern: /the longest stage timeout is (\d+) minutes/,
  },
  {
    constant: "longest stage timeout",
    source: { file: "stages.mjs", symbol: "max timeoutSec" },
    expected: () => DERIVED.longestStageMinutes,
    doc: "INSTALL.md",
    pattern: /can legitimately run (\d+) minutes/,
  },
  {
    constant: "sum of stage timeouts",
    source: { file: "stages.mjs", symbol: "sum of timeoutSec, in hours to 1dp" },
    expected: () => DERIVED.stageTimeoutSumHours,
    doc: "INSTALL.md",
    pattern: /together sum to ([\d.]+) hours/,
  },

  // ── the effort model's timings ────────────────────────────────────────────────────────────────────
  // — FOUR rows, not two: each end of the range in each doc. A pattern carries
  // exactly one capture group by this file's own rule, so a range needs one row per end — the same shape
  // the clearance rows below use, and for the same reason.
  {
    constant: "TURNAROUND_QUOTE.knockout.lowHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.knockoutLowMinutes,
    doc: "INSTALL.md",
    pattern: /A knockout search is sized at (\d+) to \d+ minutes/,
  },
  {
    constant: "TURNAROUND_QUOTE.knockout.highHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.knockoutHighMinutes,
    doc: "INSTALL.md",
    pattern: /A knockout search is sized at \d+ to (\d+) minutes/,
  },
  {
    constant: "TURNAROUND_QUOTE.knockout.lowHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.knockoutLowMinutes,
    doc: "INSTALL.md",
    pattern: /sizes a knockout search at (\d+) to \d+ minutes/,
  },
  {
    constant: "TURNAROUND_QUOTE.knockout.highHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.knockoutHighMinutes,
    doc: "INSTALL.md",
    pattern: /sizes a knockout search at \d+ to (\d+) minutes/,
  },
  {
    constant: "TURNAROUND_QUOTE.clearance.lowHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.clearanceLowHours,
    doc: "INSTALL.md",
    pattern: /A clearance starts at ([\d.]+) hours/,
  },
  // BOTH ends of the ruled range are bound. A doc quoting only one of them would let the other move
  // silently, and the PAIR is the quote. There is no full-country row any more: every clearance
  // carries the same range, so a separate figure for one product would be exactly the second source of
  // the bounds the ruling asked to remove.
  {
    constant: "TURNAROUND_QUOTE.clearance.highHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.clearanceHighHours,
    doc: "INSTALL.md",
    pattern: /and runs to ([\d.]+) hours/,
  },
  {
    constant: "TURNAROUND_QUOTE.clearance.highHours",
    source: { file: "effort-model.mjs", symbol: "TURNAROUND_QUOTE" },
    expected: () => DERIVED.clearanceHighHours,
    doc: "INSTALL.md",
    pattern: /a clearance\s+at\s+up\s+to\s+([\d.]+)\s+hours/,
  },

  // ── the engine door's port ─────────────────────────────────────────────────────────────────
  //
  // was two ports, 18790 and 18791, and NEITHER was wrong — the code default is 18790 and the dev
  // example deliberately runs 18791 so a dev face and a real one can share a box. What was wrong was
  // that nothing said so, so a code comment picked the dev port to illustrate the variable with and
  // 18791 started reading as "the port". These rows bind the copies that are meant to be the DEFAULT.
  //
  // the developer env example is deliberately NOT bound. Its ports are an intentional offset, now stated in
  // the file itself; binding it would demand it equal a number it is supposed to differ from.
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "INSTALL.md",
    pattern: /# TRADEMARK_MCP_HTTP_PORT=(\d+)/,
  },
  // ── TWO BINDINGS REMOVED: THEIR DOCUMENTS ARE NOT ON THIS TREE (tracker issue 83) ────────────────
  //
  // `.env.deployment.example` and `.env.prod.example` each carried a `TRADEMARK_MCP_HTTP_PORT default`
  // binding. Both files are withheld from the public tree by the cut, so on this tree the bindings
  // named documents that do not exist — a restatement guard pointed at nothing, which is the failure
  // it was written to catch, one level up.
  //
  // Removing them loses no coverage, and that was measured rather than assumed: the same constant is
  // still bound in seven places that ARE here — INSTALL.md twice, docs/CLIENT-MCP.md,
  // docs/architecture/05-config-governance.md, docs/architecture/09-security-and-data.md and
  // mcp-server/remote/REMOTE-SETUP.md twice. If the deployment reference returns to a tree that reads
  // this file, its binding comes back with it.
  // Six more copies, found by sweeping every markdown occurrence rather than fixing the one the issue
  // named. That sweep is the whole lesson: the figure a single-instance fix walks past is the
  // one that goes on reading as current. All six were already CORRECT the day they were bound — this
  // binds them so the next move of the default cannot leave them behind.
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "INSTALL.md",
    pattern: /engine door on (\d+)/,
  },
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "docs/CLIENT-MCP.md",
    pattern: /TRADEMARK_MCP_HTTP_PORT` \(default (\d+)\)/,
  },
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "docs/architecture/05-config-governance.md",
    pattern: /TRADEMARK_MCP_HTTP_PORT` \((\d+)\)/,
  },
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "docs/architecture/09-security-and-data.md",
    pattern: /loopback :(\d+)/,
  },
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "mcp-server/remote/REMOTE-SETUP.md",
    pattern: /^TRADEMARK_MCP_HTTP_PORT=(\d+)/m,
  },
  {
    constant: "TRADEMARK_MCP_HTTP_PORT default",
    source: { file: "bin/start.mjs", symbol: "resolvePorts({}).mcp" },
    expected: () => DERIVED.mcpPort,
    doc: "mcp-server/remote/REMOTE-SETUP.md",
    pattern: /curl -s http:\/\/127\.0\.0\.1:(\d+)\/healthz/,
  },

  // ── the USPTO index's two freshness clocks ────────────────────────────────────────────────
  //
  // The scheduling section asked for is only worth reading if the numbers in it are the numbers
  // the provider actually refuses on. An operator sets a timer against these figures; a doc that drifted
  // off them would have them scheduling to a threshold the code no longer keeps.
  {
    constant: "FRESHNESS_HOURS.sync",
    source: { file: "providers/uspto-local/src/index-store.js", symbol: "FRESHNESS_HOURS.sync" },
    expected: () => DERIVED.syncLagHours,
    doc: "providers/uspto-local/README.md",
    pattern: /last successful sync goes past (\d+) hours/,
  },
  // The same figure, twice in the same file — 's shape, and the reason each occurrence is a row.
  {
    constant: "FRESHNESS_HOURS.sync",
    source: { file: "providers/uspto-local/src/index-store.js", symbol: "FRESHNESS_HOURS.sync" },
    expected: () => DERIVED.syncLagHours,
    doc: "providers/uspto-local/README.md",
    pattern: /last successful sync is over (\d+) hours old/,
  },
  {
    constant: "FRESHNESS_HOURS.sync",
    source: { file: "providers/uspto-local/src/index-store.js", symbol: "FRESHNESS_HOURS.sync" },
    expected: () => DERIVED.syncLagHours,
    doc: "docs/configuration.md",
    pattern: /past (\d+) hours since the last successful sync/,
  },
  {
    constant: "FRESHNESS_HOURS.data",
    source: { file: "providers/uspto-local/src/index-store.js", symbol: "FRESHNESS_HOURS.data" },
    expected: () => DERIVED.dataLagHours,
    doc: "providers/uspto-local/README.md",
    pattern: /newest data applied goes past (\d+) hours/,
  },
  // Bound as the SPELLED number of days, because that is how the doc explains where the 96 comes from.
  // If the constant moves to a value with no whole-day reading, `spell` throws and the row has to be
  // re-thought rather than quietly re-typed.
  {
    constant: "FRESHNESS_HOURS.data (in days)",
    source: { file: "providers/uspto-local/src/index-store.js", symbol: "FRESHNESS_HOURS.data / 24" },
    expected: () => DERIVED.dataLagDays,
    doc: "providers/uspto-local/README.md",
    // The phrase wraps, so the whitespace between its halves must be `\s+` — the same shape README's
    // STAGES-count row needed. It moved with the sync prose when INSTALL.md stopped restating it.
    pattern: /puts the\s+honest worst case at (\w+) days/,
  },
];

/** Where in the doc the match landed, 1-indexed, so a failure names a line rather than a file. */
export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * Check one row against the doc's text.
 * @returns {{ok:true, found:string, line:number} | {ok:false, reason:"absent"|"stale", found:string|null, line:number|null, expected:string}}
 */
export function checkRestatement(row, text) {
  const m = row.pattern.exec(text);
  const expected = row.expected();
  if (!m) return { ok: false, reason: "absent", found: null, line: null, expected };
  const found = m[1];
  const line = lineOf(text, m.index);
  if (found !== expected) return { ok: false, reason: "stale", found, line, expected };
  return { ok: true, found, line };
}
