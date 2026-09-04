// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the unavailability veto runs LAST, and complete machine receipts out-rank prose.
//
// THE RUN THIS IS BUILT FROM. R5 (MERIDIAN THISTLE, worldwide Global preliminary — the
// product's first run ever, 2026-08-09) died terminal at `common-law-half:a` after 45 minutes with
// `declared_unavailable` / `terminalKind: repeat-signature`. Its findings file carried a COMPLETE grid:
// spec dictated, ledger written by the plugin, every cell joined. What killed it was one sentence of
// coverage-boundary prose:
//
//   "Perplexity searches returned mapped results to English-language sources; direct non-Latin script
//    marketplace presence unavailable at common-law layer. This is expected for non-Latin-script
//    register markets. Transliteration verification deferred to national register searches…"
//
// "Perplexity … unavailable" matches COMMONLAW_UNAVAILABLE_RE inside its 120-character window. Both
// call sites tested that phrase BEFORE reading any evidence, so the string out-ranked the receipts it
// was documented as standing behind. The retry hint tells a seat to write NO file when the tool is
// failing; the tool was not failing and the seat had results, so it honestly rewrote the same file and
// the ladder closed as a repeat signature. A worldwide search writes coverage-boundary prose about
// non-Latin-script markets BY CONSTRUCTION, so this arm made one product of four undeliverable.
//
// THE FIX IS AN ORDERING, NOT A LOOSENING. The honesty vocabulary is untouched — the prose is correct
// and stays. `declaredUnavailableGate` consults the phrase only when the evidence chain did not return
// `ok("machine-receipts")`, which is the exact join of the driver-dictated spec against the
// plugin-written ledger and the one thing in this file a model cannot fabricate.
//
// WHAT MUST NOT REGRESS: the 2026-05-23 hollow-report loophole. That fallback file carried no ledger,
// so it cannot reach `ok("machine-receipts")` and the veto still fails it with the same token.
//
// Run:  node --test driver/test/unavailable-veto-depth.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { validators } from "../verify.mjs";
import { MEANING_SEAT } from "../common-law-receipts.mjs";

// The R5 sentence, verbatim from common-law-findings.half-a.md on that run.
const R5_BOUNDARY_PROSE =
  "Perplexity searches returned mapped results to English-language sources; direct non-Latin script "
  + "marketplace presence unavailable at common-law layer. This is expected for non-Latin-script register "
  + "markets. Transliteration verification deferred to national register searches.";

// The 2026-05-23 hollow-report wording — a real give-up, and it must keep failing.
const GIVE_UP_PROSE = "Marketplace research could not be completed — Perplexity API unavailable. Partial results below.";

const PLATFORMS = ["store.steampowered.com", "play.google.com", "web"];
const TERMS = ["MERIDIAN THISTLE", "MERIDIAN THISTEL"];
const cells = (term) => PLATFORMS.map((platform) => ({ term, platform, status: "no_hit", results: [] }));
const ledger = (terms = TERMS) => JSON.stringify({ cells: terms.flatMap(cells), extras: {}, gaps: [] });

const findingsDoc = (tail = "") => [
  "# Common-law findings — MERIDIAN THISTLE", "",
  "## Findings — Mark: MERIDIAN THISTLE", "| Finding | Platform | URL |", "|---|---|---|", "",
  "### Negative results (per-platform per-variant)", "| Variant | Platform | Result |", "|---|---|---|",
  ...TERMS.flatMap((v) => PLATFORMS.map((pl) => `| ${v} | ${pl} | No results |`)), "",
  "### Coverage ledger", "| unit | status | reason |", "|---|---|---|",
  "| marketplace / all | confirmed-clean | full grid |", "",
  "### Audit trail", "| step | detail |", "|---|---|", "| grid | one call |", "",
  tail,
].join("\n");

