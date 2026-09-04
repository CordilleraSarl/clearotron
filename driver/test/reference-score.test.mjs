// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The reference scorer — four axes, four buckets, and the separation that decides where a fix goes.
//
// FIXTURES ARE REAL. The band records below are byte-copied from `recall-reconciliation.test.mjs`,
// which took them verbatim from the 2026-07-29 evidence run's `register-named-band.json` (register
// records are public data; that file's header states the redaction it applied). TIKI TWIST and TIKI
// TROPICS are the actual pair that sat in a run's own retrieved records and never reached its findings
// — the incident this scorer exists to make visible. Inventing a fixture here would certify the bug.
//
// WHAT IS SYNTHETIC, AND WHY THE LINE IS THERE. The register records are real and stay real — a fixture
// invented to match the reader's idea of a band record certifies the bug. The MARK NAMES used to exercise
// the pure string rules are synthetic (`ZORVYS`/`ZORVIS`, `E2E … PROBE`), because those rules are string
// logic and gain nothing from a real name, while every real name is a client identifier this repo is
// de-identified against. Names already carried by `origin/main` are reused rather than re-minted; names
// that would be NEW to the repo are not introduced, and the guard in `no-client-identifiers.test.mjs` is
// a blocklist that cannot catch the next one, so this is a rule to follow rather than a test to lean on.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { ownersMatch,
  matchesReference, labelTokens, inScope, scoreRecall, scoreField, scoreSources,
  scoreGapDiscipline, bucketDelta, validateReference, REFERENCE_SCHEMA_VERSION, canonTerritory, ownerName,
  readVerdict, evidenceClassOf, satisfiesReference, SCORER_VERSION, scoreStatements, marksNamedIn } from "../reference-score.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

// ── verbatim retrieved records (register-named-band.json, evidence run) ───────────────────────────
const RETRIEVED = [
  { mark: "TIKI", record_id: "/mark/us/USAFI4B8B404C89E311EABDF6005056B74373" },
  { mark: "TIKI TWIST", record_id: "/mark/us/USAFI1DD680D901A311F1974020677C5FC470" },
  { mark: "TIKITONK", record_id: "/mark/us/USAFIC10EEC5A3BF911EE957D20677C5FC470" },
  { mark: "TIKI TROPICS", record_id: "/mark/us/USAFI160A07CD5BC111E5A6A9D3849796FD22" },
];

// The reference's register table, in scope order.
const R3_REGISTER = [
  { mark: "TIKI", owner: "Tiki Corporation", classes: [32], on_field: true },
  { mark: "TIKI PUNCH", owner: "Shasta Beverages", classes: [32] },
  { mark: "TIKI TROPICS", owner: "Sunny Sky Products", classes: [32] },
  { mark: "TIKI TWIST", classes: [32] },
  { mark: "TIKITONK", owner: "Tiki Tonkin", classes: [32] },
  { mark: "E2E LOST PROBE", classes: [32] },
];

// ── matching on stem, not label ───────────────────────────────────────────────────────────────────

test("the relabelling that an exact diff misreads as a drop plus a find", () => {
  // One round relabelled a mark to a three-name composite. Same mark, different label.
  assert.equal(matchesReference("ZORVIL", "ZORVIL / ZORVILMONO / ZORVILKOMB"), "alias");
  assert.equal(matchesReference("ZORVIL DIAGNOSTICS", "ZORVIL DIAGNOSTICS, INC."), "alias");
});

test("corporate suffixes are not distinctive and never decide a match", () => {
  assert.deepEqual(labelTokens("Sunny Sky Products, LLC"), ["sunny", "sky", "products"]);
  assert.deepEqual(labelTokens("ZORVIL / & Device"), ["zorvil"]);
});

test("a non-Latin mark is matched on the script, not on an empty normalization", () => {
  // normalizeElement keeps only [a-z0-9], so CJK folds to "". If the token rules ran on that, the one
  // mark R1's jx lane exists to generate would match EVERYTHING and score as a find it never made.
  assert.equal(matchesReference("星光", "星光"), "script");
  assert.equal(matchesReference("星光", "星火"), null, "a near-miss glyph is a different mark — the shape of the known jx failure");
  assert.equal(matchesReference("星光", "TIKI"), null, "and it must not match an unrelated Latin mark");
});

test("a short token cannot match everything", () => {
  assert.equal(matchesReference("CORAL FREEZE", "TIKI PUNCH"), null, "SLUSH is absent, so this is a different mark");
  assert.equal(matchesReference("TIKI TWIST", "TIKI-TWIST"), "alias", "punctuation is not a difference");
});

test("near-spellings reach each other through the consonant skeleton", () => {
  assert.equal(matchesReference("ZORVYS", "ZORVIS"), "skeleton", "the one-vowel spelling pair a variant sweep must not split");
  assert.equal(matchesReference("ZORVYS", "ZORVIL"), null, "a different consonant is a different mark");
});

// ── the buckets ───────────────────────────────────────────────────────────────────────────────────

