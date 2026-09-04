// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-ledger.mjs — the machine contract for the register Coverage ledger (WS-A; design of
// record: the three-workstream design, 2026-06-12 — the code is its own record).
//
// The register-digest worker mirrors its prose `## Coverage ledger` table into
// register-coverage-ledger.json — one JSON row per prose row, keys DICTATED by code. This module is
// the strict parser: it THROWS on any malformed shape, with the offending token FIRST in the
// message so the corrective-retry hint (gateway.mjs correctionHint) and the warm allowlist
// (WARM_ELIGIBLE_RE) can key on it. The CALLER converts the throw to a validator fail — a parse
// miss must never pass, and a validator must never throw (gateway.mjs runStage calls validate()
// bare, so an escaped throw would crash the run past the whole corrective ladder).
//
// Strictness is deliberately TWO-SIDED (amendment A-5): the axis enum is the FULL REGISTER_AXES
// (narrowing to the run's active axes would false-fail an honest row about a non-activated axis;
// the gates already filter by axis), while COMPLETENESS demands every ACTIVE axis own ≥1 row and
// rejects an empty array (shape-only validation would reproduce the silent fail-open hole — a
// forgotten deferred row vanishing — that this contract exists to kill).
//
// Like common-law-receipts.mjs this module is PURE (no node imports) so it tests offline. It also
// OWNS the axis vocabulary (REGISTER_AXES) and the axis activation scan (decideAxes), moved here
// from stages.mjs so verify.mjs can import them without a stages⇄verify cycle (stages.mjs reads
// `validators` at module scope, so verify importing stages would TDZ-crash whenever verify loads
// first; stages.mjs re-exports both names, keeping every existing import site working).

export const REGISTER_AXES = ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"];

// ── — THE READER'S NAME FOR AN AXIS, EMITTED AT SOURCE ──────────────────────────────────────────
//
// put these labels on the client's page by running find-and-replace over the RENDERED report.
// is what that costs: `axis` → `group` turned "AXIS Bank filed in class 36" into "group Bank
// filed in class 36" — a report naming a mark that does not exist, inside the report that clears it.
// The ban list and the trademark register overlap, and this engine exists to search the register, so
// there is no ban list that is safe to run over prose. Case-sensitivity bought one direction and gave
// up the other: a sentence-initial "Axis coverage was limited" leaked, and a mark filed in lowercase
// was still eaten.
//
// A label emitted BESIDE the identifier has neither failure. The identifier stays exactly where a gate
// joins on it; the page reads the label; no client-facing string is ever rewritten by pattern.
//
// WHY THIS IS NOT A BAN LIST WITH BETTER MANNERS. `coverageUnitLabel` rewrites ONE POSITION — the axis
// head of a unit the DRIVER built (`unit = scope ? \`${axis} / ${scope}\` : axis`, minted below). It is
// a structural substitution on a grammar this module owns, not a search through text. The scope tail
// rides verbatim, which is where a mark actually appears.
export const AXIS_READER_LABEL = Object.freeze({
  "primary-sweep": "main register sweep",
  "saturation-probe": "field-size count",
  "transliteration-numeric": "transliterations and numeric forms",
  "incumbent-class": "owner portfolio sweep",
});

/**
 * A coverage unit in the reader's words. `<axis> / <scope>` → `<label> / <scope>`; a bare axis → its
 * label; anything whose head is not one of the four closed axes rides back UNCHANGED.
 *
 * THE SEPARATOR IS THE CONTRACT, not a guess: the unit is minted below as `${axis} / ${scope}` with
 * that exact spacing, so splitting on the first " / " recovers the two halves the driver put there.
 * A unit that does not start with a known axis is a seat-authored or driver-authored plain-English
 * area ("Follow-up / …", "Unexamined drop / …") and must not be touched.
 * PURE.
 */
export function coverageUnitLabel(unit) {
  const u = String(unit ?? "");
  if (!u) return u;
  const cut = u.indexOf(" / ");
  const head = cut < 0 ? u : u.slice(0, cut);
  const label = Object.hasOwn(AXIS_READER_LABEL, head) ? AXIS_READER_LABEL[head] : null;
  if (!label) return u;
  return cut < 0 ? label : `${label}${u.slice(cut)}`;
}

// The closed status set. BARE tokens only — the prose table may carry suffixed statuses like
// `coverage-limited (count-only, saturated)` (digest.md teaches one); in the JSON the qualifier
// moves into `reason`, and the dictation block + correction hint both say so.
export const COVERAGE_STATUSES = ["confirmed-clean", "coverage-limited", "deferred"];

