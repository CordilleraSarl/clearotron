// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE LANE SAYS WHAT IT ASKED FOR AND WHAT IT GOT, AND FLAGS THE GAP.
//
// `lanes.<lane>.depth` in `_driver/jx-lanes.json` is frozen at mint from `jxPolicy.laneDepth`. Nothing
// gates a slice on it: since item 8 the retrieval slices arm on the per-lane switch ALONE (the two
// per-slice arms this line used to name are deleted). So a profile set to `full` on an unarmed deployment
// and one set to `candidates` on an armed deployment execute IDENTICALLY — and `scripts/score.mjs` printed the ask bare, one column from
// `executes`, in a row a reader takes as a record of execution:
//
//     lane zh: executes=candidates+serp-grid  depth=full  degraded=false  accepted=4
//
// Fourth instance of one seam. deleted the `degraded` fallback that read the declaration;
// stopped folding the run-level statement into the per-lane slot; deleted the frozen `executes`.
// Each time a mint-time declaration was being read as an execution record.
//
// RULING (2026-08-17): "if we can't run deep dive on serpAPI we need to flag it" — FLAG, NOT GATE.
// Gating would change what a run executes and therefore what it bills; the flag changes only what the
// record admits. So `depth` keeps its name and value, the run derives what the lane ACTUALLY got from
// the same durable record `executes` comes from, and the shortfall is stated loudly in three places: the
// sidecar, the scorer row, and a client-visible coverage row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { deriveLaneDepthVerdicts, deriveJxSliceStatement, laneDepthOfRun } from "../jx.mjs";
import { localLanguageDepth } from "../publish/search-depth.mjs";
import { readJxLanes } from "../reference-score.mjs";
import { injectLaneDepthCoverage } from "../pipeline.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "lane-depth-"));

// A sidecar's declared half: the frozen ask. `fold.slices` is the derived half and is supplied per test.
const sidecarWith = (lanes) => ({ lanes });
const laneAsking = (depth) => ({ depth, jurisdictions: ["CN"] });

// The slice statement shapes `deriveJxSliceStatement` produces, written out rather than generated, so a
// change to that function's OUTPUT shape reddens here instead of both sides moving together silently.
const slicesWhere = ({ candidates = "ran", serp = "not-armed", native = "not-armed" } = {}) => ({
  candidates: { slice: 1, state: candidates, lanes: { zh: candidates } },
  "serp-grid": { slice: 2, lane: "zh", state: serp, why: `serp ${serp}` },
  nativeread: { slice: 3, lane: "zh", state: native, why: `native ${native}` },
});

test("asked full and the deep slices RAN — no shortfall, and `ran` says full", () => {
  const v = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ zh: laneAsking("full") }),
    slices: slicesWhere({ serp: "ran", native: "ran" }),
  });
  assert.equal(v.zh.asked, "full");
  assert.equal(v.zh.ran, "full");
  assert.equal(v.zh.shortfall, false, "a lane that got what it asked for must not be flagged — a flag that fires always is not a flag");
  assert.equal(v.zh.cause, null);
});

test("asked full, the arms were off, candidates ran — REQUESTED-FULL-RAN-CANDIDATES", () => {
  const v = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ zh: laneAsking("full") }),
    slices: slicesWhere({ serp: "not-armed", native: "not-armed" }),
  });
  assert.equal(v.zh.asked, "full");
  assert.equal(v.zh.ran, "candidates");
  assert.equal(v.zh.shortfall, true);
  assert.equal(v.zh.cause, "requested-full-ran-candidates");
  // The reader is not sent to the artifact to find out WHICH switch was off — the rule for
  // degradedCause, applied to the field beside it.
  assert.match(v.zh.why, /serp-grid not-armed/);
  assert.match(v.zh.why, /nativeread not-armed/);
  assert.match(v.zh.why, /an env arm is off on this deployment, not a fault in the run/,
    "the cause must distinguish a deployment that did not arm the slice from a run that failed it");
});

test("ONE deep slice running is enough to have delivered full — the arms are independent", () => {
  // jx-units gates the two units separately and either one searching in-script IS the deep lane
  // running (scriptLaneRanOnRun says so in as many words). A verdict requiring BOTH would flag a lane
  // that did the deeper work.
  const v = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ zh: laneAsking("full") }),
    slices: slicesWhere({ serp: "ran", native: "not-armed" }),
  });
  assert.equal(v.zh.ran, "full");
  assert.equal(v.zh.shortfall, false);
});