test("withheld is separated from lost — the whole reason this exists", () => {
  // The run rated TIKI, dropped TIKI TWIST and TIKI TROPICS despite holding both, and never retrieved
  // TIKI PUNCH or the probe entry at all. Three different defects, three different fixes.
  const findings = [{ mark: "TIKI", owner: "Tiki Corporation", disposition: "adversarial" }];
  const b = scoreRecall({ reference: R3_REGISTER, findings, retrieved: RETRIEVED, scopeClasses: ["32"] });

  assert.deepEqual(b.found.map((r) => r.mark), ["TIKI"]);
  assert.deepEqual(b.withheld.map((r) => r.mark).sort(), ["TIKI TROPICS", "TIKI TWIST", "TIKITONK"]);
  assert.deepEqual(b.lost.map((r) => r.mark).sort(), ["E2E LOST PROBE", "TIKI PUNCH"]);
  // The withheld rows carry the record that proves the run held it. Without that the row is an assertion.
  assert.match(b.withheld.find((r) => r.mark === "TIKI TWIST").record, /^\/mark\/us\//);
});

test("a proprietor's own record with a leading element is withheld, not 'never retrieved'", () => {
  // THE SHAPE IS REAL, THE NAMES ARE NOT. Observed on the 2026-08-12 R2 round: a gold entry whose
  // proprietor's record sat in the run's own `register-named-band.json` under a mark text carrying a
  // leading initialism scored `lost` — "never retrieved" — about a record the run demonstrably held.
  // The found and noise loops both pass `sameOwner`; the withheld lookup did not, and that asymmetry
  // alone decided the bucket. Names reused from this file rather than re-minted, per the header rule.
  const reference = [
    { mark: "TIKI PUNCH", owner: "Shasta Beverages", classes: [32] },
    { mark: "CORAL FREEZE", owner: "Shasta Beverages", classes: [32] },
  ];
  const retrieved = [{ mark: "SB TIKI PUNCH", owner: "Shasta Beverages, LLC",
    record_id: "/mark/us/USAFI1DD680D901A311F1974020677C5FC470" }];
  const b = scoreRecall({ reference, findings: [], retrieved, scopeClasses: ["32"] });

  assert.deepEqual(b.withheld.map((r) => r.mark), ["TIKI PUNCH"], "the held record is withheld");
  assert.equal(b.withheld[0].rule, "contained", "and the row names the rule that reached it");
  assert.match(b.withheld[0].record, /^\/mark\/us\//, "carrying the record that proves the run held it");

  // THE GUARD THAT MAKES THE RELAXATION SAFE. Same proprietor, genuinely different mark: still lost.
  // Without this the fix would manufacture recall out of any record its owner happened to also hold.
  assert.deepEqual(b.lost.map((r) => r.mark), ["CORAL FREEZE"]);
});

test("owner agreement is REQUIRED for that relaxation — an absent owner keeps the strict test", () => {
  // `ownersMatch` is fail-closed, and the whole safety of the rule above rests on it. A retrieved corpus
  // with no owner column (every fixture in this file predating it, and any band that does not record
  // one) must score exactly as it did before, or the fix quietly rewrites history it was never shown.
  const reference = [{ mark: "TIKI PUNCH", owner: "Shasta Beverages", classes: [32] }];
  const noOwner = scoreRecall({ reference, findings: [],
    retrieved: [{ mark: "SB TIKI PUNCH", record_id: "/mark/us/USAFI1DD680D901A311F1974020677C5FC470" }],
    scopeClasses: ["32"] });
  assert.deepEqual(noOwner.withheld, [], "no owner on the record, so no relaxation");
  assert.deepEqual(noOwner.lost.map((r) => r.mark), ["TIKI PUNCH"]);
});

test("a register-only run collapses withheld and says so, rather than reporting zero", () => {
  const findings = [{ mark: "TIKI" }];
  const b = scoreRecall({ reference: R3_REGISTER, findings, retrieved: RETRIEVED, scopeClasses: ["32"],
    registerOnly: true, collapseReason: "register-only run: no gather/judgment seam to measure" });
  assert.equal(b.withheld.length, 0);
  assert.equal(b.lost.length, 5, "everything unfound is lost on this lane");
  for (const r of b.lost) assert.match(r.why, /register-only/, "and every row says why it cannot be withheld");
});

test("the collapse names the ACTUAL cause, not whichever one was hardcoded", () => {
  // `registerOnly` is set by two different situations: a knockout lane with no seam, and a run dir with no
  // `_driver/` and so no retrieved corpus. A row that blames the wrong one tells the reader the lane was
  // register-only when it was not — which sends them to the wrong artifact to check.
  const noDriver = scoreRecall({ reference: R3_REGISTER, findings: [], retrieved: [], scopeClasses: ["32"],
    registerOnly: true, collapseReason: "withheld NOT COMPUTED — this run dir has no _driver/" });
  for (const r of noDriver.lost) {
    assert.match(r.why, /no _driver/);
    assert.doesNotMatch(r.why, /register-only/, "must not claim a lane it cannot know about");
  }
  // And with no reason given it says it could not compute, rather than inventing one.
  const bare = scoreRecall({ reference: R3_REGISTER, findings: [], retrieved: [], scopeClasses: ["32"], registerOnly: true });
  for (const r of bare.lost) assert.match(r.why, /could not be computed/);
});

test("out-of-scope reference entries are excluded and listed, never scored as lost", () => {
  // The R2 rule: the scenario runs 5/42/44, and gold entries reaching only class 1 or 45 are excluded.
  const reference = [
    { mark: "ZORVIL DIAGNOSTICS", classes: [5, 42] },
    { mark: "A CLASS-1 ONLY MARK", classes: [1] },
    { mark: "A CLASS-45 ONLY MARK", classes: [45] },
  ];
  const b = scoreRecall({ reference, findings: [], retrieved: [], scopeClasses: ["5", "42", "44"] });
  assert.deepEqual(b.lost.map((r) => r.mark), ["ZORVIL DIAGNOSTICS"]);
  assert.equal(b.excluded.length, 2);
  for (const r of b.excluded) assert.match(r.why, /outside the run's/);
});

test("territory is scoped like class — an out-of-territory entry is excluded, not lost", () => {
  // R1's reference names filings in FR, IN, DE and TW while the run is instructed to seven other
  // territories. Five of fifteen entries. Scoring those as `lost` would report a scope decision as a
  // recall defect, which is the difference between a bad round and a fine one.
  const reference = [
    { mark: "IN SCOPE MARK", jurisdictions: ["EU", "UK"] },
    { mark: "OUT OF TERRITORY MARK", jurisdictions: ["FR"] },
    { mark: "PORTFOLIO WIDE MARK", jurisdictions: ["intl"] },
    { mark: "NO TERRITORY STATED" },
  ];
  const b = scoreRecall({ reference, findings: [], retrieved: [], scopeTerritories: ["CN", "RU", "NZ", "PH", "EU", "UK", "US"] });
  assert.deepEqual(b.excluded.map((r) => r.mark), ["OUT OF TERRITORY MARK"]);
  assert.match(b.excluded[0].why, /territories FR outside/);
  // `intl` matches nothing, so a portfolio-wide entry is never excluded on territory — it stays scorable.
  assert.deepEqual(b.lost.map((r) => r.mark).sort(), ["IN SCOPE MARK", "NO TERRITORY STATED", "PORTFOLIO WIDE MARK"]);
});

test("the lawyer's own territory spellings compare against instructed codes", () => {
  assert.equal(canonTerritory("FR (appl.)"), "FR");
  assert.equal(canonTerritory(" us "), "US");
  assert.equal(canonTerritory("intl"), null, "matches nothing rather than everything");
  assert.equal(canonTerritory("worldwide"), null);
  assert.equal(inScope({ mark: "X", jurisdictions: ["FR (appl.)"] }, [], ["FR"]), true);
  assert.equal(inScope({ mark: "X", jurisdictions: ["TW / intl"] }, [], ["CN"]), false, "TW is named and is not CN");
});

test("class and territory are both required, not either", () => {
  const e = { mark: "X", classes: [9], jurisdictions: ["EU"] };
  assert.equal(inScope(e, ["9"], ["EU"]), true);
  assert.equal(inScope(e, ["32"], ["EU"]), false, "wrong class");
  assert.equal(inScope(e, ["9"], ["US"]), false, "wrong territory");
});

test("noise is what the reference does not contain, and it is reported neutrally", () => {
  const findings = [{ mark: "TIKI" }, { mark: "E2E NOISE PROBE", owner: null, band: { label: "Medium" } }];
  const b = scoreRecall({ reference: R3_REGISTER, findings, retrieved: RETRIEVED, scopeClasses: ["32"] });
  assert.deepEqual(b.noise.map((r) => r.mark), ["E2E NOISE PROBE"]);
  // NO VERDICT WORD ANYWHERE ON THE ROW. It may be a genuine find.
  //
  // This was a frozen key list — `["band", "mark", "owner"]` — until gave every findings-built row
  // a `subject` (the mark the batch was searching when it surfaced this). A frozen list states the
  // property by accident: it goes red for a neutral field and would have stayed green for a judgemental
  // one added in place of an existing key. So it states the property directly, over keys AND values, and
  // pins the two fields the row is actually read for.
  const row = b.noise[0];
  for (const k of ["mark", "owner", "band", "subject"]) assert.ok(k in row, `the row carries ${k}`);
  for (const [k, v] of Object.entries(row)) {
    assert.doesNotMatch(k, /verdict|risk|wrong|bad|score|grade|severity|false/i, `judgemental key on a noise row: ${k}`);
    assert.doesNotMatch(String(v ?? ""), /\b(false positive|wrong|incorrect|junk|invalid)\b/i, `judgemental value on ${k}`);
  }
});

test("a client-pre-accepted mark is `additional`, never noise", () => {
  // The R2 reference states this explicitly: four marks the client had already accepted before the
  // search. A run surfacing one did the right thing. Scoring it as noise penalises a correct find and
  // teaches the next round to suppress it.
  const findings = [{ mark: "E2E PREACCEPTED PROBE", owner: null }, { mark: "E2E NOISE PROBE", owner: null }];
  const b = scoreRecall({
    reference: R3_REGISTER, findings, retrieved: RETRIEVED, scopeClasses: ["32"],
    preAccepted: [{ mark: "E2E PREACCEPTED PROBE", why: "accepted by the client before the search" }],
  });
  assert.deepEqual(b.additional.map((r) => r.mark), ["E2E PREACCEPTED PROBE"]);
  assert.deepEqual(b.noise.map((r) => r.mark), ["E2E NOISE PROBE"], "and it does not swallow real noise");
  assert.match(b.additional[0].why, /accepted by the client/, "the row carries why it is not noise");
});

test("with no pre-accepted list, nothing lands in additional", () => {
  const b = scoreRecall({ reference: R3_REGISTER, findings: [{ mark: "E2E NOISE PROBE" }], retrieved: RETRIEVED, scopeClasses: ["32"] });
  assert.deepEqual(b.additional, []);
  assert.deepEqual(b.noise.map((r) => r.mark), ["E2E NOISE PROBE"]);
});

test("a found mark is not also counted as noise", () => {
  const findings = [{ mark: "TIKI TWIST" }];
  const b = scoreRecall({ reference: R3_REGISTER, findings, retrieved: RETRIEVED, scopeClasses: ["32"] });
  assert.equal(b.noise.length, 0);
  assert.deepEqual(b.found.map((r) => r.mark), ["TIKI TWIST"]);
});

test("inScope treats a reference entry naming no classes as in scope", () => {
  assert.equal(inScope({ mark: "X" }, ["32"]), true);
  assert.equal(inScope({ mark: "X", classes: [] }, ["32"]), true);
  assert.equal(inScope({ mark: "X", classes: [1] }, ["32"]), false);
  assert.equal(inScope({ mark: "X", classes: [1] }, []), true, "no recorded scope cannot exclude anything");
});

// ── axis B, C, D ──────────────────────────────────────────────────────────────────────────────────

test("axis B catches a mis-grouping, which is not the same defect as a miss", () => {
  const reference = [{ mark: "ZORVIL", owner: "E2E Field Holdings", on_field: true }];
  const off = scoreField({ reference, findings: [{ mark: "ZORVIL", disposition: "off-field" }] });
  assert.equal(off[0].state, "off-field");
  const on = scoreField({ reference, findings: [{ mark: "ZORVIL", disposition: "adversarial" }] });
  assert.equal(on[0].state, "on-field");
  const ruled = scoreField({ reference, findings: [{ mark: "ZORVIL", ruled_out: true, ruled_out_reason: "genre neighbour" }] });
  assert.equal(ruled[0].state, "ruled-out");
  const gone = scoreField({ reference, findings: [] });
  assert.equal(gone[0].state, "not-surfaced", "a mark that never surfaced cannot be scored on field");
});

test("axis B scores only what the reference declares on-field — silence is not a pass", () => {
  assert.deepEqual(scoreField({ reference: [{ mark: "X" }], findings: [{ mark: "X" }] }), []);
});

test("axis C reports an unsearched channel as absent", () => {
  const s = scoreSources({
    channels: ["github.com", "store.steampowered.com", "amazon.com"],
    searchedText: `{"platforms":["amazon.com","walmart.com"]}`,
  });
  assert.deepEqual(s, [
    { channel: "github.com", searched: false },
    { channel: "store.steampowered.com", searched: false },
    { channel: "amazon.com", searched: true },
  ]);
});

test("axis D catches the one combination it exists for: a gap left open beside a clean verdict", () => {
  const gaps = [{ item: "US wildcard slice", status: "deferred", reason: "crowd too large" }];
  assert.equal(scoreGapDiscipline({ gaps, verdictIsClean: true }).rows[0].state, "open-and-clean");
  assert.equal(scoreGapDiscipline({ gaps, verdictIsClean: false }).rows[0].state, "open-and-blocking");
  // An unread verdict must not be reported as blocking — that is the reassuring reading of the pair.
  assert.equal(scoreGapDiscipline({ gaps, verdictIsClean: null }).rows[0].state, "open-verdict-unread");
  assert.equal(scoreGapDiscipline({ gaps: [{ item: "x", status: "closed" }], verdictIsClean: true }).rows[0].state, "closed");
});

test("no declared gap is a fact about the run, not a pass", () => {
  assert.equal(scoreGapDiscipline({ gaps: [], verdictIsClean: true }).state, "none-declared");
});

// ── the delta ─────────────────────────────────────────────────────────────────────────────────────

test("the delta names what moved between rounds, in both directions", () => {
  const before = scoreRecall({ reference: R3_REGISTER, findings: [{ mark: "TIKI" }], retrieved: RETRIEVED, scopeClasses: ["32"] });
  const after = scoreRecall({
    reference: R3_REGISTER, findings: [{ mark: "TIKI" }, { mark: "TIKI TWIST" }],
    retrieved: RETRIEVED, scopeClasses: ["32"],
  });
  const moved = bucketDelta(after, before);
  assert.deepEqual(moved, [{ mark: "TIKI TWIST", from: "withheld", to: "found" }]);
  assert.equal(bucketDelta(after, null), null, "no previous round means no delta, not an empty one");
});

// ── the reference contract ────────────────────────────────────────────────────────────────────────

test("a malformed reference refuses rather than reading as a clean sweep", () => {
  assert.deepEqual(validateReference({ schema_version: REFERENCE_SCHEMA_VERSION, scenario: "R3", source: "x", register: [{ mark: "TIKI" }] }), []);
  assert.ok(validateReference({}).length);
  assert.match(validateReference({ schema_version: 99, scenario: "R3", source: "x", register: [{ mark: "T" }] }).join(" "), /schema_version/);
  assert.match(validateReference({ schema_version: 1, scenario: "R3", register: [{ mark: "T" }] }).join(" "), /no `source`/);
  assert.match(validateReference({ schema_version: 1, scenario: "R3", source: "x", register: [] }).join(" "), /non-empty array/);
  assert.match(validateReference({ schema_version: 1, scenario: "R3", source: "x", register: [{ owner: "x" }] }).join(" "), /has no `mark`/);
});

// ── end to end through the CLI ────────────────────────────────────────────────────────────────────

// — carries a `counts` block, because two of the CLI cases below drive a KNOCKOUT run and the
// scorer now refuses that lane against a similar-marks sheet alone. Their subjects are the lane read and
// the verdict line, so the block is scaffolding that lets those assertions be reached; the refusal
// itself is asserted in reference-score-mark-coverage.test.mjs and reference-score-counts.test.mjs.
function makeReference(dir, extra = {}) {
  mkdirSync(join(dir, "baselines"), { recursive: true });
  writeFileSync(join(dir, "baselines", "R3.gold.json"), JSON.stringify({
    schema_version: 1, scenario: "R3", mark: "E2E SCORER PROBE",
    source: "fixture — shapes from the 2026-07-29 evidence run",
    scope: { classes: [32] }, register: R3_REGISTER, channels: ["amazon.com", "github.com"],
    counts: [{ mark: "E2E SCORER PROBE", classes: [32], identical: { min: 0, max: 50 } }],
    ...extra,
  }, null, 2));
  return dir;
}

function makeRun({ withDriver = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "score-run-"));
  writeFileSync(join(dir, "findings.json"), JSON.stringify({
    schema_version: 5, findings: [{ ordinal: 1, mark: "TIKI", owner: "Tiki Corporation", disposition: "adversarial", band: { label: "Medium" } }],
  }));
  writeFileSync(join(dir, "register-named-band.json"), JSON.stringify({
    enumerated: RETRIEVED.map((r) => ({ mark_text: r.mark, record_id: r.record_id, classes: [32] })), crowds: [],
  }));
  if (withDriver) {
    mkdirSync(driverDir(dir));
    writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ classes: [32], jurisdictions: ["US"] }));
    writeFileSync(driverDir(dir, "verdict.json"), JSON.stringify({ tier: "MODERATE", statement: "conflicts identified" }));
    writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({ platforms: ["amazon.com"] }));
  }
  return dir;
}