// — the seat-facing coverage form's file name, owned HERE with the rest of the coverage vocabulary
// so the four places that need it (paths(), coverage-form-io, the gateway's repair routing and the
// stray-artifact sweep) all read one literal. A name derived twice is the drift.
export const COVERAGE_FORM_NAME = "register-coverage-form.json";

// U1 (Appendix A tripwire #2) — axes that NEVER make a run "incomplete" on their own. The
// saturation-probe is a count-only macro probe that is `coverage-limited` BY DEFINITION (digest.md:
// "coverage-limited (count-only, saturated)"); clamping every saturated run to CONDITIONAL would make
// the verdict meaningless, so it is the one principled carve-out.
export const NON_MATERIAL_AXES = ["saturation-probe"];

// The coverage-unit token that marks a CROWD RULING row — the one seat row the digest is compelled to
// write, and the only one under a delivery-blocking gate (recall-reconciliation.mjs's position join:
// a residual position with no individual ending is covered ONLY by membership of a ruled, counted
// crowd). It lives HERE, with the rest of the coverage vocabulary, for the reason COVERAGE_FORM_NAME
// does: the parser that reads it (parseCrowdRulings) sits in an IMPURE module, and coverage-form.mjs —
// which must carry the same token into the `seat_row_contract` written into the file the seat edits —
// is pure by contract and cannot import it from there. One literal, two readers, no second copy.
// recall-reconciliation.mjs re-exports this name, so every existing import site is unchanged.
export const CROWD_RULING_TOKEN = "dominant-element crowd";

// The count a crowd ruling declares is read out of the coverage-unit CELL and nowhere else — see
// parseCrowdRulings, whose `\(?\s*([\d,]+)\s*members?\b` runs against `unit ?? scope` only. A ruling
// whose count sits in the `reason` parses as ZERO and covers nothing, which is a silent delivery block.
// This is the grammar every surface that dictates the row must produce, and the test that ends the
// class instantiates it and drives it through the real parser rather than matching on it.
export const CROWD_RULING_UNIT_GRAMMAR = `<axis> / ${CROWD_RULING_TOKEN} (<N> members): <one-line label for the residual class>`;