test("asked full on a lane THIS BUILD has no deep slice for — a different cause, not the same flag", () => {
  // The deep slices are zh-only: JX_SLICES pins `lane: "zh"` on slices 2 and 3, and SERP_LANES has one
  // row. `laneDepth.ja = "full"` therefore asks for something no environment can arm. Same printed
  // shortfall as an unarmed zh lane, OPPOSITE remedy — build the slice vs turn the switch on — so
  // collapsing them into one token would be the false generalisation this repo keeps paying for.
  const v = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ ja: { depth: "full", jurisdictions: ["JP"] } }),
    slices: { candidates: { slice: 1, state: "ran", lanes: { ja: "ran" } } },
  });
  assert.equal(v.ja.shortfall, true);
  assert.equal(v.ja.cause, "not-built-for-lane",
    "a lane the build cannot run deep must not be reported as a deployment that failed to arm one");
  assert.match(v.ja.why, /zh-only/);
});

test("asked full and NOTHING is established — the flag fires and `ran` is null, never candidates", () => {
  // Zero is not a pass, and it is not a downgrade either. "Could not establish that full ran" is not
  // "candidates ran", and reporting the second from the first is the original defect wearing a new
  // field name.
  const v = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ zh: laneAsking("full") }),
    slices: slicesWhere({ candidates: "not-established", serp: "not-established", native: "not-established" }),
  });
  assert.equal(v.zh.ran, null, "an unestablished depth must not be reported as candidates");
  assert.equal(v.zh.shortfall, true, "an absence does not discharge the flag");
  assert.equal(v.zh.cause, "not-established");
  assert.match(v.zh.why, /CANNOT be established/);
});

test("asked candidates and got candidates — no flag, whatever the arms did", () => {
  const off = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ zh: laneAsking("candidates") }),
    slices: slicesWhere({ serp: "not-armed", native: "not-armed" }),
  });
  assert.equal(off.zh.shortfall, false, "the customer asked for candidates; an unarmed deep slice is not a shortfall against that ask");
  // …and the mirror: an armed deployment giving MORE than the ask is not a shortfall either. It is also
  // the live billing edge the issue names — a `candidates` customer on an armed box gets the deep
  // slices anyway — which the ruling settles as flag-not-gate, so this must NOT start refusing.
  const on = deriveLaneDepthVerdicts({
    sidecar: sidecarWith({ zh: laneAsking("candidates") }),
    slices: slicesWhere({ serp: "ran", native: "ran" }),
  });
  assert.equal(on.zh.shortfall, false);
  assert.equal(on.zh.ran, "full", "what ran is still reported truthfully even when it exceeds the ask");
});