const cli = (args, env = {}) => {
  const r = spawnSync("node", [SCORE, ...args], { encoding: "utf8", env: { ...process.env, CLEAROTRON_E2E_DIR: "", ...env } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

test("it prints the axes and the buckets, prints no PASS, and exits 0", () => {
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")));
  const run = makeRun();
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    for (const s of ["buckets", "axis B · field", "axis C · sources", "axis D · gap discipline", "delta"]) {
      assert.ok(out.includes(s), `prints ${s}`);
    }
    assert.match(out, /withheld\s+3/, "the three withheld marks are counted");
    assert.match(out, /TIKI TWIST/, "and named");
    assert.match(out, /ABSENT\s+github\.com/, "the unsearched channel is named");
    // The house rule: no verdict word is ever REPORTED. The disclaimer says the word in order to deny
    // it, so match on lines rather than on the whole output — a substring check would be satisfied by
    // deleting the disclaimer, which is the opposite of what this defends.
    for (const line of out.split("\n")) {
      if (/no PASS here|never a target|not a pass|not passed/i.test(line)) continue;   // denials, not verdicts
      assert.doesNotMatch(line, /\b(PASS|FAIL|PASSED|FAILED|grade|score:)\b/i, `verdict word reported: ${line}`);
    }
    assert.match(out, /no PASS here and the exit code is always 0/, "and it says so out loud");
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("exit 0 even when the comparison is unfavourable — the exit code carries no judgement", () => {
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")), { register: R3_REGISTER.map((r) => ({ ...r })) });
  const run = mkdtempSync(join(tmpdir(), "score-run-"));
  // A run that found nothing at all.
  writeFileSync(join(run, "findings.json"), JSON.stringify({ schema_version: 5, findings: [] }));
  mkdirSync(driverDir(run));
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, "a bad result is still exit 0");
    assert.match(out, /lost\s+6/);
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("a pool dir has no retrieved corpus, so it says withheld was NOT COMPUTED", () => {
  // The trap: without `_driver/` every withheld mark would report as `lost` and send the fix to variant
  // generation, which was working. `withheld: 0` and "not computed" must never look the same.
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")));
  const run = makeRun({ withDriver: false });
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.match(out, /NOT COMPUTED/);
    assert.match(out, /no _driver\//);
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("no CLEAROTRON_E2E_DIR means no reference, and no synthetic fallback is invented", () => {
  const run = makeRun();
  try {
    const { code, out } = cli(["R3", "--run", run]);
    assert.equal(code, 2);
    assert.match(out, /CLEAROTRON_E2E_DIR is unset/);
    assert.match(out, /no bundled fallback/, "and it says why there is none");
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("a missing gold set names the path it looked for", () => {
  const store = mkdtempSync(join(tmpdir(), "score-store-"));
  mkdirSync(join(store, "baselines"));
  const run = makeRun();
  try {
    const { code, out } = cli(["R9", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 2);
    assert.match(out, /R9\.gold\.json/);
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("the knockout lane is read from its own artifact, not reported as an empty clearance", () => {
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")));
  const run = mkdtempSync(join(tmpdir(), "score-run-"));
  writeFileSync(join(run, "knockout-findings.json"), JSON.stringify({
    schema_version: 1,
    marks: [{ name: "E2E SCORER PROBE", findings: [{ name: "TIKI", type: "Registration", impact: "HIGH" }] }],
  }));
  mkdirSync(driverDir(run));
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.match(out, /lane:\s+knockout/);
    assert.match(out, /register-only run: no gather\/judgment seam/);
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

// ── · the owner column in the buckets a human actually reads ───────────────────────────────────
//
// ADDITIONAL and NOISE printed `[object Object]` where the owner should be, while LOST and WITHHELD
// printed it fine in the same run. Not a per-bucket renderer — there is only one — but a per-bucket
// SOURCE: gold entries carry owner as a lawyer-typed string, run findings carry the typed object
// { name, country, registrations }, and the buckets built from run findings are exactly those two.
//
// It matters because the owner is the part of a NOISE row that answers the question the bucket exists
// to pose: genuine find, or false positive? A bucket whose most decision-relevant column is unreadable
// quietly teaches the reader to skip it, and NOISE is the one the tool says not to skip.

test("#346: ownerName reads the typed object, the legacy string, and refuses to invent one", () => {
  assert.equal(ownerName({ name: "E2E Field Holdings", country: "CH", registrations: [] }), "E2E Field Holdings");
  assert.equal(ownerName("E2E Field Holdings"), "E2E Field Holdings", "a preserved run older than the typed shape still reads");
  assert.equal(ownerName("  padded  "), "padded");
  for (const empty of [null, undefined, "", "   ", {}, { name: "" }, { name: "  " }, { name: 7 }, []]) {
    assert.equal(ownerName(empty), null, `no owner is null, never a stringified shape: ${JSON.stringify(empty)}`);
  }
});

test("#346: a NOISE row prints its owner's NAME — end to end through the real CLI", () => {
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")));
  const run = mkdtempSync(join(tmpdir(), "score-run-"));
  // The owner shape a real clearance run writes: the object, not a string.
  writeFileSync(join(run, "findings.json"), JSON.stringify({
    schema_version: 5,
    findings: [{ ordinal: 1, mark: "E2E NOISE PROBE", disposition: "adversarial", band: { label: "Medium" },
      owner: { name: "E2E Field Holdings", country: "CH", registrations: [] } }],
  }));
  mkdirSync(driverDir(run));
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.ok(!out.includes("[object Object]"), "the defect, stated as the whole output: no stringified shape anywhere");
    const row = out.split("\n").find((l) => l.includes("E2E NOISE PROBE"));
    assert.ok(row, `the noise row is printed\n${out}`);
    assert.match(row, /E2E Field Holdings/, "and it names the owner, which is what the row is read for");
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

// ──: the verdict is readable on BOTH lanes ───────────────────────────────────────────────────────
//
// `_driver/verdict.json` is a clearance-lane artifact. Pointed at the knockout lane it read null, and the
// scorer printed `verdict: (unreadable)` for every knockout run ever scored — an absence rendered as an
// empty parenthesis, which is the shape a reader skims past. Same defect class as the wildcard assert:
// a check written against one lane's artifacts, aimed at a lane that does not write them.
//
// Shapes are real: the clearance verdict fields are the ones the printer already joined, and the knockout
// pair is what a delivered knockout-register run writes (status.verdict = the worst band, marks[] each
// with rating + ratingQualifier). Mark names are the suite's synthetic probes per this file's header.

test("#324: the knockout lane's verdict is read from the artifacts that lane actually writes", () => {
  const v = readVerdict({
    verdictDoc: null,
    status: { verdict: "Medium", state: "delivered" },
    knockoutFindings: { marks: [{ name: "E2E SCORER PROBE", rating: "Medium", ratingQualifier: "low" }] },
  });
  assert.equal(v.clean, false, "a Medium band is not a clean verdict");
  assert.match(v.text, /worst band Medium/);
  assert.match(v.text, /E2E SCORER PROBE: Medium \(low\)/, "the per-mark rating is what the band actually was");
  assert.match(v.source, /knockout-findings\.json/, "the read is attributable to an artifact");
  assert.equal(v.why, null);
});

test("#324: the clearance lane is unchanged — verdict.json still wins and still decides clean", () => {
  const clean = readVerdict({ verdictDoc: { tier: "l3", verdict: "CONDITIONAL", statement: "no material conflict identified" } });
  assert.equal(clean.clean, true, "the existing vocabulary still decides");
  assert.equal(clean.source, "_driver/verdict.json");
  const blocking = readVerdict({ verdictDoc: { tier: "l4", verdict: "CONDITIONAL", statement: "High risk on the primary axis" } });
  assert.equal(blocking.clean, false);
  // And it wins over the knockout fallback when both are somehow present — one lane, one answer.
  const both = readVerdict({
    verdictDoc: { tier: "l3", verdict: "CONDITIONAL", statement: "no material conflict identified" },
    status: { verdict: "High" }, knockoutFindings: { marks: [{ name: "X", rating: "High" }] },
  });
  assert.equal(both.source, "_driver/verdict.json");
});

test("#324: an unreadable verdict stays THREE-valued and carries the reason, never a bare blank", () => {
  const none = readVerdict({});
  assert.equal(none.clean, null, "null is 'could not be read', which is not 'not clean'");
  assert.equal(none.text, null);
  assert.ok(none.why && none.why.length > 20, `the reason is stated: ${none.why}`);
  assert.match(none.why, /knockout/, "and it names both lanes, so the reader knows what was looked for");
  // A verdict doc present but empty is its own cause, and says so rather than borrowing the other one.
  const empty = readVerdict({ verdictDoc: { schema: 1 } });
  assert.equal(empty.clean, null);
  assert.match(empty.why, /carries no tier/);
  // Unrated marks are not a verdict either — an empty marks[] must not read as a clean sweep.
  assert.equal(readVerdict({ knockoutFindings: { marks: [] } }).clean, null);
});

test("#324: a knockout run scored through the real CLI prints its verdict instead of (unreadable)", () => {
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")));
  const run = mkdtempSync(join(tmpdir(), "score-run-"));
  writeFileSync(join(run, "knockout-findings.json"), JSON.stringify({
    schema_version: 1,
    batch: { executiveSummary: "E2E SCORER PROBE is rated Medium (low)." },
    marks: [{ name: "E2E SCORER PROBE", rating: "Medium", ratingQualifier: "low", findings: [] }],
  }));
  writeFileSync(join(run, "status.json"), JSON.stringify({ verdict: "Medium", state: "delivered", runId: "e2e-scorer-probe" }));
  mkdirSync(driverDir(run));
  writeFileSync(driverDir(run, "instructed-scope.json"), JSON.stringify({ classes: [32], jurisdictions: ["US"] }));
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    const line = out.split("\n").find((l) => l.startsWith("verdict:"));
    assert.ok(line, `the verdict line is printed\n${out}`);
    assert.ok(!/\(unreadable\)/.test(line), `the defect, stated as the output: ${line}`);
    assert.match(line, /Medium/, "it names the band the run actually returned");
    assert.match(out, /read from knockout-findings\.json/, "and says which artifact it came from");
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("#324: a run with NO verdict artifact on either lane prints the reason, not a blank", () => {
  const store = makeReference(mkdtempSync(join(tmpdir(), "score-store-")));
  // withDriver:false is the pool-dir shape — no `_driver/verdict.json`, and no knockout findings either,
  // so neither lane can answer. That is exactly when the old code printed an empty parenthesis.
  const run = makeRun({ withDriver: false });
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    const line = out.split("\n").find((l) => l.startsWith("verdict:"));
    assert.match(line, /NOT READABLE/, `an absence is a finding and must read as one: ${line}`);
    assert.ok(!/\(unreadable\)/.test(line));
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

// ── — THE EVIDENCE CLASS ─────────────────────────────────────────────────────────────────────
//
// Both knockout scenarios in one round reported exactly one `found`, and both were false positives from
// the same rule: a register reference satisfied by a NAME that appeared in the run's common-law material.
// A registered trademark is not satisfied by a retail identity or a discussion thread that shares its
// spelling. The string rules are correct and untouched; what was missing is the second question.

test("#406: evidenceClassOf folds the typed source vocabulary, and anything it does not recognise is UNKNOWN, never a class", () => {
  assert.equal(evidenceClassOf("register-vendor"), "register");
  assert.equal(evidenceClassOf("register-euipo"), "register");
  assert.equal(evidenceClassOf("common-law-marketplace"), "common-law");
  assert.equal(evidenceClassOf("common-law-web"), "common-law");
  assert.equal(evidenceClassOf("case-law"), "case-law");
  // guessing here is how a false positive comes back wearing a type
  assert.equal(evidenceClassOf(undefined), "unknown");
  assert.equal(evidenceClassOf(""), "unknown");
  assert.equal(evidenceClassOf("register"), "unknown", "the prefix is `register-`; a bare word is not the vocabulary");
  assert.equal(evidenceClassOf({ source_type: "register-vendor" }), "unknown", "an object is not a source_type");
});

test("#406: a register entry is satisfied by a register record and REFUSED by common-law material — the string rule is unchanged either way", () => {
  const entry = { mark: "ZORVYS", classes: ["9"], jurisdictions: ["US"] };
  const fromRegister = { mark: "ZORVYS", evidence: "register" };
  const fromScreen = { mark: "ZORVYS", evidence: "common-law" };

  // `alias` is the rule an identical label matches on — it is the arm that produced BOTH of this round's
  // false positives, and it still fires. This is a typed gate, not a narrower string rule.
  assert.deepEqual(satisfiesReference(entry, fromRegister), { rule: "alias", evidence: "register", ok: true });
  const refused = satisfiesReference(entry, fromScreen);
  assert.equal(refused.ok, false, "a register right is not established by marketplace material sharing its name");
  assert.equal(refused.rule, "alias", "…and the REFUSAL is auditable: the string DID match, on this rule");
  assert.equal(refused.evidence, "common-law", "…and by this evidence");

  // the skeleton arm is gated identically — the gate is on evidence, never on which string rule fired
  const skel = satisfiesReference({ mark: "ZORVYS" }, { mark: "ZORVIS", evidence: "common-law" });
  assert.equal(skel.rule, "skeleton");
  assert.equal(skel.ok, false);
  assert.equal(satisfiesReference({ mark: "ZORVYS" }, { mark: "ZORVIS", evidence: "register" }).ok, true);

  // a name that does not match is not satisfied and carries no rule to audit
  assert.deepEqual(satisfiesReference(entry, { mark: "UNRELATED", evidence: "register" }),
    { rule: null, evidence: null, ok: false });
});

test("#406: an UNKNOWN evidence class never blocks — a preserved run older than the typed shape keeps its genuine finds", () => {
  const entry = { mark: "ZORVYS" };
  // this is the back-compat invariant, and it is why the change does not silently rewrite history:
  // score.mjs reads preserved runs, and turning their finds into misses would be a second defect
  // dressed as a fix.
  assert.equal(satisfiesReference(entry, { mark: "ZORVYS" }).ok, true, "no evidence field at all ⇒ unknown ⇒ admitted");
  assert.equal(satisfiesReference(entry, { mark: "ZORVYS", evidence: "unknown" }).ok, true);
  assert.equal(satisfiesReference(entry, "ZORVYS").ok, true, "a bare string candidate is the legacy call shape");
});

test("#406: scoreRecall moves a name-only match from FOUND to LOST — and the lost row NAMES what nearly satisfied it", () => {
  const reference = [{ mark: "ZORVYS", classes: ["9"], jurisdictions: ["US"] }];
  const scope = { scopeClasses: ["9"], scopeTerritories: ["US"] };

  // the shape that scored a false `found`: the only candidate is common-law material
  const bad = scoreRecall({ reference, findings: [{ mark: "ZORVYS", evidence: "common-law" }], retrieved: [],
    ...scope, registerOnly: true, collapseReason: "register-only run: no gather/judgment seam to measure" });
  assert.equal(bad.found.length, 0, "the register recall for this lane is honestly zero");
  assert.equal(bad.lost.length, 1);
  // AN ABSENCE IS A FINDING: "nothing was retrieved for this name" and "something with this name was
  // retrieved, from the wrong place" are different facts about the lane, and only one of them is true here.
  assert.equal(bad.lost[0].refused, "ZORVYS");
  assert.equal(bad.lost[0].refusedEvidence, "common-law");
  assert.equal(bad.lost[0].refusedRule, "alias");

  // and the same run with a real register record still scores found, carrying the class that satisfied it
  const good = scoreRecall({ reference, findings: [{ mark: "ZORVYS", evidence: "register" }], retrieved: [],
    ...scope, registerOnly: true, collapseReason: "x" });
  assert.equal(good.found.length, 1);
  assert.equal(good.found[0].evidence, "register");
  assert.equal(good.lost.length, 0);

  // CONSERVATION. A refused finding must not vanish from every bucket — it is accounted on the lost row
  // above, and it must not ALSO be scored as noise (it is a real named hit, just not the register right).
  assert.equal(bad.noise.length, 0, "a refused match is recorded on its entry, never double-counted as noise");
});

// ── — A SCORE A READER CANNOT RE-DERIVE ─────────────────────────────────────────────────────────
//
// `found[].matched` recorded the mark STRING the winning finding carried. On a run holding several
// findings whose marks are the gold label or start with it, that string does not say WHICH of them
// earned the credit. The number is not claimed wrong — it is unauditable, which for a scoring instrument
// is the same problem one step removed.
test("#917 a found entry names WHICH finding earned it, among namesakes", () => {
  // The case that makes `matched` alone unauditable: several findings whose marks are the gold label or
  // start with it. The string cannot say which one earned the credit; the ordinal can.
  const findings = [
    { mark: "ALPHAGEN", owner: { name: "Alpha Holdings" }, ordinal: 1, band: "Medium" },
    { mark: "ALPHA", owner: { name: "Alpha Holdings" }, ordinal: 2, band: "High" },
    { mark: "ALPHA CARE", owner: { name: "Alpha Holdings" }, ordinal: 3, band: "Medium" },
  ];
  const reference = [{ mark: "ALPHA", owner: "Alpha Holdings", classes: [5], jurisdictions: ["CH"] }];
  const b = scoreRecall({ reference, findings, scopeClasses: ["5"], scopeTerritories: ["CH"] });

  assert.equal(b.found.length, 1, "the gold entry is found");
  assert.equal(b.found[0].matched, "ALPHA", "the name it matched on — unchanged, and shared by three findings here");
  assert.equal(b.found[0].matched_ordinal, 2,
    "and WHICH finding earned it, which is the half a reader could not re-derive from the artifact");
});

test("#917 the ordinal is null when the finding carries none — never an index", () => {
  // `scorable` is a FILTERED list, so a position in it is not the finding's ordinal. Deriving one would
  // put a plausible wrong number in a scoring artifact, which is worse than a stated absence.
  const src = readFileSync(new URL("../reference-score.mjs", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes("matched_ordinal:"));
  assert.ok(line, "the field is written");
  assert.match(line, /Number\.isInteger\(hit\.ordinal\)/, "read off the finding");
  assert.match(line, /:\s*null/, "and null when it is not there");
  assert.doesNotMatch(line, /indexOf|\bi\s*\+\s*1\b/, "never derived from a position in a filtered list");
});

test("#917 the scorer stamps its own version, and the JSON output carries it", () => {
  // An instrument fix invalidates its back-catalogue. `REFERENCE_SCHEMA_VERSION` versions the INPUT;
  // nothing versioned the instrument, so every archived score read as comparable to every other.
  assert.ok(Number.isInteger(SCORER_VERSION) && SCORER_VERSION >= 2,
    "bumped by the change that added matched_ordinal — a score with it and one without are two instruments");
  const cli = readFileSync(new URL("../../scripts/score.mjs", import.meta.url), "utf8");
  assert.match(cli, /scorer_version:\s*SCORER_VERSION/,
    "the JSON output stamps it, or the constant versions nothing a reader can see");
});

// ── — THE HARNESS WAS SILENT ON THE LAWYER'S OWN STATEMENTS ────────────────────────────────────
//
// A gold declares `assertions` and `controls`; the scorer read neither. Grepping its output for either
// word returned nothing, so a failing assertion and a passing one were indistinguishable — and on the
// best run on record one assertion had failed in eight runs of eight while the output read 78% recall.
//
// Fixtures are BUILT: the real gold's statements name real companies and this tree is de-identified.
const BUCKETS = {
  found: [{ mark: "ALPHA" }, { mark: "ALPHA CARE" }],
  lost: [{ mark: "ALPHAGEN" }, { mark: "BETAWORKS" }],
  additional: [{ mark: "GAMMA" }],
};

test("#1575 every declared statement is reported — an omitted one reads as a passing one", () => {
  const rows = scoreStatements({
    assertions: ["The register was searched to full depth.", "ALPHAGEN surfaces — it is register-invisible."],
    controls: ["Pre-fix control: BETAWORKS missed and the dead GAMMA delivered."],
    buckets: BUCKETS,
  });
  assert.equal(rows.length, 3, "two assertions and one control, none dropped");
  assert.deepEqual(rows.map((r) => r.kind), ["assertion", "assertion", "control"]);
});

test("#1575 a statement naming a mark carries that mark's own state", () => {
  const [, invisible] = scoreStatements({
    assertions: ["The register was searched to full depth.", "ALPHAGEN surfaces — it is register-invisible."],
    buckets: BUCKETS,
  });
  assert.equal(invisible.verdict, "evidence");
  assert.deepEqual(invisible.halves, [{ mark: "ALPHAGEN", state: "lost" }],
    "the assertion turns on a mark this run lost, which is the fact the buckets already held and never showed");
});

test("#1575 a conjunctive control is SPLIT — a half that stops firing must not be absorbed", () => {
  // The R2 control read "<A> missed AND dead <B> delivered". Across eight runs A was missed in seven
  // while B reached findings in ONCE, so as a conjunction it fired once while the condition it exists to
  // catch was live seven times. Each named mark is its own half now.
  const [control] = scoreStatements({
    controls: ["Pre-fix control: BETAWORKS missed and the dead GAMMA delivered."],
    buckets: BUCKETS,
  });
  assert.equal(control.kind, "control");
  assert.equal(control.halves.length, 2, "two halves, not one conjunction");
  assert.deepEqual(control.halves.find((h) => h.mark === "BETAWORKS"), { mark: "BETAWORKS", state: "lost" });
  assert.deepEqual(control.halves.find((h) => h.mark === "GAMMA"), { mark: "GAMMA", state: "additional" },
    "and the other half reports independently — one can hold while the other does not");
});

test("#1575 an undecidable statement is UNEVALUATED and says why — never absent, never `pass`", () => {
  const [plain] = scoreStatements({ assertions: ["US rated High-Medium, or the divergence reported."], buckets: BUCKETS });
  assert.equal(plain.verdict, "unevaluated");
  assert.match(plain.why, /names no mark/, "a reader must be able to tell 'cannot decide' from 'forgot'");
  assert.deepEqual(plain.halves, []);
  // and never a pass: this scorer does not read English and must not appear to
  const verdicts = new Set(scoreStatements({
    assertions: ["anything at all", "ALPHA is found"], buckets: BUCKETS }).map((r) => r.verdict));
  assert.ok(!verdicts.has("pass") && !verdicts.has("fail"),
    "the outcomes are `evidence` and `unevaluated` — the reader supplies the judgement");
});

test("#1575 a named mark this run never classified says so, rather than reading as absent", () => {
  const [r] = scoreStatements({ assertions: ["DELTAFORM must surface."], buckets: BUCKETS });
  assert.equal(r.verdict, "unevaluated");
  assert.deepEqual(r.halves, [{ mark: "DELTAFORM", state: "not-in-this-run" }]);
  assert.match(r.why, /none of which this run classified/);
});

test("#1575 emphasis capitals are not marks, and the list that does that is a floor", () => {
  // Lawyers write in capitals. An unrecognised token joins no bucket and reports `not-in-this-run`,
  // which is true and costs a line — so this list keeps the output readable, it does not make the
  // extraction sound, and nothing downstream may depend on it being complete.
  const [r] = scoreStatements({ assertions: ["The crowded field enumerated BEFORE any dilution argument."], buckets: BUCKETS });
  assert.deepEqual(r.halves, [], "BEFORE is not a mark");
  assert.equal(marksNamedIn("ALPHA and BETAWORKS, but NOT GAMMA").sort().join(","), "ALPHA,BETAWORKS,GAMMA");
});

test("#1575 the scorer is versioned again, and the CLI prints the statements", () => {
  assert.ok(SCORER_VERSION >= 3, "reading the assertions changes what the output means");
  const cli = readFileSync(new URL("../../scripts/score.mjs", import.meta.url), "utf8");
  assert.match(cli, /statements:\s*scoreStatements\(/, "the JSON output carries them");
  assert.match(cli, /ASSERTIONS AND CONTROLS/, "and the printed output does too");
  assert.match(cli, /DECLARES NO ASSERTIONS OR CONTROLS/,
    "a reference with none says so — silence renders 'none declared' and 'not read' the same");
});

// ── — THE OWNER DECIDES WHICH RECORD IS CITED, NEVER BAND ORDER ──────────────────
//
// THE SHAPE IS REAL, THE NAMES ARE NOT — the same convention this file already uses. Measured on
// the 2026-08-27 R2 round against R2's gold: of eight entries, five matched more than one band record
// and three cited a different proprietor's record. For two of those three the RIGHT record was already
// in the match set and was passed over on position alone.
//
// Two mechanisms produced those three, and only one of them was the consonant-skeleton class the issue
// is named for. The other two were `alias` matches — identical characters owned by a different company,
// which is a REAL CONFLICT and stays ungated deliberately. So the fix is not a tighter matcher; it is
// that nothing preferred the entry's own proprietor when its record was sitting in the same set.
const OWNER_BAND = [
  // band order is the trap: the wrong proprietor sorts first in every one of these
  { mark: "VELTHOS", record_id: "/mark/em/WRONGSKEL", owner: "Northwind Energy SE" },
  { mark: "VELTHYS", record_id: "/mark/em/RIGHTSKEL", owner: "Calder Pharma S.r.l." },
  { mark: "VELTHIC", record_id: "/mark/us/WRONGALIAS", owner: "Copeland Holdings LLC" },
  { mark: "VELTHIC ADAPTABLE", record_id: "/mark/em/RIGHTNEAR", owner: "Marchmont Dental Limited" },
  { mark: "VELTHIC", record_id: "/mark/em/RIGHTALIAS", owner: "Marchmont Dental Limited" },
  { mark: "ORPHIC", record_id: "/mark/em/NOOWNERREC" },
];

test("1981: a SKELETON collision does not decide the citation — the entry's own proprietor does", () => {
  const reference = [{ mark: "VELTHYS", owner: "Calder Pharma S.r.l.", classes: [5] }];
  const b = scoreRecall({ reference, findings: [], retrieved: OWNER_BAND, scopeClasses: ["5"] });
  const row = b.withheld.find((r) => r.mark === "VELTHYS");
  assert.ok(row, "the entry is still withheld — membership must not move");
  assert.equal(row.record, "/mark/em/RIGHTSKEL",
    "cited the first skeleton collision in band order instead of the entry's own proprietor's record. "
    + "VELTHOS and VELTHYS share a consonant skeleton and belong to different companies");
  assert.equal(row.rule, "alias", "…and the cited record is an identity match, not the near-form");
});

test("1981: an ALIAS match on a DIFFERENT proprietor does not decide it either", () => {
  // The half the issue's title does not cover, and two of the three real wrong citations came this way:
  // identical characters, different company, first in band order.
  const reference = [{ mark: "VELTHIC", owner: "Marchmont Dental Limited", classes: [5] }];
  const b = scoreRecall({ reference, findings: [], retrieved: OWNER_BAND, scopeClasses: ["5"] });
  const row = b.withheld.find((r) => r.mark === "VELTHIC");
  assert.equal(row.record, "/mark/em/RIGHTALIAS",
    "cited a different proprietor's identical mark. That record IS a real conflict and the matcher is "
    + "right to see it — but it is not the record the lawyer named");
  assert.notEqual(row.record, "/mark/em/RIGHTNEAR",
    "…and among the owner's OWN records an identity match beats a near-form: right company, wrong record "
    + "of theirs is still a wrong citation");
});

test("1981: where no record can be attributed to the owner, the row SAYS SO and cites nothing", () => {
  // Naming the blindness rather than inventing the verdict. Falling back to first-in-band is exactly
  // what produced the wrong citations, so the fallback is the thing being removed.
  const reference = [{ mark: "VELTHYS", owner: "Someone Else Entirely GmbH", classes: [5] }];
  const b = scoreRecall({ reference, findings: [], retrieved: OWNER_BAND, scopeClasses: ["5"] });
  const row = b.withheld.find((r) => r.mark === "VELTHYS");
  assert.ok(row, "still withheld — a near-form WAS retrieved, and that fact is unchanged");
  assert.equal(row.record, null, "no record is cited when none can be attributed to the entry's owner");
  assert.equal(row.ownerUnidentified, true, "…and the row declares that, rather than staying silent");
  assert.match(row.why, /none could be attributed to this entry's owner/, "…in words a reader can act on");
  assert.match(row.why, /VELTHOS|VELTHYS/, "…naming what it did match, so the reader can judge it");
});

test("1981: an entry the gold gives NO owner keeps the old first-match behaviour", () => {
  // ANTI-OVERREACH. `ownersMatch` is fail-closed, so an ownerless entry would disclose on every row and
  // a scorer that cited a correct record would start citing none. 3 of R2's 41 register entries carry no
  // owner. There is nothing to disambiguate WITH and no ambiguity to disclose.
  const reference = [{ mark: "ORPHIC", classes: [5] }];
  const b = scoreRecall({ reference, findings: [], retrieved: OWNER_BAND, scopeClasses: ["5"] });
  const row = b.withheld.find((r) => r.mark === "ORPHIC");
  assert.equal(row.record, "/mark/em/NOOWNERREC", "an ownerless entry still cites its match");
  assert.equal(row.ownerUnidentified, undefined, "…and does not disclose an ambiguity it cannot have");
});

test("1981 NEGATIVE CONTROL: the preference changes the CITATION and never the BUCKET", () => {
  // The whole safety argument for this change, driven rather than asserted: R2's baseline is read from
  // these buckets, and a fix that moved membership would move the number the re-run is compared against.
  const reference = [
    { mark: "VELTHYS", owner: "Calder Pharma S.r.l.", classes: [5] },
    { mark: "VELTHIC", owner: "Marchmont Dental Limited", classes: [5] },
    { mark: "VELTHYS", owner: "Someone Else Entirely GmbH", classes: [5] },
    { mark: "ORPHIC", classes: [5] },
  ];
  const b = scoreRecall({ reference, findings: [], retrieved: OWNER_BAND, scopeClasses: ["5"] });
  assert.equal(b.withheld.length, 4,
    "every entry that matched a record before still matches one — including the entry whose owner cannot "
    + "be identified, which is withheld with no citation rather than demoted to lost");
  assert.equal(b.lost.length, 0, "nothing fell to lost, which is the regression this control exists to catch");
});

// ── — THE OWNER COMPARISON KNEW ANGLO-GERMAN FORMS AND ALMOST NO OTHERS ──────────
//
// `BePharBel Manufacturing` and `BePharBel Manufacturing, Société anonyme` read as two companies, so the
// scorer could not identify the record a lawyer named even with it sitting in the band. Measured before
// building: of twenty common legal forms appended to an otherwise identical name, NINETEEN broke the
// match — only `S.A.` survived, and only because `sa` happened to be on the noise list.
//
// THE CORPUS MEASURES COVERAGE; IT CANNOT DECIDE THE CATEGORY. Ranked by recurrence across distinct
// names, the R2 band puts `b v` (15 names) beside `philadelphia` (5) and `mind` (5). One is a legal form;
// the others are words companies are named after. A list derived from frequency alone would strip them
// and make genuinely different companies match — the exact failure this comparison exists to prevent.
// So the forms are DECLARED, and this arm measures the declaration against what the registers carry.
const CORPUS_TAILS = Object.freeze([
  "LLC", "Inc.", "GmbH", "B.V.", "AG", "S.L.", "SA", "S.A.", "S.R.L.", "Ltd", "S.r.l.", "P.C.",
  "o.o.", "SL", "Oy", "Corp.", "AB", "S.p.A.", "SRL", "A/S", "OY", "SARL", "AS", "sp. z o.o.",
  "Limited", "Ltd.",
]);

test("2029: every legal form the register corpus actually carries matches", () => {
  // Derived from 436 distinct owner strings in a real R2 band — the coverage half of the criterion.
  const base = "Acme Widgets";
  const broken = CORPUS_TAILS.filter((t) => !ownersMatch(base, `${base}, ${t}`));
  assert.deepEqual(broken, [],
    "a corporate legal form the registers this engine reads actually carry still splits one proprietor "
    + "into two. Every one of these was taken from real owner strings, so a failure here is a company "
    + "the scorer cannot identify on a real run");
});

test("2029: the specimen that started it, and the two siblings that already worked", () => {
  assert.equal(ownersMatch("BePharBel Manufacturing", "BePharBel Manufacturing, Société anonyme"), true,
    "the gold's owner and the band's owner are the same company written to different lengths");
  assert.equal(ownersMatch("Lo.Li. Pharma S.r.l.", "LO.LI. Pharma S.R.L."), true, "case and punctuation, unchanged");
  assert.equal(ownersMatch("Davis Schottlander & Davis Ltd", "Davis Schottlander & Davis Limited"), true,
    "a form that was already on the list, unchanged");
  assert.equal(ownersMatch("Delphi Genetics S.A. (BX)", "Delphi Genetics S.A."), true,
    "#450's trailing jurisdiction annotation, unchanged");
});

test("2029: STRICTNESS — a form list that ate a real word would be the worse defect", () => {
  // The whole risk of this change, driven. `philadelphia`, `mind` and `solutions` recur across distinct
  // owners exactly as the real forms do; stripping them would match different companies.
  for (const w of ["Zoo", "MIND", "Philadelphia", "Solutions", "Group"])
    assert.equal(ownersMatch(`Foo ${w}`, `Bar ${w}`), false,
      `two different companies sharing the trailing word "${w}" now match — the form list has eaten a `
      + "name-word, which is a wrong-owner match and worse than the gap this fixes");
  assert.equal(ownersMatch("Acme Widgets Inc", "Beta Widgets Inc"), false, "…and the ordinary case still holds");
  assert.equal(ownersMatch("Delphi Genetics S.A.", "Delphi Diagnostics S.A."), false,
    "one distinctive word apart, same form — must stay two companies");
});

test("2029: the join is TRAILING only — a regression this fix introduced and then closed", () => {
  // Making separator-split forms join (`A/S` → `as`, `S.à r.l.` → `sarl`) also joined LEADING initials:
  // `A B Widgets` became `ab` (Aktiebolag), dropped it, and matched a company called `Widgets`. A
  // strictness regression introduced by the fix for a strictness gap. A legal form sits at the END.
  assert.equal(ownersMatch("A B Widgets", "Widgets"), false,
    "leading initials were joined into a legal form and stripped");
  assert.equal(ownersMatch("Acme Widgets, A/S", "Acme Widgets"), true,
    "…while a trailing separator-split form still joins and drops");
});

test("2029: `S.à r.l.` is a STATED limit, measured rather than assumed away", () => {
  // It does not match, and that is recorded rather than hidden. `S.à` normalises away at tokenising, so
  // the trailing run is one token and cannot join. Not fixed with more regex because the shape appears
  // ZERO times in 436 corpus owner strings — the coverage arm above is what will catch it if a register
  // ever starts carrying it, which is a better guard than a pattern written for a case nobody has seen.
  assert.equal(ownersMatch("Acme Widgets", "Acme Widgets, S.à r.l."), false,
    "if this now passes, the limit closed — delete this arm and say so; the coverage arm is unaffected");
  assert.equal(ownersMatch("Acme Widgets", "Acme Widgets, SARL"), true, "the undotted spelling always worked");
});