/** A run dir whose canonical common-law grid is complete and machine-joined. */
function completeCanonicalRun(t) {
  const dir = mkdtempSync(join(tmpdir(), "veto-554-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "grid-spec.json"),
    JSON.stringify({ terms: TERMS, platforms: PLATFORMS, ledger_required: true }));
  writeFileSync(join(dir, "common-law-grid.json"), ledger());
  return { dir, path: join(dir, "common-law-findings.md") };
}

/** A run dir whose HALF grid is complete and machine-joined. */
function completeHalfRun(t, half = "a") {
  const dir = mkdtempSync(join(tmpdir(), "veto-554-half-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, `grid-spec.half-${half}.json`),
    JSON.stringify({ terms: TERMS, platforms: PLATFORMS, ledger_required: true }));
  writeFileSync(join(dir, `common-law-grid.half-${half}.json`), ledger());
  return { dir, path: join(dir, `common-law-findings.half-${half}.md`) };
}

// ── The defect itself ──────────────────────────────────────────────────────────────────────────────

test("#554 R5's shape: a canonical findings file with a COMPLETE grid is not vetoed by boundary prose", (t) => {
  const { path } = completeCanonicalRun(t);
  const doc = findingsDoc(R5_BOUNDARY_PROSE);
  const v = validators.commonLaw(path, doc);
  assert.deepEqual(v, { ok: true, reason: "machine-receipts" },
    "the grid ran and the ledger proves it — a sentence about coverage BOUNDARIES cannot unmake that");
});

test("#554 R5's actual seat: the same file as a grid HALF passes too — this is where R5 died", (t) => {
  const { path } = completeHalfRun(t, "a");
  const v = validators.commonLawHalf(path, findingsDoc(R5_BOUNDARY_PROSE));
  assert.deepEqual(v, { ok: true, reason: "machine-receipts" },
    "half:a is the seat that failed on R5 — with complete receipts its boundary prose must pass");
});

test("#554 the meaning seat is covered by the same gate", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "veto-554-m-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  const queries = ["MERIDIAN THISTLE slang meaning", "MERIDIAN THISTLE offensive"];
  writeFileSync(driverDir(dir, `grid-spec.half-${MEANING_SEAT}.json`),
    JSON.stringify({ terms: [], platforms: PLATFORMS, connotation: { queries } }));
  writeFileSync(join(dir, `common-law-grid.half-${MEANING_SEAT}.json`),
    JSON.stringify({ cells: [], extras: { pr_risk: queries.map((q) => ({ query: q, results: [] })) }, gaps: [] }));
  const doc = [
    "# Common-law meaning findings — MERIDIAN THISTLE", "",
    "## Findings — meaning sweep", "No adverse connotation surfaced.", "",
    "### Audit trail", "| step | detail |", "|---|---|", "| sweep | 2 queries |", "",
    R5_BOUNDARY_PROSE,
  ].join("\n") + "\n" + "x".repeat(200);
  const v = validators.commonLawHalf(join(dir, `common-law-findings.half-${MEANING_SEAT}.md`), doc);
  assert.deepEqual(v, { ok: true, reason: "machine-receipts" });
});

// ── What must not regress ──────────────────────────────────────────────────────────────────────────

test("#554 the 2026-05-23 hollow-report loophole stays closed — no ledger, so the veto still fires", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "veto-554-hollow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "common-law-findings.md");
  // Structurally complete-LOOKING prose, and no grid ledger anywhere — the exact hollow-report shape.
  const v = validators.commonLaw(path, findingsDoc(GIVE_UP_PROSE));
  assert.equal(v.ok, false);
  assert.equal(v.reason, "declared_unavailable",
    "a fallback file cannot reach machine-receipts, so the phrase still governs — with the SAME token, "
    + "so the ladder hint and the repeats classifier are unchanged");
});

test("#554 receipts INCOMPLETE + give-up wording still reports declared_unavailable, not the grid token", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  writeFileSync(join(dir, "common-law-grid.json"), ledger([TERMS[0]]));   // second term vanished
  const v = validators.commonLaw(path, findingsDoc(GIVE_UP_PROSE));
  assert.equal(v.ok, false);
  assert.equal(v.reason, "declared_unavailable",
    "when the evidence is short AND the file declares a dead layer, the declaration is the useful "
    + "diagnosis — the ladder's remedy for it is write-NO-file, which grid_join_missing would not reach");
});

test("#554 an incomplete grid WITHOUT the phrase keeps its own precise failure name", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  writeFileSync(join(dir, "common-law-grid.json"), ledger([TERMS[0]]));
  const v = validators.commonLaw(path, findingsDoc("Nothing adverse surfaced."));
  assert.equal(v.ok, false);
  assert.match(v.reason, /^grid_join_missing:/,
    "the gate must not mask a real evidence failure behind the veto's token");
});

test("#554 a structurally broken half with the phrase still fails, and a complete one never sees it", (t) => {
  const { path } = completeHalfRun(t, "b");
  // Structure gone (no negative-results / coverage-ledger / audit-trail sections) + the phrase.
  const broken = "# Common-law findings\n\n## Findings\n" + GIVE_UP_PROSE + "\n" + "x".repeat(200);
  assert.equal(validators.commonLawHalf(path, broken).reason, "declared_unavailable");
  // Same seat, same phrase family, complete evidence → passes.
  assert.equal(validators.commonLawHalf(path, findingsDoc(R5_BOUNDARY_PROSE)).ok, true);
});

// ── The discriminator is a grid that RAN, not a join that balanced (review of the first cut) ───────
//
// The first cut of this fix demoted the veto on `ok("machine-receipts")` alone. That was wrong.
// `parseGridLedger`'s docstring: "Cells and gaps both count as accounted grid entries", and
// common-law-receipts.test.mjs pins exactly that over a quarantined half. So the join proves every
// dictated cell is ACCOUNTED FOR, never that it RAN — and a ledger that is half gap rows clears it.

const gappedLedger = () => JSON.stringify({
  // Half the dictated grid executed; the rest carry real exception strings, which partition EXEMPT as
  // mechanical errors and are never re-run. This is the ordinary within-half gap shape.
  cells: cells(TERMS[0]),
  extras: {},
  gaps: PLATFORMS.map((pl) => `${TERMS[1]} | ${pl} | HTTPError: 503 upstream`),
});