// THE ONE READING OF A CROWD-RULING CELL. Until this function existed the count was parsed in
// exactly one place — parseCrowdRulings, at DELIVERY — so the call that RECORDS the row could not tell
// whether the row it was accepting would cover anything, and a cell the delivery parser reads as zero
// was accepted, carried through the union, passed the coverage gate, and blocked the run three gates
// later over a ruling the seat had made. Both readers now call this, so call time and delivery time
// cannot disagree about what a count is. That is the point of the function, not a tidiness: two copies
// of this regex would let the refusal and the block drift apart, which is 's defect.
//
// THREE ANSWERS, and the middle one is the whole reason the return is not a boolean:
//   null  — the cell rules no crowd. Every other coverage row, and the overwhelming majority.
//   0     — the cell RULES a crowd and the count read out of it is zero. Either no `(<N> members)` at
//           all, or a literal `(0 members)`. The refusal says the CONSEQUENCE rather than guessing
//           which: a zero-member crowd covers no position either way, so both are the blocking state.
//   n     — the count the delivery join will credit this ruling with.
//
// The count is read from the CELL, never from `reason` — widening it would change a gate that judges
// archived runs (skill-contract-enumerations.test.mjs pins that, by name). PURE.
export function crowdRulingCount(cell) {
  const s = String(cell ?? "");
  if (!new RegExp(CROWD_RULING_TOKEN.replace(/[- ]/g, "[- ]"), "i").test(s)) return null;
  const m = s.match(/\(?\s*([\d,]+)\s*members?\b/i);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

// Strip the cosmetic noise the LLM sometimes wraps an axis token in — markdown emphasis/bold
// (`**primary-sweep**`), inline code backticks, and a trailing `(material)` / `(matter-context…)`
// qualifier — then trim/lowercase/collapse. PURE.
const cleanAxisToken = (s) => String(s ?? "")
  .replace(/[*_`]+/g, "")        // markdown bold/italic/code
  .replace(/\([^)]*\)/g, " ")    // drop parentheticals (qualifiers, notes)
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

// Coerce a coverage-axis cell to a canonical REGISTER_AXES token when one is UNAMBIGUOUSLY present —
// the three field-observed leaks: markdown bold (`**primary-sweep`), a `(…)` qualifier, and axis/scope
// TRANSPOSITION where the model wrote the jurisdiction first (`ch / primary-sweep` → the axis is on the
// right). Returns the canonical token, or the cleaned string unchanged when NO known axis is present —
// so a genuinely-unknown axis (a real typo, a stray `digest` row) STILL fails the strict validator and
// routes to the existing corrective-retry. We repair formatting, never invent an axis. PURE.
//   `whole` (optional) is the full "Coverage unit" cell — scanned for a transposed axis when the
//   primary token isn't a known axis.
export function normalizeAxis(raw, whole = "") {
  const cleaned = cleanAxisToken(raw);
  if (REGISTER_AXES.includes(cleaned)) return cleaned;
  const hay = `${cleaned} ${cleanAxisToken(whole)}`;
  const hit = REGISTER_AXES.find((a) => hay.includes(a));   // tokens are distinctive + non-overlapping
  if (hit) return hit;
  // #3 backstop (VELTRIPHEN 2026-06-19): an axis-less DIGEST sub-activity row — an owner / watchlist-owner /
  // incumbent / stealth-filer sweep, or a cross-check / cross-class merch / Option-D closure — authored with a
  // `digest` label (or no axis) instead of its OWNING register axis. digest.md dictates the attribution: owner /
  // incumbent sweeps belong to `incumbent-class`; cross-checks / cross-class merch belong to `primary-sweep`.
  // Coerce ONLY on an UNAMBIGUOUS sweep signal in the whole Coverage-unit cell, so the row keeps its coverage
  // weight instead of failing the strict validator and killing the whole machine ledger. Checked BEFORE the bare
  // 2-letter backstop because a `CH / owner-sweep` row is an owner sweep first, a jurisdiction row second.
  // Anti-fail-open preserved: NO recognizable sweep signal ⇒ unchanged (a bare `digest` / a real typo still fails).
  if (/\bowner[- ]?sweep|watchlist[- ]?owner|\bincumbent\b|stealth[- ]?filer/.test(hay)) return "incumbent-class";
  if (/\bcross[- ]?check|cross[- ]?class|\bmerch(?:andis\w*)?\b|option[- ]?d\b/.test(hay)) return "primary-sweep";
  // Backstop (VELTRIPHEN 2026-06-19): a material-jurisdiction RECONCILIATION row whose Coverage-unit is just the
  // jurisdiction with NO axis prefix (`CH (material) / TRIPHEN* region:CH`) cleans to a bare 2-letter code, which
  // the strict validator rejects → the whole machine ledger dies → prose fallback on every gate. The per-jurisdiction
  // sub-query belongs to `primary-sweep` (the axis that runs the main per-jurisdiction sweeps), so coerce a bare
  // jurisdiction token to it. NARROW on purpose — ONLY a bare 2-letter code with NO axis anywhere; a real typo or a
  // stray `digest` cross-check row still fails the strict validator (the anti-fail-open guard is preserved).
  if (/^[a-z]{2}$/.test(cleaned)) return "primary-sweep";
  return hit || cleaned;
}

// Derive the run's HONEST completeness from the coverage ledger ALONE — never from the (empirically
// noisy) reviewer verdict (Appendix A: read the honesty signal from mechanical artifacts, not a layer
// that wobbles). A layer is a material gap when its row is `coverage-limited` / `deferred` and its axis
// is not in `excludeAxes`. Axis-agnostic on purpose: the caller composes the row list (register ledger
// rows + common-law coverage-limited cells mapped to a `common-law` axis), so this one function serves
// both the verdict-floor clamp (pipeline) and the status-honesty lint check.
//   rows: [{axis, status, unit?, reason?}]  →  { complete: boolean, materialGaps: [{axis,status,unit,reason}] }
export function deriveCoverageStatus(rows, { excludeAxes = NON_MATERIAL_AXES } = {}) {
  const excl = new Set((excludeAxes ?? []).map((a) => String(a).toLowerCase()));
  const materialGaps = (rows ?? [])
    .filter((r) => r && !excl.has(String(r.axis ?? "").toLowerCase())
      && (r.status === "coverage-limited" || r.status === "deferred"))
    .map((r) => ({ axis: String(r.axis ?? "").toLowerCase(), status: r.status, unit: r.unit ?? r.axis ?? "", reason: r.reason ?? "" }));
  return { complete: materialGaps.length === 0, materialGaps };
}

// Keystone (VELTRIPHEN 2026-06-19): tool-absence / could-not-reach-the-data is a CLOSEABLE gap (`deferred`),
// NEVER an accepted saturation limit (`coverage-limited`). The doctrine (SKILL.md status definitions): a
// `coverage-limited` row means the search RAN but the data was too large/thin to exhaust — a re-run cannot
// close it, so the escalation gate SKIPS it (pipeline: skip-if-every-owned-row-is-coverage-limited) and the
// deadline envelope ignores it. A `deferred` row means the search could not run or could not reach its data
// (tool absent, provider error, fetch blocked) → escalate + disclose. When the model mislabels an
// unreachable-data gap as `coverage-limited`, that fixable hole vanishes into an "accepted limit". This pure
// backstop relabels such a row to `deferred` so the machine decisions (escalate / close / clamp / disclose)
// are right regardless of the prose label. NARROW: matches ONLY an explicit could-not-reach signature in the
// reason — a genuine saturation/volume/pagination `coverage-limited` row is untouched. The "(?:could not|…)
// reach …" alternative is anchored to an ACCESS/DATA noun so it never trips on "could not reach completeness"
// (a real coverage-limited phrasing). PURE.
// 2026-07-21 (phase 3, the per-provider capability contract): a slice the ACTIVE PROVIDER CANNOT RUN —
// a predicate with no mapping on it, or a jurisdiction outside its office coverage — is the same class
// of gap as a missing tool: the search never ran and a DIFFERENT provider (or a different tool) could
// close it. register-plan.mjs's unsupportedPredicateReason / uncoveredJurisdictionReason emit exactly
// these two phrasings, and the per-provider relabel tests pin them. Deliberately narrow: both require
// the literal "register provider" tail, so ordinary saturation prose cannot trip them.
const TOOL_ABSENCE_RE = /not (?:supported|covered) by (?:the )?(?:active )?register provider|tool[- ](?:absent|unavailable|missing|access)|no (?:such )?tool\b|not on the allowlist|tool not (?:available|configured|enabled|present)|provider (?:unavailable|down|error|not configured|absent|failure)|no (?:register )?provider\b|fetch (?:failed|blocked|error|unavailable)|(?:could not|cannot|couldn't|unable to) (?:reach|fetch|access|retrieve|query|call|invoke) (?:the )?(?:provider|data|register|endpoint|api|source|tool|record|mcp)|mcp (?:tool )?(?:unavailable|error|missing|absent|failed)|endpoint (?:unavailable|unreachable|down|failed)|connection (?:failed|refused|error|timed out)|api (?:error|unavailable|down|failure)/i;
export function coerceToolAbsenceDeferred(rows) {
  return (rows ?? []).map((r) =>
    (r && r.status === "coverage-limited" && TOOL_ABSENCE_RE.test(String(r.reason ?? "")))
      ? { ...r, status: "deferred" }
      : r);
}

// ── A2 (addendum 2026-07-30): a CAPABILITY-GAP deferral is never closeable by time ────────────────
//
// `deferred` is one label over two very different facts, and the deadline envelope could not tell
// them apart. A slice that was PLANNED and never got run is closeable: re-run it and the row closes.
// A slice the ACTIVE PROVIDER CANNOT EXPRESS AT ALL — a predicate it lacks, an office outside its
// coverage, a term its index cannot hold, an owner surface it does not have — will answer the same
// refusal every time it is asked. On the 2026-07-30 evidence run the envelope closed two such axes on
// the clock alone ("no deadline given — time permits closing in-loop"), spending a paid unit re-run
// per axis to re-derive a deterministic no.
//
// So the split is mechanical, and it is TWO-KEYED on purpose. The plan-execution receipt is the
// AUTHORITY (its `deferred[]` bucket is stamped by the executor's own client-side refusal, never by
// prose), and the row reason is only the SPLITTER inside an axis the receipt already indicts. That
// ordering matters: a prose false-positive can then never invent a hold — and suppressing a
// legitimate close costs recall, which is the worse failure. On a run whose receipt carries no
// deferred qid, every path below is a no-op and the envelope behaves byte-identically.
//
// The vocabulary is the providers' own: the three exported reason builders in register-plan.mjs plus
// the executor's CAPABILITY_GAP_MARKER (script-form refusals) and its unresolvedOwnerCountReason.
//
// That last one is a DELIBERATE addition rather than an obvious one, because it is not a capability the
// provider lacks — the provider answered, with a well-formed HTTP 200. What makes it belong here is the
// only property this split actually tests: whether a RE-RUN of the same entry can close the row. It
// cannot. The same owner name, resolved against the same owner vocabulary, produces the same empty
// resolution and the same 0 every time it is asked, so re-running it spends a paid unit to re-derive a
// deterministic no. The row stays `deferred` and stays disclosed (the floor keeps its hold, the
// registerGap clamp stays armed) — it is simply never closed by the clock. Closing it needs a DIFFERENT
// question (the owner×term slices its covered_by names, or the register's own styling from a human),
// which is precisely what "held" means here. PURE.
const CAPABILITY_GAP_REASON_RE = /capability-gap:|not supported by (?:the )?(?:active )?register provider|not covered by (?:the )?(?:active )?register provider|owner.{0,3}term intersection is not supported|indexes non-latin filings by their transliteration|provider capability absent|has no owner surface|owner vocabulary returned no applicant styling/i;

/** Does this reason state a deterministic capability gap (nothing a re-run can change)? PURE. */
export const isCapabilityGapReason = (reason) => CAPABILITY_GAP_REASON_RE.test(String(reason ?? ""));

/**
 * Split an axis's floor obligations into what a re-run can close and what it never can.
 *
 * @param rows              the machine coverage-ledger rows (loadCoverageLedger output)
 * @param axis              the axis under consideration
 * @param capabilityGapAxes axes the plan-execution receipt says carry >=1 deterministic deferral
 * @param opts.fullyDeferred  the plan says EVERY entry on this axis is unsupported (fullyDeferredAxes) —
 *          then there is nothing on the axis a re-run could reach, whatever a row's prose says
 * @returns {{closeable: rows[], held: rows[]}} — `held` rows stay `deferred` and stay disclosed:
 *          the coverage floor keeps its right to hold on them (computeOpenFloors → envelope_note,
 *          the registerGap clamp stays armed). They are simply never re-run and never closed by time.
 * PURE.
 */
export function splitDeferredByCloseability(rows, axis, capabilityGapAxes, { fullyDeferred = false } = {}) {
  const ax = String(axis ?? "").toLowerCase();
  const indicted = new Set([...(capabilityGapAxes ?? [])].map((a) => String(a).toLowerCase()));
  const owned = (rows ?? []).filter((r) => r && r.status === "deferred" && String(r.axis ?? "").toLowerCase() === ax);
  if (fullyDeferred) return { closeable: [], held: owned };
  if (!indicted.has(ax)) return { closeable: owned, held: [] };
  const held = owned.filter((r) => isCapabilityGapReason(r.reason));
  const closeable = owned.filter((r) => !isCapabilityGapReason(r.reason));
  return { closeable, held };
}

// ── THE LEDGER AS A TABLE, WRITTEN ONCE ────────────────────────────────────────────────────────────
//
// Two dispatches hand a judgment seat the machine ledger as ROWS rather than as a path: the skeptic
// (whose escalation decision spends money) and synthesis (whose coverage judgment signs the run). The
// row grammar lived as one inline `rows.map(...)` inside `skepticDeferralExtra`, so giving synthesis the
// same table meant typing that grammar a second time — and two copies of a row grammar is how the
// axis/unit/status/reason columns come to disagree about which cell carries the qualifier.
//
// The reason cell is squashed to one line and bounded: a ledger reason is prose the digest wrote, and an
// unbounded one can carry a whole paragraph into a block that is supposed to be a table. The bound is on
// the REASON only — never on the axis, the unit or the status, which are identifiers and enum tokens a
// reader has to be able to match back to the file.
// PURE.
export function coverageLedgerTableRows(rows, { reasonMax = 180 } = {}) {
  return (rows ?? []).map((r) => `| ${r.axis} | ${r.unit} | ${r.status} | ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, reasonMax)} |`);
}

// Timeout-taint relabel (copper-lattice 2026-07-08) — the direct sibling of coerceToolAbsenceDeferred.
// A register-unit pass whose winning band was touched by a kill-class attempt (register-taint.mjs) is
// UNFINISHED in fact, whatever its prose says: a `confirmed-clean` row on such a MATERIAL axis is a
// self-report the machine must not trust. Relabel it `deferred` — the closeable-gap state the envelope
// re-runs and the verdict floor clamps — with the honest reason appended. NARROW by design: only
// confirmed-clean rows on tainted material axes move; coverage-limited/deferred rows and non-material
// axes (saturation-probe) are untouched; an empty taint set is a no-op. PURE; the caller pre-reads the
// taint verdicts (pipeline loadCoverageLedger → readRegisterTaint).
export function applyTaintDeferred(rows, taintedAxes) {
  const tainted = new Set((taintedAxes ?? []).map((a) => String(a).toLowerCase()));
  if (!tainted.size) return rows ?? [];
  const material = (a) => !NON_MATERIAL_AXES.includes(String(a ?? "").toLowerCase());
  return (rows ?? []).map((r) =>
    (r && r.status === "confirmed-clean" && tainted.has(String(r.axis ?? "").toLowerCase()) && material(r.axis))
      ? { ...r, status: "deferred", reason: `${String(r.reason ?? "").trim()}${r.reason ? " — " : ""}timeout-tainted pass: self-reported clean downgraded pending re-run`.trim() }
      : r);
}

// The registerGap clamp decision (copper-lattice) — PURE, unit-testable. A material register slice that
// never (fully) ran is an EXECUTION fact, not a sufficiency judgment: `deferred` material rows (incl.
// the taint relabel), an unresolved timeout-taint on a material axis, or a material recall regression
// (a prior-confirmed live conflict this run neither carried nor justified) each force the deterministic
// CLEAR→CONDITIONAL floor, independent of the LLM's coverage_judgment (whose absent-⇒-sufficient default
// is exactly the hole this closes). `coverage-limited` never fires — that is an accepted limit, not an
// unfinished search.
export function decideRegisterGap(rows, { taintAxes = [], recallRegressions = [] } = {}) {
  const deferred = deriveCoverageStatus(rows).materialGaps.filter((g) => g.status === "deferred");
  const taint = (taintAxes ?? []).filter((a) => !NON_MATERIAL_AXES.includes(String(a ?? "").toLowerCase()));
  const recalls = (recallRegressions ?? []).filter(Boolean);
  return { gap: deferred.length > 0 || taint.length > 0 || recalls.length > 0, deferred, taintAxes: taint, recallRegressions: recalls };
}

// NOTE (judgment-relocation, 2026-06-23): the interim NOVA PULSE gate `coerceMeaningExactFalseClean` (the
// broad→narrow meaning-token false-clean relabel) was DELETED here. It was a per-case rule the funnel used to
// second-guess a clean — exactly the kind of in-machine sufficiency call the relocation removes. Under the band
// flow the funnel ENUMERATES the dangerous named band (every meaning/phonetic variant × in-scope class) or marks
// it `incomplete` to judgment; the lawyer (synthesis) reads the COMPLETE band and decides relevance/sufficiency
// and commands a re-enumeration or halts. No regex backstop replaces it — that would re-add the disease.

// NOTE (judgment-relocation, 2026-06-23): `findDominantFloorRow` was DELETED. It read the primary-sweep
// exact-in-class-live floor ROW to decide whether the funnel had "enumerated enough" — a sufficiency call the
// driver made from a prose-ledger label. Under the band flow that decision is judgment's: synthesis reads the
// COMPLETE named band (register-units/<axis>-band.json) and the `incomplete` crowd descriptors and emits
// coverage_judgment {sufficient, commands[], halt}. The driver acts on that signal, not on a re-parsed label.

const normKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

// deriveFloorKeys — the token(s) the exact-in-class-live floor must cover. We CARRY BOTH the distinctive
// formative ROOT (the stem a family of marks shares — TRIPHEN for VELTRIPHEN/TRIPHENS) AND the full dominant
// element, so a mis-stem can NEVER lose the coverage we have today (the root only WIDENS the net, it never
// replaces the full token). The root is accepted only if it passes a guard: ≥3 chars, ≠ the dominant element,
// and a genuine shared stem of it (the dominant contains the root, or they share a ≥3-char prefix). A garbage
// or unrelated "root" is dropped → the full token stands alone (today's behaviour). PURE; panel-tested.
export function deriveFloorKeys({ dominantEl = "", root = "" } = {}) {
  const dom = normKey(dominantEl), r = normKey(root);
  const keys = [];
  if (dom) keys.push(dom);
  const sharesStem = dom && r && (dom.includes(r) || r.includes(dom) || dom.slice(0, 3) === r.slice(0, 3));
  if (r && r.length >= 3 && r !== dom && (sharesStem || !dom)) keys.push(r);
  return [...new Set(keys)];
}

// NOTE (judgment-relocation, 2026-06-23): `findFloorShapeGaps` (the SEARCH-SHAPE clean predicate: the (a)
// missing-band / (b) per-class / (c) sampled / (d) open-name-list invariants) and its helpers (`FLOOR_RE`,
// `floorCounts`, `classesNamed`, `NAME_LIST_OPEN_RE`) were DELETED. They were the interim NOVA PULSE gates — the
// driver re-parsing the prose Coverage-ledger to decide whether the funnel had "enumerated enough", then
// synthesizing material gaps / forcing an exact-anchor reopen. That is a sufficiency call moved into the
// machine, which is exactly what the relocation removes (mandate HARD RULE 1 + 2: no in-funnel sufficiency,
// no new per-case gate). Under the band flow the funnel hands up the COMPLETE named band or an `incomplete`
// descriptor (named-band.mjs), and synthesis (Layer B) reads it and emits coverage_judgment {sufficient,
// reason, commands[], halt} — the driver commands a re-enumeration or halts on THAT signal. `deriveFloorKeys`
// is kept (it still names the dominant/root the manifest is built around for command targeting / telemetry).

// Light applicability scan over the variant manifest (Step 2A). primary-sweep is always on; the others
// turn on from manifest markers, defaulting to ON when ambiguous (a non-applicable unit self-writes a
// harmless "not applicable" digest, so over-spawning is safe; under-spawning would drop coverage).
export function decideAxes(manifestText = "") {
  const t = manifestText.toLowerCase();
  // primary-sweep always; saturation-probe always (cheap haiku count-probe, high value, harmless if empty);
  // the other two turn on from manifest markers, defaulting ON when the manifest is empty/unparseable
  // (a non-applicable unit self-writes a harmless "not applicable" digest; under-spawning would drop coverage).
  const axes = ["saturation-probe", "primary-sweep"];
  if (!manifestText || /translit|numeric[- ]?substitution|non-latin|script/.test(t)) axes.push("transliteration-numeric");
  if (!manifestText || /incumbent|industry_incumbent_alert|crowded[- ]field/.test(t)) axes.push("incumbent-class");
  return [...new Set(axes)];
}

// Parse the `Coverage ledger` markdown table out of register-findings.md into rows
// [{axis, status, unit, reason}] — the LEGACY/prose path (moved here from pipeline.mjs so the
// registerFindings validator can mirror-check prose against JSON without a verify⇄pipeline cycle).
// The "Coverage unit" cell is `<axis> / <scope>`; the axis (left of the first `/`) compares
// LITERALLY downstream and the Status cell classifies to one of the three tokens — tolerating
// suffixes like `coverage-limited (count-only, saturated)`. Rows that cannot classify are dropped
// AND returned in dropped[] (parseCoverageLedgerFull) so a prose-fallback delivery can name them;
// an axis whose rows are all unparseable looks like "no row" → never skipped (floor-safe default).
// D1 fail-closed: a dropped row whose axis IS a known register axis but whose Status cell carries
// no enum token is a REAL coverage row going missing — every downstream gate (deriveCoverageStatus,
// the plan/taint joins) would run as if it never existed. Such rows are ALSO returned in offEnum[]
// so the registerFindings validator can fail token-first; junk/prose lines (unknown axis) stay
// dropped-only and never fire it.
export function parseCoverageLedgerFull(md) {
  const rows = [];
  const dropped = [];
  const offEnum = [];
  let inLedger = false;
  for (const ln of (md || "").split("\n")) {
    const h = ln.match(/^#{2,4}\s+(.*)/);
    if (h) { inLedger = /coverage ledger/i.test(h[1]); continue; }
    if (!inLedger || !ln.trimStart().startsWith("|")) continue;
    const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
    if (cells.length < 2) continue;
    const unit = cells[0];
    if (/^coverage unit$/i.test(unit) || /^[-:\s]+$/.test(unit)) continue; // header / separator row
    // normalize-then-validate at the parse boundary (B): repair markdown/qualifier noise on the
    // left-of-slash axis; if that isn't a known token, scan the whole cell for a transposed axis.
    const axis = normalizeAxis(unit.split("/")[0], unit);
    const m = cells[1].match(/coverage-limited|deferred|confirmed-clean/i);
    if (!axis || !m) {
      if (axis && !m && REGISTER_AXES.includes(axis)) offEnum.push({ axis, unit, status: cells[1] });
      dropped.push(ln.trim().replace(/\s+/g, " ").slice(0, 120));
      continue;
    }
    rows.push({ axis, status: m[0].toLowerCase(), unit, reason: cells[2] ?? "" });
  }
  return { rows, dropped, offEnum };
}
export function parseCoverageLedger(md) {
  return parseCoverageLedgerFull(md).rows;
}

// `additionalProperties:false` by hand — the driver has no JSON-schema library (exceljs is the only
// dependency) and must not grow one for a four-key row. `classes` (PR compute-don't-author) is the ONE
// OPTIONAL structured column: the Nice classes a row is about, as an array of class-number strings — the
// join key scope-facts.mjs uses to attribute a coverage gap to an instructed class without re-parsing
// prose. Archived ledgers (no classes key) parse byte-identically to before.
const ROW_KEYS = ["axis", "scope", "status", "reason", "classes"];

// Extract Nice-class tokens from a ledger row's free-text scope/reason cell ("[cl 5,32]", "Class 30 leg",
// "nice classes 5/32"). DETERMINISTIC + conservative: only numbers 1–45 introduced by an explicit
// class marker count — a bare number (a hit count, a year) never reads as a class. PURE; shared by
// renderCoverageLedgerJson (structured classes[] derivation) and scope-facts.mjs (legacy-row fallback join).
export function classTokensFromScopeText(text) {
  const out = new Set();
  const t = String(text ?? "");
  for (const m of t.matchAll(/\b(?:cl|cls|class(?:es)?|nice(?:\s+class(?:es)?)?)[.\s:]*((?:\d{1,2})(?:\s*[,/&+]\s*(?:and\s+)?\d{1,2})*)/gi)) {
    for (const tok of m[1].split(/[^0-9]+/)) {
      const n = Number(tok);
      if (Number.isInteger(n) && n >= 1 && n <= 45) out.add(String(n));
    }
  }
  return [...out];
}

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

/**
 * Parse + strictly validate the saved JSON coverage ledger. Returns rows
 * `[{axis, scope, status, reason, unit}]` (axis lowercased canonical; `unit` reconstructed as
 * `"<axis> / <scope>"`, or bare `axis` for a scope-less row — the verbatim-cell label every
 * consumer joins on). Throws on ANY defect, offending token FIRST:
 *   coverage_ledger_unparseable | coverage_ledger_empty | coverage_key_unknown:<key>
 *   | coverage_axis_invalid:<axis> | coverage_status_invalid:<status> | coverage_axis_missing:<axis>
 *
 * @param {string} raw — the file contents.
 * @param {{allowedAxes?: string[], activeAxes?: string[]|null}} opts — activeAxes (from decideAxes
 *   over the run's manifest) drives the completeness check; pass null to skip it (manifest
 *   unreadable: offline tests, partial run dirs — mirrors the commonLaw receipt-check skip).
 */
export function parseCoverageLedgerJson(raw, { allowedAxes = REGISTER_AXES, activeAxes = null } = {}) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`coverage_ledger_unparseable: ${short(e.message)}`); }
  if (!Array.isArray(parsed)) throw new Error("coverage_ledger_unparseable: top level must be a JSON ARRAY of row objects");
  if (parsed.length === 0) throw new Error("coverage_ledger_empty: at least one row per active axis is required");
  const rows = [];
  for (const r of parsed) {
    if (!r || typeof r !== "object" || Array.isArray(r))
      throw new Error("coverage_ledger_unparseable: every row must be a plain object");
    for (const k of Object.keys(r)) {
      if (!ROW_KEYS.includes(k)) throw new Error(`coverage_key_unknown:${short(k)} (keys are EXACTLY: axis, scope, status, reason — plus OPTIONAL classes)`);
    }
    // normalize-then-validate (B): coerce cosmetic formatting (markdown/qualifier/transposition) to the
    // canonical token, but keep the guard STRICT — an unknown axis still fails, with the ORIGINAL token in
    // the message so the corrective-retry hint keys on what the model actually wrote.
    const axis = normalizeAxis(r.axis);
    if (!allowedAxes.includes(axis))
      throw new Error(`coverage_axis_invalid:${short(r.axis)} (not in: ${allowedAxes.join(", ")})`);
    const status = String(r.status ?? "").trim().toLowerCase();
    if (!COVERAGE_STATUSES.includes(status))
      throw new Error(`coverage_status_invalid:${short(r.status)} (EXACTLY one bare token of: ${COVERAGE_STATUSES.join(" / ")} — qualifiers move into reason)`);
    const scope = typeof r.scope === "string" ? r.scope.trim() : "";
    const reason = typeof r.reason === "string" ? r.reason : "";
    // OPTIONAL structured classes — strict when present (an array of 1–45 class tokens; anything else is
    // a shape defect, token-first like every other cell), silently absent otherwise (archived ledgers).
    let classes;
    if (r.classes !== undefined) {
      if (!Array.isArray(r.classes)) throw new Error(`coverage_classes_invalid:${short(r.classes)} (classes is an ARRAY of Nice class numbers when present)`);
      classes = r.classes.map((c) => String(c).trim());
      if (classes.some((c) => !/^\d{1,2}$/.test(c) || Number(c) < 1 || Number(c) > 45))
        throw new Error(`coverage_classes_invalid:${short(r.classes.join(","))} (each entry is a Nice class number 1–45)`);
    }
    rows.push({ axis, scope, status, reason, ...(classes ? { classes } : {}), unit: scope ? `${axis} / ${scope}` : axis });
  }
  if (activeAxes?.length) {
    const present = new Set(rows.map((r) => r.axis));
    for (const a of activeAxes) {
      const ax = String(a).toLowerCase();
      if (!present.has(ax)) throw new Error(`coverage_axis_missing:${short(ax)} (this run activated the axis — it must own at least one ledger row)`);
    }
  }
  return rows;
}

// ── #476 — `renderCoverageLedgerJson` IS DELETED, AND THE DIRECTION WITH IT ─────────────────────────
//
// Map #3 code-derived this JSON FROM the model's `## Coverage ledger` prose, which was an improvement
// (the model stopped authoring the JSON) that left the real source of truth where it was: a markdown
// table the model wrote. Under #476 the DRIVER-WRITTEN coverage form is the source and both the table
// and this JSON are renders of it — coverage-form.renderCoverageLedgerJsonFromForm. There is no
// prose→JSON direction left to keep, and keeping one would be the legacy path this build has none of.
//
// `parseCoverageLedgerFull` above SURVIVES, deliberately and with exactly one job: reading an ARCHIVED
// run's table. Every corpus run predates the form, `loadCoverageLedger`'s fallback still needs to read
// them, and no gate parses that table on a live run any more.