test("the verdict rides the REAL slice statement, not a hand-written one", () => {
  // Everything above feeds `deriveLaneDepthVerdicts` a literal. This drives it from the shipped
  // producer, so a change to deriveJxSliceStatement's output that the literals do not follow is caught.
  const sidecar = { lanes: { zh: laneAsking("full") }, fold: { lanes: { zh: { degraded: false } } } };
  const { slices } = deriveJxSliceStatement({ sidecar, units: null, env: { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1" }, causes: {} });
  const v = deriveLaneDepthVerdicts({ sidecar, slices });
  assert.equal(v.zh.asked, "full");
  assert.equal(v.zh.shortfall, true, "arms unset in this env ⇒ the deep slices did not run ⇒ the ask was not met");
  assert.equal(v.zh.cause, "requested-full-ran-candidates");
});

// ── THE SHAPE OF THE ARGUMENT, which is how this seam broke on a delivered report ───────────────────
//
// `deriveLaneDepthVerdicts` reads `slices.candidates`. `deriveJxSliceStatement` returns
// `{executes, slices}`. The publish path passed the whole return, so the lookup found nothing, every
// lane's `ran` came back null whatever it had done, and a full-country JP run that searched in Japanese
// printed "Local-language investigation · Not run this run" on the client's page. Nothing threw. The
// same run's stamped sidecar said `ran: "candidates"` — two authors for one fact, and the report used
// the wrong one.
test("the whole slice statement and its slices map are read the same way — neither is silently misread", () => {
  const sidecar = { lanes: { zh: laneAsking("full") }, fold: { lanes: { zh: { degraded: false } } } };
  const statement = deriveJxSliceStatement({ sidecar, units: null, env: {}, causes: {} });
  const fromStatement = deriveLaneDepthVerdicts({ sidecar, slices: statement });
  const fromMap = deriveLaneDepthVerdicts({ sidecar, slices: statement.slices });
  assert.deepEqual(fromStatement, fromMap, "the caller's shape cannot change the verdict");
  assert.equal(fromMap.zh.ran, "candidates", "and the verdict is what the lane delivered, not null");
});

// THE RUN THE OWNER'S READER MET (tracker issue 665, VENQORI full country JP, 2026-09-18): ONE asked
// lane, `ja`, for which this build carries no deep slice at all. The lane ran as the slice-1 candidate
// lane — which is everything `ja` ships as — and its shortfall is that `full` cannot be delivered for it
// by any environment. That is a shallow search, and the row must say so rather than say none ran.
test("a single lane that ran as deep as this build goes reads as shallow, never as not run", () => {
  const sidecar = { lanes: { ja: laneAsking("full") }, fold: { lanes: { ja: { degraded: false } } } };
  const v = deriveLaneDepthVerdicts({ sidecar, slices: deriveJxSliceStatement({ sidecar, units: null, env: {}, causes: {} }) });
  assert.equal(v.ja.ran, "candidates");
  assert.equal(v.ja.shortfall, true);
  assert.equal(v.ja.cause, "not-built-for-lane");
  assert.equal(localLanguageDepth(v).state, "ran-shallow",
    "the row a client reads: searched, and not as deeply as the matter asked for");
});

// ONE AUTHOR FOR ONE FACT. What the report prints is what the RUN stated, not what the publishing box
// re-derives — the arms are environment, so a later derivation speaks for a later box. Deriving stays
// only for an artifact delivered before the stamp existed.
test("a published report carries the run's own stated verdict, and derives only when there is none", () => {
  const stamped = { ja: { asked: "full", ran: "candidates", shortfall: true, cause: "not-built-for-lane", why: "no deep slice for ja" } };
  const sidecar = { lanes: { ja: laneAsking("full") }, fold: { lanes: { ja: { degraded: false } }, depth: stamped } };
  assert.deepEqual(laneDepthOfRun({ sidecar, units: null, env: {} }), stamped, "the stamp is read, not recomputed");

  // A pre-stamp artifact still gets the best answer its own record supports.
  const legacy = { lanes: { ja: laneAsking("full") }, fold: { lanes: { ja: { degraded: false } } } };
  const derived = laneDepthOfRun({ sidecar: legacy, units: null, env: {} });
  assert.equal(derived.ja.ran, "candidates");
  assert.equal(localLanguageDepth(derived).state, "ran-shallow");
});

// ── the reader half ─────────────────────────────────────────────────────────────────────────────────

test("readJxLanes carries the run's own verdict, and an artifact that never stated one SAYS SO", () => {
  const stated = readJxLanes({
    lanes: { zh: laneAsking("full") },
    fold: { lanes: { zh: { degraded: false, accepted: [] } },
      depth: { zh: { asked: "full", ran: "candidates", shortfall: true, cause: "requested-full-ran-candidates", why: "arms off" } } },
  });
  const zh = stated.lanes.find((l) => l.lane === "zh");
  assert.equal(zh.depth, "full", "the ask keeps its field and its name — a reader of an old artifact must still find it");
  assert.equal(zh.depthVerdict.recorded, true);
  assert.equal(zh.depthVerdict.ran, "candidates");
  assert.equal(zh.depthVerdict.shortfall, true);

  // A pre-change artifact. Three-valued on the record itself, the same discipline as `statement`: this is
  // an absence and it is stated as one. `shortfall: null`, never `false` — reporting "no shortfall" from
  // a run that never answered the question is precisely the zero-means-pass shape.
  const legacy = readJxLanes({ lanes: { zh: laneAsking("full") }, fold: { lanes: { zh: { degraded: false } } } });
  const old = legacy.lanes.find((l) => l.lane === "zh");
  assert.equal(old.depthVerdict.recorded, false);
  assert.equal(old.depthVerdict.shortfall, null, "an unanswered question must not read as a met ask");
  assert.match(old.depthVerdict.why, /CANNOT be established/);
});

// ── the client half ─────────────────────────────────────────────────────────────────────────────────

const FINDINGS_DOC = { schema_version: 2, findings: [], coverage: [{ area: "register / US", state: "confirmed-clean", note: "" }] };
const AREA = "Native-language investigation depth / zh";

function runWith(foldDepth) {
  const d = dir();
  const P = { findings: join(d, "findings.json") };
  writeFileSync(P.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  const dDir = driverDir(d);
  mkdirSync(dDir, { recursive: true });
  writeFileSync(join(dDir, "jx-lanes.json"), JSON.stringify({ lanes: { zh: laneAsking("full") }, fold: { depth: foldDepth } }));
  return { d, P };
}

test("a shortfall becomes a reader-visible coverage row — coverage-limited, never a clamp, idempotent", () => {
  const { d, P } = runWith({ zh: { asked: "full", ran: "candidates", shortfall: true,
    cause: "requested-full-ran-candidates", why: "asked for full and ran candidates only — serp-grid not-armed, nativeread not-armed" } });

  injectLaneDepthCoverage(P, d, () => {});
  const once = JSON.parse(readFileSync(P.findings, "utf8")).coverage;
  const rows = once.filter((c) => c.area === AREA);
  assert.equal(rows.length, 1, "the reader gets exactly one row for the lane");
  assert.equal(rows[0].state, "coverage-limited",
    "a disclosed limit — never the clamping `deferred`. The ruling is flag, not gate: no verdict moves on this row");
  assert.match(rows[0].note, /configured depth for this lane was `full`/);
  assert.match(rows[0].note, /the candidate lane only/);
  assert.match(rows[0].note, /not a change to any verdict/);
  assert.equal(once.length, 2, "the pre-existing coverage row is untouched");

  injectLaneDepthCoverage(P, d, () => {});
  assert.equal(JSON.parse(readFileSync(P.findings, "utf8")).coverage.filter((c) => c.area === AREA).length, 1,
    "idempotent on resume — a second delivery pass must not duplicate the disclosure");
});

test("no shortfall ⇒ no row, and an UNSTATED verdict ⇒ no row either", () => {
  const met = runWith({ zh: { asked: "full", ran: "full", shortfall: false, cause: null, why: null } });
  injectLaneDepthCoverage(met.P, met.d, () => {});
  assert.equal(JSON.parse(readFileSync(met.P.findings, "utf8")).coverage.some((c) => c.area === AREA), false,
    "a lane that met its ask owes no disclosure");

  // The reverse of zero-means-pass, and it is a real rule rather than a courtesy: a silence must not
  // MANUFACTURE a disclosure. This writer states a shortfall it can prove; an artifact that never
  // stated one is not evidence that anything fell short.
  const silent = runWith(undefined);
  injectLaneDepthCoverage(silent.P, silent.d, () => {});
  assert.equal(JSON.parse(readFileSync(silent.P.findings, "utf8")).coverage.some((c) => c.area === AREA), false,
    "an absent verdict must not invent a coverage row about a run that never answered");
});

test("never-kill: a corrupt findings.json is left byte-identical", () => {
  const { d, P } = runWith({ zh: { asked: "full", ran: "candidates", shortfall: true, cause: "requested-full-ran-candidates", why: "x" } });
  writeFileSync(P.findings, "{ not json");
  injectLaneDepthCoverage(P, d, () => {});
  assert.equal(readFileSync(P.findings, "utf8"), "{ not json", "any defect leaves findings.json untouched");
});

// ── the printed row, which is where the issue was actually READ ─────────────────────────────────────

test("the scorer's lane row no longer prints the ask as a bare `depth=` execution cell", () => {
  // A SOURCE-TEXT assertion, and it is the only kind available here: `scripts/` is not an npm workspace,
  // so neither `npm test` nor `npm run test:full` executes one line of score.mjs (scripts/README.md says
  // so in as many words). The row this issue quotes therefore had NO test of any kind on it, and a fix
  // that lived only in the driver would leave the surface the defect was observed on unguarded.
  const src = readFileSync(new URL("../../scripts/score.mjs", import.meta.url), "utf8");
  const at = src.indexOf("── the script-lane target");
  assert.ok(at > 0, "the script-lane block moved — this scan is measuring nothing, fix the scan");
  const block = src.slice(at, src.indexOf("#552", at));

  assert.doesNotMatch(block, /depth=\$\{/,
    "the lane row prints a bare `depth=` again — that cell is the frozen jxPolicy.laneDepth ASK sitting "
    + "one column from `executes`, which is the whole of #893");
  assert.match(block, /asked=/, "the row must name what was asked");
  assert.match(block, /ran=/, "…and what actually ran, beside it");
  assert.match(block, /depthVerdict/, "…read from the run's own recorded verdict, not re-derived on the scoring box");
});