test("#554 a GAPPED grid does not earn the demotion — the ledger corroborates the file, so it fails", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  writeFileSync(join(dir, "common-law-grid.json"), gappedLedger());
  // The join is satisfied — cells ∪ gaps covers every dictated cell — so the evidence chain returns
  // ok("machine-receipts"). The grid still only half ran.
  const v = validators.commonLaw(path, findingsDoc(GIVE_UP_PROSE));
  assert.equal(v.ok, false);
  assert.equal(v.reason, "declared_unavailable",
    "6 executed cells and 6 gap rows is a marketplace layer that did NOT run; the file says so, the "
    + "ledger agrees, and a corroborated declaration must fail — this is the hollow-report class");
});

test("#554 the same gapped ledger without the phrase is unchanged — no new failure is invented", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  writeFileSync(join(dir, "common-law-grid.json"), gappedLedger());
  assert.deepEqual(validators.commonLaw(path, findingsDoc("Nothing adverse surfaced.")),
    { ok: true, reason: "machine-receipts" },
    "the gap gate governs the VETO only — it must not become a second, silent coverage floor");
});

test("#554 zero gaps is the line, and R5's real ledger is on the passing side of it", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  // R5's half:a carried 217 cells and 0 gaps. One gap flips the verdict; that is the intended edge.
  writeFileSync(join(dir, "common-law-grid.json"),
    JSON.stringify({ cells: TERMS.flatMap(cells), extras: {}, gaps: [] }));
  assert.equal(validators.commonLaw(path, findingsDoc(R5_BOUNDARY_PROSE)).ok, true);
  writeFileSync(join(dir, "common-law-grid.json"),
    JSON.stringify({ cells: TERMS.flatMap(cells), extras: {}, gaps: [`${TERMS[0]} | web | TimeoutError`] }));
  assert.equal(validators.commonLaw(path, findingsDoc(R5_BOUNDARY_PROSE)).reason, "declared_unavailable");
});

test("#554 a batched (array) ledger is read for gaps too, not just a single object", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify([
    { cells: cells(TERMS[0]), extras: {}, gaps: [] },
    { cells: cells(TERMS[1]), extras: {}, gaps: [`${TERMS[1]} | web | HTTPError: 500`] },
  ]));
  assert.equal(validators.commonLaw(path, findingsDoc(GIVE_UP_PROSE)).reason, "declared_unavailable",
    "a gap in the SECOND batch must count — the ledger is a JSON array when the grid is batched");
});

test("#554 an unparseable ledger never reaches the gate at all — the evidence chain fails first", (t) => {
  const { dir, path } = completeCanonicalRun(t);
  writeFileSync(join(dir, "common-law-grid.json"), "truncated {");
  const v = validators.commonLaw(path, findingsDoc(GIVE_UP_PROSE));
  assert.equal(v.ok, false);
  // The evidence chain fails it `grid_ledger_unparseable`, and the veto then substitutes its own token
  // — which is what origin/main returned too, since there the phrase was tested first. No drift.
  assert.equal(v.reason, "declared_unavailable");
  // Stated precisely, because this test does NOT exercise gridRanWithoutGaps' catch arms: reaching them
  // requires `reason === "machine-receipts"`, and the chain only returns that after reading and parsing
  // this same ledger. Flipping either catch arm to `true` therefore leaves the whole suite green — a
  // break that stays green, recorded here and in the function's docstring rather than hidden behind an
  // assertion that would pass for the wrong reason.
  writeFileSync(join(dir, "common-law-grid.json"), "truncated {");
  assert.equal(validators.commonLaw(path, findingsDoc("Nothing adverse surfaced.")).reason.split(":")[0],
    "grid_ledger_unparseable", "and without the phrase the parse failure is the diagnosis, unmasked");
});

// ── Driver-bug tokens are never masked ─────────────────────────────────────────────────────────────

test("#554 half_path_unrecognized survives the gate — a driver bug is not a write-NO-file remedy", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "veto-554-path-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A path commonLawHalf does not own, plus the give-up phrase. Pre- the path guard returned first.
  const v = validators.commonLawHalf(join(dir, "common-law-findings.md"), findingsDoc(GIVE_UP_PROSE));
  assert.equal(v.reason, "half_path_unrecognized",
    "the veto must not overwrite a token that says the DRIVER called the wrong validator");
});

// ── The discriminator is `machine-receipts`, not `ok` ──────────────────────────────────────────────

test("#554 the legacy prose path does NOT license the veto's demotion", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "veto-554-legacy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "common-law-findings.md");
  // No grid spec and no variant manifest: commonLawEvidence returns a BARE ok() having verified no
  // receipts at all. That is not evidence, so the phrase must still govern. This is the arm that keeps
  // the gate honest — widening it to any `ok` would reopen the 2026-05-23 loophole on every legacy run.
  assert.equal(validators.commonLaw(path, findingsDoc(GIVE_UP_PROSE)).reason, "declared_unavailable");
  assert.equal(validators.commonLaw(path, findingsDoc("Nothing adverse surfaced.")).ok, true,
    "and a clean legacy file still passes — the demotion is the only behaviour that moved");
});
