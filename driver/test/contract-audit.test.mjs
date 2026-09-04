// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-audit.test.mjs — 's E1, E2 and E3 checks, in CI.
//
// This file is the enforcement. Every later move on inherits it, so read what each arm asserts
// before changing a declaration to make it pass —: "A stage-contract declaration that lists a
// mechanical element as `judgment` to get past CI is the defect wearing a label. Review the
// declarations, not just the green tick."

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import {
  CONTRACT_CLASSES, isMechanical, declaredElements, arm1Unaccounted, arm2Unspoken, arm2Regressions,
  extractStaticTokens, tripwireUncovered, e3Counts, e3CountsMjs, stripContractElements, stageSourceBlocks,
  E3_KINDS, E3_BACKLOG_KINDS, mechanicalAndUnspoken, backlogEvidenceMisses, evidenceAnchor,
  wherePaths, normalizeQuote, backlogLineMisses, anchorWindows,
  // — the second axis: HOW the dictation reaches the model, which `where` cannot say.
  E3_SURFACES, surfaceWitnesses, backlogSurfaceMisses, surfaceCensus, backlogSurfaceMoves,
  // — the rulings, and the two directions they can go wrong in.
  innerCodeFor, innerCodeCovered, uncoveredComposites, innerCodesUnminted, outOfScopeRuleFor,
} from "../contract-audit.mjs";
import {
  VOCABULARY, ARM1_EXEMPTIONS, COVERED_SOURCES, INNER_CODES, TRIPWIRE_OUT_OF_SCOPE, STAGE_UNREACHABLE_VALIDATORS,
  // — the census tables whose citations rot; the symbol arm walks all four, not the one it anchors.
  CENSUS_TABLES,
  ALL_STAGES, normalizeFailToken,
} from "../contract-vocabulary.mjs";
import { E3_BACKLOG, E3_DATA_INPUT_EXEMPTIONS, E3_UNPLANNED, E3_EVIDENCE_UNRESOLVED, E3_SURFACE_CENSUS } from "../contract-e3-backlog.mjs";
// — ONE derivation, two callers: this assertion and the `--write` regen beside it.
import { measureE3, e3Drift } from "./contract-e3-baseline.mjs";
import { arm2Drift } from "./contract-arm2-baseline.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const DRIVER = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (f) => JSON.parse(readFileSync(join(DRIVER, f), "utf8"));

// ── E1 — the declaration ─────────────────────────────────────────────────────────────────────────────

test("E1: every stage declares contractElements beside its message", () => {
  const undeclared = Object.keys(STAGES).filter((s) => !STAGES[s].contractElements);
  assert.deepEqual(undeclared, [],
    "a stage with no contractElements is a contract nobody has read — declare its elements or the partition below is over a subset");
});

test("E1: every element's class is in the closed enum, and there is no bare `mechanical`", () => {
  const bad = declaredElements(STAGES).filter((r) => !CONTRACT_CLASSES.includes(r.class));
  assert.deepEqual(bad, [],
    `class must be one of ${CONTRACT_CLASSES.join(" | ")} — a mechanical element must name what discharges it`);
});

test("E1: the declared inventory covers all 16 stages and every element names a class", () => {
  assert.deepEqual(Object.keys(STAGES).sort(), [...ALL_STAGES].sort(),
    "ALL_STAGES in contract-vocabulary.mjs has drifted from STAGES — the per-stage vocabulary rows key on it");
  for (const r of declaredElements(STAGES)) {
    assert.ok(r.element.trim().length, `${r.stage}: an element with no name cannot be audited`);
    assert.ok(Array.isArray(r.tokens), `${r.stage} / ${r.element}: tokens must be an array (empty is a finding, not an error)`);
  }
});

// E8's target set was `notify` / `notify-chat` / `notify-fail-chat` — the only stages every one of
// whose declared elements was MECHANICAL, i.e. stages that asked a model for nothing a model was needed
// for. deleted all three with the delivery mode that was their only caller, so E8's population is
// EMPTY and its work is done by deletion rather than by conversion.
//
// The arm is kept and inverted rather than removed, because the property it holds is the one that
// matters going forward: a stage whose every element is mechanical is a stage that should be code. An
// empty answer here is the finished state; a non-empty one is a new instance of the class E8 named.
test("E1: NO stage is all-mechanical — a stage that asks a model for nothing mechanical should be code", () => {
  const allMech = Object.keys(STAGES).filter((s) => {
    const rows = declaredElements(STAGES).filter((r) => r.stage === s);
    return rows.length > 0 && rows.every((r) => isMechanical(r.class));
  });
  assert.deepEqual(allMech.sort(), [],
    "every declared element of these stage(s) is mechanical, so the seat is being asked to do what code "
    + "already does — the #850 M7/E8 class. Convert the stage or delete it; do not add it to a list.");
});

// ── E2 arm 1 — a token no element accounts for: HARD RED ─────────────────────────────────────────────

test("E2 arm 1: every validator token a stage can emit is accounted for by one of that stage's elements", () => {
  const un = arm1Unaccounted(STAGES);
  assert.deepEqual(un, [],
    "unaccounted (token, stage) pairs — attach the token to the element it speaks about, or add a NAMED exemption with a reason in contract-vocabulary.mjs. Never a silent skip.");
});

test("E2 arm 1: every exemption names a reason and a token the vocabulary actually carries", () => {
  assert.ok(ARM1_EXEMPTIONS.length, "an empty exemption list means the partition has no driver-fault escape hatch — check this is really true");
  for (const x of ARM1_EXEMPTIONS) {
    assert.ok(x.reason && x.reason.length > 40, `exemption ${x.token}: a reason short enough to be a label is not a reason`);
    assert.ok(x.stages?.length, `exemption ${x.token}: exemptions are per stage, never global`);
    const row = VOCABULARY.find((r) => r.token === x.token);
    assert.ok(row, `exemption ${x.token} names a token no vocabulary row carries — a stale exemption silently widens the escape hatch`);
    for (const s of x.stages) {
      assert.ok(row.stages.includes(s), `exemption ${x.token} names stage ${s}, which the vocabulary row does not list`);
      assert.ok(ALL_STAGES.includes(s), `exemption ${x.token} names unknown stage ${s}`);
    }
  }
});

test("E2 arm 1: no exemption is redundant — an exempted token no element declares, and nothing more", () => {
  // An exemption for a token an element ALREADY accounts for is an escape hatch held open for nothing.
  // It reads as a ruling that the token is a driver fault while the declarations say otherwise, and the
  // next agent cannot tell which is meant.
  const rows = declaredElements(STAGES);
  const redundant = [];
  for (const x of ARM1_EXEMPTIONS) {
    for (const s of x.stages) {
      const declared = rows.filter((r) => r.stage === s).flatMap((r) => r.tokens).map(normalizeFailToken);
      if (declared.includes(x.token)) redundant.push(`${x.token} @ ${s}`);
    }
  }
  assert.deepEqual(redundant, [],
    "these tokens are both declared by an element and exempted as a driver fault — decide which, and delete the other");
});

// ── E2 arm 1 SOUNDNESS — the static extraction, inverted into a tripwire ─────────────────────────────
//
// The census is authored, not extracted, because a regex under-reads (eight dynamic sites in verify.mjs
// alone). This asserts the one direction a regex IS sound in: everything it can see must be covered.

test("E2 soundness: every statically visible token is covered by a vocabulary row or a named scope rule", () => {
  const un = tripwireUncovered(extractStaticTokens(DRIVER));
  assert.deepEqual(un, [],
    "a token literal exists that no vocabulary row and no out-of-scope rule covers. Add the row (per stage), or a TRIPWIRE_OUT_OF_SCOPE rule saying why no stage can emit it. This is the check that stops the census going stale.");
});

test("⭐ #1202 E2 soundness: the census READS the acceptance boundary, and this is a detection", () => {
  // Before this arm, three record modules extracted ZERO tokens each and every green above was a walk
  // over a corpus that could not be seen. `extractStaticTokens` keyed on `fail(` / `throw new Error(` /
  // `=>`, and every record module refuses with `return { ok: false, reason: "<token>: …" }` instead — so
  // the conversions, whose whole shape is moving refusals from verify.mjs to an acceptance boundary, were
  // moving one family at a time out of the census's sight. Asserted by NAME, not by count: a count arm
  // stays green if the pattern starts matching something else entirely.
  // retired ACCEPTANCE_SOURCES — the pattern now runs over every covered source. The DETECTION
  // must not retire with it, so the seven record modules are named here, in this test, as its subject.
  const ACCEPTANCE = ["matter-frame-record.mjs", "prelim-variants-record.mjs", "skeptic-record.mjs",
    "frame-diff-record.mjs", "blind-frame-record.mjs", "report-overview-record.mjs", "report-card-record.mjs"];
  const seen = extractStaticTokens(DRIVER, ACCEPTANCE);
  for (const token of ["matterframe_prose_missing", "matterframe_intake_ask_quote",
    "variantmodel_scope_layer_invalid", "skeptic_axis_invalid", "skeptic_roundtrip_mismatch"]) {
    assert.ok(seen.has(token),
      `the census cannot see ${token} — a refusal minted at an acceptance boundary is invisible again, `
      + "and the families the conversions move there stop being covered by anything");
  }
  // `acceptMatterFrame` alone mints eight, against a hand-authored row that documented three. The row was
  // not wrong; nothing re-derived it, which is the property this arm restores.
  assert.ok(extractStaticTokens(DRIVER, ["matter-frame-record.mjs"]).size >= 8,
    "matter-frame's acceptance boundary reports fewer tokens than it mints");
});

// ── — THE 21 RULINGS ───────────────────────────────────────────────────────────────────────────
//
// pointed the `reason:` pattern at seven record modules and named the rest as scaffolding. Pointed
// at every covered source it surfaced 21 further codes, and the issue's hypothesis was that they were two
// groups: inner codes of a covered composite, and possibly-real census holes with `caselaw_no_queries`
// named as the candidate hole.
//
// THERE ARE NO HOLES. All 21 are inner codes or codes no failure token can carry, and the hypothesis
// failed on the one it named: `caselaw_no_queries` is not a token, because case-law-ledger.mjs does not
// namespace per code — it folds all eight into `caselaw_ledger:<census>;<detail>`, where they are payload
// after the colon that `normalizeFailToken` cuts at. The guess came from reading it by analogy with
// connotation-search.mjs, which does namespace per code. Two modules, two projections, one wrong analogy.

// ── — A CITATION THAT CANNOT ROT SILENTLY ─────────────────────────────────────────────────────
//
// A `site:` is a line number, and line numbers in these tables are wrong at scale: 75 of 90 are 34-246
// lines from any mention of their own token, all pointing into verify.mjs, drift clustered at 34/35/36/52
// because one insertion moves every citation below it at once. `symbol:` names a thing instead, and these
// arms are what stop an anchor going the same way — a symbol nobody checks is a number with extra steps.
//
// The arms walk EVERY census table, not the one row-set this issue anchored. Coverage is small today and
// grows as CONTRIBUTING.md's opportunistic migration reaches these rows; what matters is that the check
// is already in place when it does, rather than arriving after the next rot.

test("#1272: every symbol anchor names something that is really in the file it names", () => {
  const missing = [];
  for (const [table, rows] of Object.entries(CENSUS_TABLES)) {
    for (const row of rows) {
      if (!row.symbol) continue;
      const key = row.token ?? row.prefix ?? row.validator ?? "?";
      const rel = String(row.symbol.file ?? "").replace(/^driver\//, "");
      if (!existsSync(join(DRIVER, rel))) { missing.push(`${table} ${key}: ${row.symbol.file} does not exist`); continue; }
      const text = readFileSync(join(DRIVER, rel), "utf8");
      for (const n of row.symbol.names ?? []) {
        if (!text.includes(n)) missing.push(`${table} ${key}: "${n}" is not in ${row.symbol.file}`);
      }
    }
  }
  assert.deepEqual(missing, [],
    "a symbol anchor names something its file does not contain — the thing was renamed or moved, and the "
    + "anchor now points at nothing. Re-point it; that is the whole reason it is a symbol and not a line");
});

test("#1272: an anchor is not vacuous — it names at least one symbol, and the arm can fail", () => {
  const anchored = Object.values(CENSUS_TABLES).flat().filter((r) => r.symbol);
  assert.ok(anchored.length >= 2, `no census row carries a symbol anchor, so the arm above walks nothing (${anchored.length})`);
  for (const row of anchored) {
    assert.ok(row.symbol.file, `${row.token ?? row.prefix} has a symbol anchor naming no file`);
    assert.ok((row.symbol.names ?? []).length >= 1, `${row.token ?? row.prefix} has a symbol anchor naming no symbol`);
    // A citation stays alongside the anchor: an anchor REPLACING one would trade a precise-but-rotting
    // pointer for a vaguer one, which is not the trade is making. The citation lives in `site:` in
    // three of the four tables and inside `reason:` prose in ARM1_EXEMPTIONS — a shape difference this
    // arm found rather than assumed, so it checks for either.
    const cited = Boolean(row.site) || /\.(?:mjs|md|json):\d+/.test(String(row.reason ?? ""))
      || /\b[a-zA-Z][A-Za-z0-9_]*\(\)|`[^`]+`/.test(String(row.reason ?? ""));
    assert.ok(cited, `${row.token ?? row.prefix} carries a symbol anchor and no citation of any kind beside it`);
  }
  // The check must be able to fire, or the empty above says only that the loop ran.
  const probe = readFileSync(join(DRIVER, "case-law-ledger.mjs"), "utf8");
  assert.ok(!probe.includes("noSuchSymbolAnywhere_1272"), "the control name unexpectedly exists — the arm proves nothing");
});

test("#1272: CENSUS_TABLES names every table whose rows carry a citation", () => {
  // The arm is only as complete as this map. A fifth table added later and not registered here would be
  // unchecked while the two arms above stayed green — the vacuity these tables exist to prevent, in the
  // instrument written to prevent it.
  assert.deepEqual(Object.keys(CENSUS_TABLES).sort(),
    ["ARM1_EXEMPTIONS", "STAGE_UNREACHABLE_VALIDATORS", "TRIPWIRE_OUT_OF_SCOPE", "VOCABULARY"],
    "the census-table map no longer matches the tables that carry citations");
  for (const [name, rows] of Object.entries(CENSUS_TABLES)) {
    assert.ok(Array.isArray(rows) && rows.length, `${name} is empty or not an array — the arms walk nothing`);
    // NOT every table carries its citation in a `site:` field, and this arm found that out rather than
    // assuming it: ARM1_EXEMPTIONS has no `site` at all — all ten rows cite inside the `reason` PROSE
    // ("...driver-loaded config (verify.mjs:691)..."). That is the shape CONTRIBUTING.md's convention is
    // aimed at and the one no arm can check without parsing sentences, so what is asserted here is that a
    // row cites SOMETHING, and the symbol arm covers the rows that have moved to an anchor.
    // A SYMBOL ANCHOR COUNTS AS A CITATION — it is the better one, and this predicate said otherwise on
    // its first run: anchoring the one uncited row made this arm keep failing, because it only recognised
    // the fragile form. An instrument that refuses to accept the fix it exists to encourage.
    const cites = (r) => Boolean(r.site) || Boolean(r.symbol?.names?.length)
      || /\.(?:mjs|md|json):\d+/.test(String(r.reason ?? ""));
    const bare = rows.filter((r) => !cites(r)).map((r) => r.token ?? r.prefix ?? r.validator);
    assert.deepEqual(bare, [], `${name} has a row citing nothing at all — neither a site nor a reference in its reason`);
  }
});

test("#1211: the 21 are decided BY NAME, and every decision carries a mint and a reason", () => {
  // By name, never by count. A count arm stays green while the set underneath it changes — the failure
  // this file has now been bitten by twice.
  const MEASURED = [
    "call_never_made", "call_truncated", "call_schema_violation", "call_partial", "no_recorded_queries",
    "form_damaged", "quote_unbound", "token_absent", "cite_absent", "no_ruling",
    "no_queries", "query_no_text", "query_no_jurisdiction", "citation_no_proceeding", "citation_no_url",
    "citation_read_state", "no_citations", "dive_unread", "no_status", "engine_vocabulary",
    "accepted_not_folded",
  ];
  assert.equal(MEASURED.length, 21);
  for (const code of MEASURED) {
    const inner = innerCodeFor(code);
    const scoped = outOfScopeRuleFor(code);
    assert.ok(inner || scoped, `#1211 left ${code} undecided — it is neither an inner code nor out of scope`);
    assert.ok(!(inner && scoped), `${code} is ruled twice, and the two rulings can disagree`);
    const why = inner?.why ?? scoped?.reason;
    assert.ok(why && why.length > 40, `${code}'s ruling states no reason a reader could check`);
  }
  for (const row of INNER_CODES) {
    assert.ok(row.mints.length >= 1, `${row.code} names no mint, so nothing can be checked against it`);
    assert.ok(row.rollsUpTo.length >= 1, `${row.code} is an inner code of nothing — it belongs out of scope, with the mechanism that swallows it`);
  }
});

test("#1211: an inner code is excused by its composite, and ONLY while that composite is covered", () => {
  // The property that makes this a table of assertions rather than a list of exemptions. Tested on a
  // synthetic row so it does not depend on deleting a live vocabulary row, and in BOTH directions.
  for (const row of INNER_CODES) {
    assert.deepEqual(uncoveredComposites(row), [],
      `${row.code} is excused by ${row.rollsUpTo.join(", ")}, and no vocabulary row covers that — the `
      + "ruling has outlived its own justification and is now excusing the code for no stated reason");
    assert.ok(innerCodeCovered(row));
  }
  const orphan = { code: "probe", mints: ["driver/x.mjs:1"], rollsUpTo: ["connotation_call_partial", "no_such_composite_"], why: "probe" };
  assert.deepEqual(uncoveredComposites(orphan), ["no_such_composite_"],
    "the check cannot see a composite that lost its row — every green above this line is vacuous");
  assert.equal(innerCodeCovered(orphan), false);
  // A ruling with no composite at all never excused anything: that is what an out-of-scope rule is for.
  assert.equal(innerCodeCovered({ code: "p", mints: [], rollsUpTo: [], why: "" }), false);
});

test("#1211: no ruling is a phantom — every ruled code is still minted", () => {
  // The direction the tripwire structurally cannot notice: it only ever walks tokens that ARE there. A
  // stale row excuses a name, so a name re-introduced later for a different purpose arrives pre-excused.
  const ex = extractStaticTokens(DRIVER);
  assert.deepEqual(innerCodesUnminted(ex), [],
    "an INNER_CODES ruling names a code nothing mints any more. Delete the row — leaving it means the "
    + "next use of that name inherits a ruling written about something else");
  for (const r of TRIPWIRE_OUT_OF_SCOPE) {
    if (!r.token) continue;
    assert.ok(ex.has(r.token), `the exact-token rule for ${r.token} excuses a code nothing mints`);
  }
});

test("#1211: no bare inner code is a failure-token head ANYWHERE in the driver", () => {
  // The rulings all rest on one claim — the bare form reaches no stage — so that claim is checked rather
  // than asserted, and over every driver module rather than the covered subset: a `fail("no_ruling")` in
  // an unscanned module would make nineteen rulings wrong at once and no other arm here would see it.
  const HEAD_RE = /(?:fail\(|throw new Error\()\s*[`"']([a-z][a-z0-9_]*)/g;
  const ruled = new Set([...INNER_CODES.map((r) => r.code), ...TRIPWIRE_OUT_OF_SCOPE.filter((r) => r.token).map((r) => r.token)]);
  const bare = [];
  for (const f of nonEmpty(readdirSync(DRIVER).filter((x) => x.endsWith(".mjs")), "readdirSync(DRIVER).filter((x) => x.endsWith(\".mjs\"))")) {
    const lines = readFileSync(join(DRIVER, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      HEAD_RE.lastIndex = 0;
      let m;
      while ((m = HEAD_RE.exec(lines[i]))) if (ruled.has(m[1])) bare.push(`${f}:${i + 1} ${m[1]}`);
    }
  }
  assert.deepEqual(bare, [],
    "a ruled inner code is the HEAD of a real failure token, so a stage can emit it bare and its ruling "
    + "is false. Either the token should be namespaced, or the code needs a vocabulary row per stage");
  // The check must be able to fire, or the empty above says nothing.
  HEAD_RE.lastIndex = 0;
  assert.equal(HEAD_RE.exec('return fail("no_ruling:x");')?.[1], "no_ruling");
});

test("#1211: an exact out-of-scope rule excuses its own name and no neighbour", () => {
  // `prefix` excuses a family; `token` excuses one name. If the exact form were matched as a prefix,
  // a future `no_citations_stale` would arrive pre-excused with nobody having ruled on it.
  assert.ok(outOfScopeRuleFor("no_citations"), "the exact rule does not match its own token");
  assert.equal(outOfScopeRuleFor("no_citations_stale"), null,
    "an exact-token rule is swallowing a neighbouring name — the exemption is growing on its own");
  assert.equal(outOfScopeRuleFor("accepted_not_folded_later"), null);
  assert.ok(outOfScopeRuleFor("client_summary_missing"), "the family form stopped matching by prefix");
  for (const r of TRIPWIRE_OUT_OF_SCOPE) {
    assert.ok(Boolean(r.prefix) !== Boolean(r.token), "a scope rule carries a prefix or a token, never both and never neither");
    assert.ok(r.site && r.reason, "a scope rule with no site or no reason is an unexplained skip");
  }
});

test("#1211: a cited site is a MINT, never a sentence about the code", () => {
  // Every ruling cites its mint, and the census's own citation could not be used for one of them:
  // `no_status` was reported at coverage-form.mjs:802, the JSDoc `@returns` annotation seventeen lines
  // above the line that writes it. Asserted as the general invariant rather than that one case.
  const ex = extractStaticTokens(DRIVER);
  const fromComment = [];
  for (const [token, site] of ex) {
    const [file, line] = site.split(":");
    const text = readFileSync(join(DRIVER, file), "utf8").split("\n")[Number(line) - 1] ?? "";
    if (/^\s*(?:\/\/|\*|\/\*)/.test(text)) fromComment.push(`${token} @ ${site}`);
  }
  assert.deepEqual(fromComment, [],
    "a token's cited site is a comment line, so any ruling written from it cites a sentence about the "
    + "code rather than the line that mints it");
  // The line number moves whenever anything above it in coverage-form.mjs does — it shifted +8 when the
  // park fields were added to `parseCoverageForm`'s projection (#1239). What the arm PINS is not the
  // number but the property: the cited site must be the line that WRITES `reason: "no_status"`, not the
  // JSDoc `@returns` seventeen lines above it, which is where it used to point.
  const noStatusSite = ex.get("no_status");
  assert.match(noStatusSite, /^coverage-form\.mjs:\d+$/);
  const mintLine = readFileSync(join(DRIVER, "coverage-form.mjs"), "utf8")
    .split("\n")[Number(noStatusSite.split(":")[1]) - 1] ?? "";
  assert.match(mintLine, /reason:\s*"no_status"/,
    `the worked example regressed off its mint line — ${noStatusSite} reads: ${mintLine.trim().slice(0, 70)}`);
  // And the filter must not have shrunk the census: a comment-only token would vanish with its coverage
  // obligation, and an absence reads as clean. 307 measured before and after on a22b4fd0.
  assert.ok(ex.size >= 307, `the extraction shrank to ${ex.size} — a token lost its coverage obligation silently`);
});

test("#1211: every citation lands on the line that MINTS the code, not near it", () => {
  // THIS ARM EXISTS BECAUSE IT ALREADY FIRED. #1265 landed in connotation-search.mjs while this was being
  // built and moved every mint in that file down 31 lines; all eleven citations into it then pointed at
  // comments and unrelated code, and nothing would have said so. A line number in prose is a claim that
  // decays on somebody else's merge, so it is checked rather than maintained.
  //
  // #1211's condition is "each decision cites the site that mints it". A ruling that cites a sentence
  // three functions away is not a worse ruling than one citing nothing — it is a more convincing one,
  // which is worse.
  // THE FAILURE OUTPUT IS THE PATCH. A message that says "re-derive the line numbers" hands the next
  // agent — who has the repo and nothing else — a chore with no tool, so this finds the right line and
  // prints it. #1263 is open against connotation-search.mjs as this lands, and whoever merges second
  // trips this arm; what they need is the corrected citation, not an instruction to go and look.
  // The MINT shape, not any mention: `reason: "<code>"` is how every one of these is written. Matching a
  // bare quoted occurrence would call the closed-list declarations (CONNOTATION_REASONS,
  // CASE_LAW_LEDGER_REASONS) mints too, and then the corrected citation offered below is three lines to
  // choose between rather than the one that writes it.
  const mintsCode = (line, code) => new RegExp(`reason:\\s*["\`]${code}["\`]`).test(line);
  const COMMENT = /^\s*(?:\/\/|\*|\/\*)/;
  const stale = [];
  for (const row of INNER_CODES) {
    for (const m of row.mints) {
      const [file, n] = m.split(":");
      const rel = file.replace(/^driver\//, "");
      const lines = readFileSync(join(DRIVER, rel), "utf8").split("\n");
      if (mintsCode(lines[Number(n) - 1] ?? "", row.code)) continue;
      const now = lines
        .map((l, i) => (!COMMENT.test(l) && mintsCode(l, row.code) ? `${file}:${i + 1}` : null))
        .filter(Boolean);
      stale.push(`${row.code}: ${m} no longer mints it — it is now at ${now.join(", ") || "(nowhere in that file)"}`);
    }
  }
  assert.deepEqual(stale, [],
    "an INNER_CODES citation no longer lands on the line that writes its code — something above it moved. "
    + "Each entry above names where that code is NOW; copy those into `mints` in contract-vocabulary.mjs. "
    + "Do not delete the citation: it is what makes the ruling checkable rather than merely written down");
  // The check must be able to fire, or a green here says only that the loop ran.
  const line = readFileSync(join(DRIVER, "case-law-ledger.mjs"), "utf8").split("\n")[0];
  assert.ok(!line.includes('"no_queries"'), "the control line unexpectedly mints — this arm proves nothing");
});

test("#1211: every ruling cites a file the extractor actually opens", () => {
  // The shape of this check asked whether an acceptance source was also a covered source. There is
  // one list now, so that question has no subject — but the vacuity it guarded against moved rather than
  // died: a ruling whose mint sits in a file COVERED_SOURCES lacks looks like a decision and delivers
  // none, because the extractor never opens the file and the code it excuses was never going to appear.
  const orphans = [];
  for (const row of INNER_CODES) {
    for (const m of row.mints) {
      const file = m.replace(/^driver\//, "").split(":")[0];
      if (!COVERED_SOURCES.includes(file)) orphans.push(`${row.code} -> ${m}`);
    }
  }
  assert.deepEqual(orphans, [],
    "an INNER_CODES ruling cites a mint in a file the extractor never scans, so the ruling excuses "
    + "a code that could never have been extracted — coverage that delivers nothing");
});

test("E2 soundness: verify.mjs imports no parser from a source the tripwire does not read", () => {
  const src = readFileSync(join(DRIVER, "verify.mjs"), "utf8");
  const local = [...src.matchAll(/^import[\s\S]*?from "\.\/([a-z0-9-]+\.mjs)";/gm)].map((m) => m[1]);
  assert.ok(local.length > 10, `expected verify.mjs's local imports, found ${local.length} — the import scan has broken, not the code`);
  const unread = [...new Set(local)].filter((f) => !COVERED_SOURCES.includes(f));
  assert.deepEqual(unread, [],
    "verify.mjs reaches a parser whose token literals the tripwire never reads, so that parser's family could grow unseen. Add it to COVERED_SOURCES and give its tokens vocabulary rows.");
});

test("E2 soundness: the wrapper normalisation strips the gateway's variable segments", () => {
  // gateway.mjs:788 wraps the reason with a VARIABLE file segment; :1113 PREFIXES the whole string.
  // A matcher keyed on the bare token misses both and reports a false unattached token.
  assert.equal(normalizeFailToken("invalid_file:common-law-findings.half-m.md:connotation_no_ruling"), "connotation_no_ruling");
  assert.equal(normalizeFailToken("max_tokens_no_output:invalid_file:findings.json:finding_meter_missing"), "finding_meter_missing");
  assert.equal(normalizeFailToken("missing_file:narrative.md"), "missing_file");
  assert.equal(normalizeFailToken("too_short(12<40)"), "too_short(12<40)".split(":")[0]);
});

test("E2: the stage-unreachable validators are recorded, so the partition's scope is stated not assumed", () => {
  assert.ok(STAGE_UNREACHABLE_VALIDATORS.length >= 4);
  const verify = readFileSync(join(DRIVER, "verify.mjs"), "utf8");
  for (const v of STAGE_UNREACHABLE_VALIDATORS) {
    assert.match(verify, new RegExp(`\\n\\s*${v.validator}: \\(`),
      `${v.validator} is recorded as a stage-unreachable validator but no longer exists in verify.mjs — drop the row`);
    const reached = Object.values(STAGES).some((d) => d.validate && d.validate.name === v.validator);
    assert.equal(reached, false, `${v.validator} is now reached by a stage — it must join the partition, not the scope note`);
  }
});

// ── E2 arm 2 — an element no token speaks about: A RATCHET ───────────────────────────────────────────
//
// Owner ruling (, 2026-08-13): arm 2 ships as a ratchet, not a red check and not dropped. 138 of 284
// elements have no token today. A check that can never go green is disabled within a week and a
// permanently red gate teaches everyone that red carries no information (/); dropping the arm is
// absence-reads-as-a-pass. So: green-or-red on arm 1, ratchet on arm 2.

test("E2 arm 2: no stage gains an element that no validator token speaks about", () => {
  const baseline = readJson("contract-arm2-baseline.json");
  const measured = arm2Unspoken(STAGES);
  for (const s of Object.keys(STAGES)) measured[s] ??= [];
  const regressions = arm2Regressions(measured, baseline.byStage);
  assert.deepEqual(regressions, [],
    "a stage gained an unpoliced element. Give it a validator token, or — if it is genuinely unpoliceable — say so in the PR and regenerate the baseline deliberately. A per-stage increase cannot hide behind a fix elsewhere.");
});

test("E2 arm 2: no PHANTOM row — a recorded element the stage no longer declares is a licence to re-incur it (#1201)", () => {
  // THE MIRROR OF 's E3 HOLE, on the other instrument. `arm2Regressions` asks only whether a stage
  // GAINED an element, comparing against the RECORDED list — so a row naming an element the stage has
  // since retired is not inert: re-declaring that exact element is not a gain, and does not trip. The row
  // that recorded a debt has become permission to re-incur it.
  //
  // Not hypothetical. On 2026-08-18 `report-card` listed 13 against 9 measured, the four absentees being
  // the frame lines (`- ord:`, `- group:`, `- source:`, `- net:`) retired by the 2026-08-16 conversion and
  // left standing here. Any of the four could have come back green.
  //
  // THE RATCHET IS UNTOUCHED. This asserts MEMBERSHIP, not direction: arm2Regressions still owns "a stage
  // gained an unpoliced element", and the owner ruling that arm 2 must not be a permanently-red gate holds
  // — this goes green the moment the baseline is regenerated, and regenerating is the act that records it:
  //
  //     node driver/test/contract-arm2-baseline.mjs --write
  const { phantom, unrecorded } = arm2Drift();
  assert.deepEqual(phantom, [],
    "the baseline names element(s) no stage declares any more. Left standing, re-declaring exactly those "
    + "is invisible to the ratchet. Regenerate in the same commit and say what retired them:\n"
    + "  node driver/test/contract-arm2-baseline.mjs --write");
  assert.deepEqual(unrecorded, [],
    "a declared element is missing from the baseline, so the two instruments disagree about the population "
    + "the ratchet is measuring. Give it a validator token, or record it deliberately with --write.");
});

test("E2 arm 2: the baseline carries element NAMES per stage, not a bare count", () => {
  const baseline = readJson("contract-arm2-baseline.json");
  assert.ok(baseline.byStage, "the baseline must be per stage — it is the audit object");
  for (const [stage, names] of Object.entries(baseline.byStage)) {
    assert.ok(Array.isArray(names), `${stage}: the baseline must list element names, never a count`);
    for (const n of names) assert.equal(typeof n, "string");
  }
  const total = Object.values(baseline.byStage).reduce((a, v) => a + v.length, 0);
  assert.equal(total, baseline.total, "the baseline's own total disagrees with its per-stage rows");
});

test("E2 arm 2: arm 1's exempted tokens are not silently counted as arm-2 coverage", () => {
  // Condition 3 of the ruling: arm 1 is exempt FROM THE RATCHET and runs green-or-red. An element must
  // not become "spoken for" by naming a token that arm 1 exempted as a driver fault.
  const exempt = new Set(ARM1_EXEMPTIONS.map((x) => x.token));
  const onlyExempt = declaredElements(STAGES)
    .filter((r) => r.tokens.length > 0 && r.tokens.every((t) => exempt.has(normalizeFailToken(t))))
    .map((r) => `${r.stage} / ${r.element}`);
  assert.deepEqual(onlyExempt, [],
    "an element whose ONLY tokens are arm-1 exemptions is not policed by anything a model can act on — it belongs in arm 2's census, not out of it");
});

// ── E3 — structure is returned, never emitted as text ────────────────────────────────────────────────

test("E3: every surface EXACTLY matches its baseline — a SHRINK is a red until it is recorded (#1201)", () => {
  // WAS A CEILING, IS NOW AN EXACT MATCH, and that is a decision rather than a tightening for its own
  // sake. As a ceiling this read `if (now > was)`, so a surface that SHRANK passed silently and kept its
  // old number — and the room it vacated stayed open for a new violation to land in unnoticed. Three
  // surfaces sat loose that way for five merges: `matter-frame` at 2 dictated-line-shapes against
  // a measured 0, `blind-frame/SKILL.md` and `frame-diff/SKILL.md` at 3 exactly-these-keys against 2.
  // `matter-frame` is a RECORDING stage whose dispatch may not dictate a line shape at all, so on that
  // surface the check against re-authoring the R-RECEIPT class was switched off.
  //
  // THE COST, STATED so the next maintainer does not discover it as friction and loosen it back: every
  // legitimate cleanup now goes RED until the author regenerates. That IS the mechanism — the regen is
  // how the drop gets recorded. A ceiling records only that something was once permitted.
  //
  //     node driver/test/contract-e3-baseline.mjs --write
  //
  // measured through the SAME function this asserts against, so the two cannot disagree about what a
  // surface is.
  const { grew, shrank } = e3Drift();
  assert.deepEqual(grew, [],
    "a surface GAINED a literal JSON skeleton, an 'EXACTLY these keys' clause, or a dictated line shape. "
    + "Return the structure through a tool instead — this is the check that would have caught the R-RECEIPT "
    + "class at authoring time. Recording it with --write makes the new dictation the normal.");
  assert.deepEqual(shrank, [],
    "a surface SHRANK and its baseline still stands at the old number, which leaves room a new violation "
    + "can land in without this check noticing — #1201's hole exactly. Regenerate in the SAME commit:\n"
    + "  node driver/test/contract-e3-baseline.mjs --write\n"
    + "and say at the entry site what removed it.");
});

test("E3: totals are DERIVED from the rows, so the file cannot carry a number nothing owns (#1201)", () => {
  // `totals` used to be a number no test read. It had already drifted — 57 recorded against a row sum of
  // 56 when was filed, and 52 against 46 by the time it was fixed. A claim with no owner is worse
  // than no claim: it is the number a reader quotes.
  const baseline = readJson("contract-e3-baseline.json");
  const measured = measureE3();
  const sum = (o) => Object.values(o).reduce((a, r) => a + Object.values(r).reduce((x, n) => x + n, 0), 0);
  assert.equal(baseline.totals?.stages, sum(baseline.byStage),
    "the baseline's own stages total disagrees with its per-stage rows — regenerate rather than editing the number");
  assert.equal(baseline.totals?.files, sum(baseline.files),
    "the baseline's own files total disagrees with its file rows — regenerate rather than editing the number");
  assert.deepEqual(baseline.totals, measured.totals,
    "the recorded totals are not what the surfaces measure — regenerate with --write");
});

test("E3: the lint does not count the E1 declaration — the scaffolding is invisible to its own check", () => {
  // THIS CAUGHT ITSELF TWICE. First the declaration block's `//` header ("…from the closed enum in…")
  // matched exactly-these-keys in all 19 stages; then, once `why` was added, the element names and
  // rationales did the same as CODE lines ("`- ord: <N>` (first body line)"). Both inflated the ceiling,
  // which is the one failure mode E3 exists to prevent — a lint that greenlights holes because it is
  // busy counting the audit of them.
  //
  // The guard is a differential: strip the declaration and the count must not move. If it does, the
  // ceiling is measuring the audit rather than the contract.
  const src = readFileSync(join(DRIVER, "stages.mjs"), "utf8");
  const blocks = stageSourceBlocks(src);
  const moved = [];
  for (const stage of Object.keys(STAGES)) {
    const withDecl = e3CountsMjs(blocks[stage].text);
    const withoutDecl = e3CountsMjs(stripContractElements(blocks[stage].text));
    for (const kind of E3_KINDS) {
      if (withDecl[kind] !== withoutDecl[kind]) moved.push(`${stage} / ${kind}: ${withoutDecl[kind]} → ${withDecl[kind]}`);
    }
  }
  assert.deepEqual(moved, [],
    "the E1 declaration is being counted as an E3 violation. It is prose ABOUT the contract and is never dispatched to a model — strip it, do not retune the pattern, and do not raise the baseline to absorb it.");
});

test("E3: the backlog is explicit, named, and each entry says which move removes it", () => {
  // PINNED EXACTLY, BOTH DIRECTIONS, since 2026-08-16. It used to be `>= 80`, which fired on a shrink
  // (correctly: a shrink means the ceiling in contract-e3-baseline.json must drop in the same commit)
  // but said nothing at all about growth — entries could be appended silently. An exact count makes a
  // registry edit deliberate whichever way it moves, and this registry is hand-maintained, so brittle
  // on purpose is the right kind of brittle.
  //
  // 83 → 76: report-card's five frame entries were CONVERTED, not replanned (card-frame.mjs). When you
  // change this number, the baseline drops with it and the entries say in words what removed them.
  // 76 → 74 ( follow-up): M1 collapsed THREE authored dictation sites in stages.mjs into ONE in
  // connotation-search.mjs, delivered through the perplexity MCP server. Keeping three rows pointing at one
  // block would fabricate two authored sites the surface does not have, so they were consolidated. The pin
  // exists so a count change is CHOSEN in the open rather than discovered — this is that choice.
  // 74 → 73: common-law-half's ANCHOR dictate at SKILL.md is DELETED, not reworded — the seat no
  // longer authors a string the driver reparses to locate an extraction span. It gives an ordinal the
  // driver resolves and a fragment the driver only containment-checks, so nothing it types selects bytes
  // for a delivered artifact. A conversion, in the direction this programme exists to move things.
  // 72 → 70 (, skeptic): BOTH of skeptic's `## Escalation decisions` rows are DISCHARGED — the
  // stages.mjs copy and the phase2-execution.md copy. The skill-doc row's own note said the shape was
  // dictated TWICE, which is why they had to go in one diff: deleting either alone leaves the other ordering
  // a hand-write the grant now denies. `renderSkepticFlags` is the single authority for the line.
  //
  // 73 → 72 (, blind-frame): its "Emit the STRUCTURED model … your ONLY output file" row is DISCHARGED,
  // not reworded — the seat hands values to `record_blind_frame` and the driver writes the artifact, so the
  // dictation the row described is gone from served text. Its own `removedByMove` read "NOTHING ON THE
  // PLAN REMOVES THIS", which was true of that plan and false of the category conversion.
  // 69 → 64 → 60. Conversion 2 retired matter-frame's five rows; conversion 3 retired prelim-variants'
  // four (two literal-json-skeletons, two exactly-these-keys). The ceiling drops with them — this pin is a
  // ratchet and a shrink is the point of it. Nine of the sixty-nine gone in two conversions, and the four
  // just removed are the first whose DERIVATION went with them rather than changing hands.
  // 56 → 54 (, conversion 5): report-card's TWO dictated-line-shape rows retire — the `::p::`
  // bullet position and the final `- Source:` bullet. Its THIRD row does NOT retire and must not: see
  // E3_DATA_INPUT_EXEMPTIONS, printed below.
  // 60 → 56 (, conversion 4): report-overview's FOUR rows retire together — the front-matter key
  // set, the shell half of delivery-contract.md's 49-line fence, the three dictated-then-overwritten
  // fields, and the `# ACTIONS` line shape.
  //
  // AND THIS PIN — NOT the baseline — IS WHAT RECORDS THEM. The two E3 instruments are different
  // measurements that share kind names, and the difference was MEASURED on 430b5c51 rather than assumed:
  // `contract-e3-baseline.json` is a REGEX COUNTER (E3_PATTERNS) and it counts ZERO of these four. The
  // fence is a bare ``` fence of `key: value` lines, so `literal-json-skeleton` — which needs ```json or
  // `{"key":` — never saw it; the front-matter key set trips no `exactly-these-keys` phrase; the
  // `# ACTIONS` line carries no `<placeholder>`, so `dictated-line-shape` missed it; and `other` is the
  // kind the lint documents itself as structurally unable to see. A successor reading a clean baseline
  // diff as this conversion's proof would be reading the wrong instrument. The pin moving by exactly
  // four, with each row named at its retirement site, is the proof.
  // 51 -> 48: the three send stages' dictated-line-shape rows left with the stages themselves.
  assert.equal(E3_BACKLOG.length, 46,
    `the backlog is ${E3_BACKLOG.length}, pinned at 46. SHRUNK? good — regenerate contract-e3-baseline.json in the same commit so the ceiling drops with it, and say at the entry site what removed it. GROWN? a new dictated structure was registered rather than converted; that is a decision, so make it visible here.`);
  for (const e of E3_BACKLOG) {
    assert.ok(e.stage && e.where && e.evidence, "a backlog entry that does not name its site is not a backlog entry");
    assert.ok(E3_BACKLOG_KINDS.includes(e.kind), `unknown E3 kind ${e.kind}`);
    assert.ok(e.removedByMove.length > 0, `${e.stage} @ ${e.where}: an entry must name a move or state plainly that none removes it`);
  }
  // ── THE EXEMPTIONS ARE PRINTED, EVERY RUN ( conversion 5) ─────────────────────────────────
  //
  // A site the lint counts but the taxonomy does not mean. The alternative was narrowing the regex until
  // it stopped matching, which would silence the next REAL literal skeleton with it and leave nobody able
  // to say which sites were dropped. So the exemption is a declared entry that names itself out loud on
  // every run, and each one must still resolve — an exemption protecting nothing is a hole with a comment.
  assert.ok(E3_DATA_INPUT_EXEMPTIONS.length > 0,
    "an empty exemption list would mean the reason was deleted rather than the site — check the regex was not narrowed instead");
  for (const e of E3_DATA_INPUT_EXEMPTIONS) {
    assert.ok(e.stage && e.kind && e.where, "an exemption that does not name its site is a silent filter");
    assert.ok(e.why.length > 120, "an exemption whose reason fits on one line is a silent filter with a comment");
    assert.ok(E3_KINDS.includes(e.kind), `unknown E3 kind ${e.kind} in an exemption`);
    assert.ok(STAGES[e.stage], `${e.stage}: an exemption for a stage that does not exist`);
    console.log(`# E3 EXEMPT (data-input, not dictation): ${e.stage} / ${e.kind} @ ${e.where}`);
  }

  // The measurement that must stay visible: most of the backlog is removed by NOTHING on the plan.
  assert.ok(E3_UNPLANNED.length > 0,
    "if nothing is unplanned any more, every dictated structure has a move — say so in the handover, it is a milestone");
});

test("E3: knockout-frame and knockout-assess are linted but carry no E1 declaration (a recorded gap)", () => {
  // audits both; they live in stages-knockout.mjs, not STAGES, so this scaffolding does not declare
  // them. Recorded rather than skipped so the next agent does not read their absence as coverage.
  assert.deepEqual(Object.keys(KO_STAGES).sort(), ["knockout-assess", "knockout-frame"]);
  for (const k of Object.keys(KO_STAGES)) {
    assert.equal(KO_STAGES[k].contractElements, undefined,
      "the knockout lane has gained a declaration — fold it into ALL_STAGES and the partition, and delete this test");
  }
});

test("E2: the mechanical-AND-unspoken set is findable — the highest-value target for the moves", () => {
  // An element here is not the model's judgment AND nothing polices it. Both halves of 's argument
  // point at this set: it is work a model should not be doing, and a failure nothing would catch.
  // Recorded rather than gated — the moves are what shrink it, and arm 2's ratchet is what tracks it.
  const set = mechanicalAndUnspoken(STAGES);
  const baseline = readJson("contract-arm2-baseline.json");
  for (const row of set) {
    assert.ok(baseline.byStage[row.stage]?.includes(row.element),
      `${row.stage} / ${row.element} is mechanical and unspoken-for but missing from the arm-2 baseline — regenerate the baseline`);
    assert.ok(isMechanical(row.class));
  }
  assert.ok(set.length > 0 && set.length < baseline.total,
    `expected a non-empty mechanical-and-unspoken subset of the ${baseline.total} unspoken elements, got ${set.length}`);
});


// ── E3: DOES THE BACKLOG STILL DESCRIBE THE TREE? ────────────────────────────────────────────────────

test("E3: no backlog row outlives the dictation it describes", () => {
  // THE FAILURE THIS EXISTS FOR: a move deletes a dictation and the ROW survives. The count then
  // overstates the work left and the next agent spends a conversion slot on a hole already filled.
  // Two instances existed the day it was written — M6's register-digest no-form arm (deleted
  // 2026-08-14) and synthesis's disposition list (, deleted that same morning by the agent
  // writing this test). Knowing about the disease did not prevent causing an instance of it.
  const misses = backlogEvidenceMisses(E3_BACKLOG, (f) => {
    try { return readFileSync(join(DRIVER, "..", f), "utf8"); } catch { return null; }
  });
  const now = misses.map((m) => `${m.stage}|${m.file}`).sort();
  assert.deepEqual(now, [...E3_EVIDENCE_UNRESOLVED].sort(),
    "the set of backlog rows whose evidence no longer resolves has CHANGED.\n" +
    "  GREW? a move deleted a dictation and left its row behind — delete the row, and say at the site what removed it.\n" +
    "  SHRANK? good: remove the entry from E3_EVIDENCE_UNRESOLVED in the same commit, so the fix is recorded rather than absorbed.\n" +
    "  These were TRIAGED on 2026-08-16 and not one was stale: every row described a dictation that still\n" +
    "  exists, and what failed was always the QUOTE (elisions, ${} interpolation, a quote spanning a ternary).\n" +
    "  Deleting one would UNDER-count the backlog, which is the opposite error and the harder one to notice.");
});

test("E3: an unreadable file is a FINDING, and a short anchor is not judged", () => {
  // Both arms of the silent-skip failure, asserted rather than trusted. A registry pointing at a file
  // that is gone must be reported, or this check goes quiet exactly when a whole surface moves; and an
  // anchor too short to identify anything must be visible as unjudged rather than counted as verified.
  const gone = backlogEvidenceMisses([{ stage: "x", where: "driver/nope.mjs:1", evidence: "a long enough quote to anchor on" }], () => null);
  assert.deepEqual(gone.map((m) => m.reason), ["unreadable"]);
  const short = backlogEvidenceMisses([{ stage: "x", where: "driver/a.mjs:1", evidence: "…${x}…" }], () => "anything");
  assert.deepEqual(short.map((m) => m.reason), ["anchor-too-short"]);
});

// ──: THE LINE NUMBER, WHICH backlogEvidenceMisses IS BLIND TO BY CONSTRUCTION ─────────────────
//
// That check reads the FILE — found anywhere in any named site is a pass — and it is right to. It
// answers "has this row outlived its dictation". Nothing answered "does the number send a reader to it",
// which is the half a reader actually uses. Measured 2026-08-23: 25 of 36 decidable rows pointed at the
// wrong line, all into stages.mjs, drifting +909 to +1737 — and every one of them passed
// backlogEvidenceMisses on the same run.
test("#1567 no backlog row's LINE NUMBER points away from the dictation it describes", () => {
  const { misses, notChecked } = backlogLineMisses(E3_BACKLOG, (f) => {
    try { return readFileSync(join(DRIVER, "..", f), "utf8"); } catch { return null; }
  });
  // criterion 3 — `misses: 0` is never reported without `notChecked` beside it. Alone it reads as
  // "the line numbers are right now", and the rows it did not ask about were the ones most likely to
  // drift: the exemption it used to grant correlated with the defect rather than being independent of it.
  assert.deepEqual(misses.map((m) => `${m.where} -> ${m.actual}`), [],
    `${misses.length} miss(es); ${notChecked.length} of ${E3_BACKLOG.length} rows NOT CHECKED.\n` +
    "a backlog row cites a line that does not carry its own evidence.\n" +
    "  The repair is MECHANICAL: `actual` is where the dictation now starts. Repoint `where` at it.\n" +
    "  Do NOT edit the evidence to match the line — the evidence is the answer key, the number is the claim.");
});

test("#1567 an undecidable row is reported as NOT-CHECKED, never absorbed into the pass", () => {
  // THE FAILURE THIS PINS: a guard whose undecidable slice reads green is the false-clean the
  // family exists to remove. The count is pinned so the slice cannot quietly grow to cover a defect.
  const { misses, notChecked } = backlogLineMisses(E3_BACKLOG, (f) => {
    try { return readFileSync(join(DRIVER, "..", f), "utf8"); } catch { return null; }
  });
  const byReason = {};
  for (const n of notChecked) byReason[n.reason] = (byReason[n.reason] ?? 0) + 1;
  //: `not-a-plain-citation` is GONE. The guard declined a citation for carrying a note after it —
  // a format rule doing a semantics job — and 7 of the rows it declined were wrong, two by exactly
  // +1395, the cluster this guard was built to find. Decidable went 32 -> 41.
  // 7 -> 6 at conversion 10: the synthesis narrative "## Answers to your
  // instructions" row is DELETED with its dictation, and it was one of the seven. A SHRINK by deletion,
  // which is the good direction — but note what it exposes: a row whose dictation dies while its quote
  // was already un-anchorable is INVISIBLE in this bucket, because the bucket's stated meaning is
  // "un-anchorable quote over a live dictation". Nothing here can tell those two apart; the deletion was
  // found by reading the conversion's own diff, not by this arm.
  assert.deepEqual(byReason, { "anchor-not-found": 6 },
    `the UNDECIDABLE slice moved. It is ${notChecked.length} of ${E3_BACKLOG.length} rows, leaving ` +
    `${E3_BACKLOG.length - notChecked.length} actually checked.\n` +
    "  GREW? a row stopped being checkable — that is coverage lost, not a pass. Say why at the entry.\n" +
    "  SHRANK? good: lower the number here in the same commit.\n" +
    "  The five anchor-not-found rows were each read by hand on 2026-08-23 and are correct; their\n" +
    "  evidence carries ${} interpolation or spans a template line, which is why the anchor cannot\n" +
    "  locate them — the same limit backlogEvidenceMisses records in E3_EVIDENCE_UNRESOLVED.");
  // Every row lands in exactly one bucket: checked-and-clean, checked-and-missed, or not-checked.
  assert.equal(notChecked.length + misses.length <= E3_BACKLOG.length, true,
    "a row was counted twice — the buckets are not disjoint");
});

test("#1567 the CALL SITE catches a planted wrong line, and clears the right one", () => {
  // A GREEN ARM ON THE HELPER IS NOT A GUARDED CALL SITE. Both real defects this guard found were at
  // the call site, and a helper test would have passed with backlogLineMisses never wired in. So the
  // plant goes through the exported entry point, on a fixture whose answer is known by construction.
  const FILE = ["// preamble", "// more preamble", "THE DICTATED SHAPE: exactly these keys", "// tail"].join("\n");
  const read = (f) => (f === "driver/a.mjs" ? FILE : null);   // `a`/`nope`: names citation-line-check
  // already exempts as plants from THIS file (EXEMPT_TARGETS), so the fixture does not dangle its guard.
  const row = (where) => [{ stage: "planted", where, evidence: "THE DICTATED SHAPE: exactly these keys" }];

  const right = backlogLineMisses(row("driver/a.mjs:3"), read);
  assert.deepEqual(right.misses, [], "the CORRECT citation must not be flagged");
  assert.deepEqual(right.notChecked, [], "the correct citation must be CHECKED, not merely unflagged");

  const wrong = backlogLineMisses(row("driver/a.mjs:1"), read);
  assert.equal(wrong.misses.length, 1, "a citation pointing two lines off its dictation must be caught");
  assert.equal(wrong.misses[0].actual, 3);
  assert.equal(wrong.misses[0].drift, 2);

  // An absence is a finding: an unreadable site is NOT-CHECKED, never a pass.
  const gone = backlogLineMisses(row("driver/nope.mjs:3"), read);
  assert.deepEqual(gone.misses, []);
  assert.deepEqual(gone.notChecked.map((n) => n.reason), ["unreadable"]);
});

test("#1731 a citation carrying a note after it is DECIDED, not exempted for having prose", () => {
  // THE EXEMPTION CORRELATED WITH THE DEFECT. `where` carries a parenthetical precisely when it names
  // several sites or a restatement — the rows most likely to drift — so declining them was not a
  // neutral loss of coverage. Two of the eleven declined were wrong by exactly +1395.
  const FILE = ["// preamble", "// more", "THE DICTATED SHAPE: exactly these keys", "// tail"].join("\n");
  const read = (f) => (f === "driver/a.mjs" ? FILE : null);
  const row = (where) => [{ stage: "planted", where, evidence: "THE DICTATED SHAPE: exactly these keys" }];

  for (const note of [
    "driver/a.mjs:3 (restated at driver/skills/a/rules.md:461)",
    "driver/a.mjs:3 (emitted at 1032, 1061)",
    "driver/a.mjs:3 and driver/nope.mjs:9 (two sites)",
  ]) {
    const r = backlogLineMisses(row(note), read);
    assert.deepEqual(r.notChecked, [], `"${note}" must be DECIDED, not exempted`);
    assert.deepEqual(r.misses, [], `"${note}" points at the dictation and must pass`);
  }

  // The same shapes with a WRONG leading line are caught rather than waved through.
  const wrong = backlogLineMisses(row("driver/a.mjs:1 (restated at driver/skills/a/rules.md:461)"), read);
  assert.equal(wrong.misses.length, 1);
  assert.equal(wrong.misses[0].actual, 3);

  // A `where` that does NOT lead with a citation stays undecided — the leading citation is the one a
  // reader follows, and there is nothing to take from a string that does not open with one.
  const prose = backlogLineMisses(row("the form built in driver/a.mjs:3"), read);
  assert.deepEqual(prose.misses, []);
  assert.deepEqual(prose.notChecked.map((n) => n.reason), ["not-a-plain-citation"]);
});

test("#1567 anchorWindows returns the FIRST line of a dictation, not its last", () => {
  // THE BUG THIS PINS cost a whole measurement. Growing the START forward returns (end - cap) every
  // time: any start before the real one still contains the anchor once the end reaches it, so the
  // smallest start wins and it is always the cap away. It reported span 40 on every row and would have
  // moved every repair by up to 40 lines. `start` is the value the guard reports and repairs against.
  const src = ["alpha", "beta", "GAMMA starts here", "and continues", "delta"].join("\n");
  assert.deepEqual(anchorWindows(src, "GAMMA starts here and continues").map((w) => w.start), [3]);
  assert.deepEqual(anchorWindows(src, "beta").map((w) => w.start), [2]);
  assert.deepEqual(anchorWindows(src, "nowhere in this text"), []);
  // FOUND-IN-ANY: a dictation restated elsewhere is cited correctly by EITHER window, so both come
  // back. Separated by more than the 40-line cap, they cannot merge into one permissive span.
  const twice = ["X repeated", ...Array(60).fill("filler"), "X repeated"].join("\n");
  assert.deepEqual(anchorWindows(twice, "X repeated").map((w) => w.start), [1, 62]);
  // Windows merge only within the cap, so a match can never license a line an arbitrary distance away.
  const wide = ["ANCHOR HERE", ...Array(200).fill("filler")].join("\n");
  const [w] = anchorWindows(wide, "ANCHOR HERE");
  assert.ok(w.end - w.start <= 40, `a merged window spans ${w.end - w.start} lines — the cap is meant to bound it`);
});


test("VOID CONTROL: the matcher really can find a quote, and really can miss one", () => {
  // Without this, every assertion above is satisfied by a matcher that reports everything as missing
  // (or nothing). Both directions, on an invented corpus so it cannot drift with the tree.
  const entry = (ev) => [{ stage: "s", where: "driver/f.mjs:1", evidence: ev }];
  assert.deepEqual(backlogEvidenceMisses(entry("the quick brown fox jumps"), () => "… the quick brown fox jumps …"), [],
    "a present quote must NOT be reported missing");
  assert.equal(backlogEvidenceMisses(entry("the quick brown fox jumps"), () => "nothing like it here at all").length, 1,
    "an absent quote MUST be reported");
  // …and the anchor is the longest LITERAL run, so interpolation cannot make a quote unfindable.
  assert.equal(evidenceAnchor('set "disposition" to ${TOKENS.join(" / ")} exactly once per row'),
    "exactly once per row".length > 'set "disposition" to'.length ? "exactly once per row" : 'set "disposition" to');
});

// ── EVERY PATH IN `where`, NOT JUST THE FIRST ───────────────────────────────────────────────────────
//
// `where` was resolved as `String(e.where).split(":")[0]` — the FIRST path, always. Five backlog rows name
// more than one FILE (a dictation in stages.mjs AND its skill file; a rule "restated at
// synthesis-rules.md"; report-card's host table dictated in delivery-contract.md), so for those rows the
// SECOND site was never read. A dictation could be deleted there and this check would report nothing —
// which is the exact failure it exists to catch, one level up, inside the checker.
//
// THE PLANTS LIVE HERE AND NOWHERE NEAR THE REGISTRY. A fixture that reached E3_BACKLOG would move the 76
// pin, so the corpus below is invented and self-contained.

test("wherePaths: every distinct path, de-duplicated; the same file at two lines is ONE path", () => {
  assert.deepEqual(wherePaths("driver/stages.mjs:1869 and driver/skills/narrative-refutation/SKILL.md:41-50"),
    ["driver/stages.mjs", "driver/skills/narrative-refutation/SKILL.md"]);
  // The same file twice is one SITE. Counting it as two is how "10 multi-file rows" was over-reported
  // by 2× before this function existed to answer the question.
  assert.deepEqual(wherePaths("driver/stages.mjs:1054 and driver/stages.mjs:1062"), ["driver/stages.mjs"]);
  assert.deepEqual(wherePaths("driver/skills/a/SKILL.md:175 (restated at driver/skills/b/rules.md:427)"),
    ["driver/skills/a/SKILL.md", "driver/skills/b/rules.md"]);
  // A bare filename in prose is not a location — a path needs at least one slash.
  assert.deepEqual(wherePaths("see SKILL.md for the shape"), []);
});

test("KNOWN POSITIVE (planted): the anchor lives ONLY in the second path — old matcher MISSES, new one RESOLVES", () => {
  // Planted, because no live row exercises this today: all five multi-path rows either carry the anchor
  // in their FIRST path or in neither. A tree-anchored positive that does not exist cannot be required,
  // so the mechanism is proven on an invented corpus instead — and the plant asserts its own premise
  // rather than assuming it.
  const ANCHOR = "the seat opens every flag with exactly one of these kinds";
  const FIRST = "driver/first.mjs", SECOND = "driver/skills/second/SKILL.md";
  const corpus = { [FIRST]: "prose that does not contain it", [SECOND]: `… ${ANCHOR} …` };
  const read = (f) => corpus[f] ?? null;
  const row = [{ stage: "planted", where: `${FIRST}:10 and ${SECOND}:41-50`, evidence: ANCHOR }];

  // (a) THE PLANT'S OWN PREMISE, CHECKED NOT ASSUMED — otherwise this passes for the wrong reason.
  assert.ok(!normalizeQuote(corpus[FIRST]).includes(ANCHOR), "premise: the anchor must be ABSENT from path 1");
  assert.ok(normalizeQuote(corpus[SECOND]).includes(ANCHOR), "premise: the anchor must be PRESENT in path 2");
  assert.equal(wherePaths(row[0].where).length, 2, "premise: the row must actually name two paths");

  // (b) OLD BEHAVIOUR AND NEW, SIDE BY SIDE, SO THE DELTA IS THE ASSERTION.
  const oldFile = String(row[0].where).split(":")[0];          // exactly what the old resolver did
  assert.equal(oldFile, FIRST, "the old resolver reads only the first path");
  assert.ok(!normalizeQuote(read(oldFile)).includes(ANCHOR),
    "OLD: resolving only the first path, the anchor is not found — this row would have been reported missing");
  assert.deepEqual(backlogEvidenceMisses(row, read), [],
    "NEW: the anchor resolves because the SECOND path was read — the mechanism, not merely the verdict");
});

test("NEGATIVE CONTROL (planted): an unreadable SECOND path is as loud as an unreadable first", () => {
  // Without this, per-site reading could silently degrade to first-path-only and every assertion above
  // would still pass. The miss must name the SECOND path, not the row's first.
  const FIRST = "driver/first.mjs", SECOND = "driver/skills/gone/SKILL.md";
  const read = (f) => (f === FIRST ? "the anchor phrase lives here in full" : null);
  const row = [{ stage: "planted", where: `${FIRST}:10 and ${SECOND}:41`, evidence: "the anchor phrase lives here in full" }];
  const misses = backlogEvidenceMisses(row, read);
  assert.equal(misses.length, 1, "a missing second site must be reported even though the anchor resolved elsewhere");
  assert.equal(misses[0].reason, "unreadable");
  assert.equal(misses[0].file, SECOND, "the miss must name the SECOND path — naming the first would hide which site is gone");
  // and the same row with BOTH sites readable is clean, so the control is not firing on the row's shape
  assert.deepEqual(backlogEvidenceMisses(row, () => "the anchor phrase lives here in full"), []);
});

test("a `where` naming no resolvable path is an ABSENCE, not a silent pass", () => {
  // The old resolver would have read "" and searched a file that cannot exist; the failure mode is a
  // confident pass on a row nobody can locate.
  const misses = backlogEvidenceMisses([{ stage: "planted", where: "somewhere in the prompt", evidence: "a long enough anchor to judge" }], () => "anything");
  assert.deepEqual(misses.map((m) => m.reason), ["no-path-in-where"]);
});

// ── E3, SECOND AXIS: THE DELIVERY SURFACE ────────────────────────────────────────────────────
//
// `where` names the AUTHORED site. It cannot say how the seat receives the text, and dictations are
// migrating into tool answers as policy — so to the file-only check a moved dictation and a deleted one
// are the same red, and the two repairs a reader reaches for are both wrong.
//
// The tree is DERIVED here and recited nowhere: a recited server list stops covering a server the day one
// is added, and the check then reports clean because it never looked.

const MCP_SERVERS = readdirSync(join(DRIVER, "engine", "mcp"))
  .filter((f) => /-server\.mjs$/.test(f)).map((f) => `driver/engine/mcp/${f}`);
const SKILL_READS = [...new Set(Object.values(STAGES).flatMap((d) => d.skillReads ?? []))];
const TREE = { skillReads: SKILL_READS, servers: MCP_SERVERS };
const REGISTRY = "driver/contract-e3-backlog.mjs";
const readRepo = (p) => { try { return readFileSync(join(DRIVER, "..", p), "utf8"); } catch { return null; } };

/**
 * Every driver source the anchor of a moved dictation could have landed in.
 *
 * THE EXCLUSIONS ARE THE WHOLE DESIGN, not housekeeping. `contract-e3-backlog.mjs` quotes every anchor
 * verbatim by construction, and `driver/test/` carries the planted ones — a corpus containing either
 * reports every unresolved row as "moved" into it, which reads as a spectacular finding and is an
 * artifact of the search. The test below asserts the exclusion is LOAD-BEARING, not merely spelled.
 */
function surfaceCorpus() {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((x) => {
    if (x.name === "node_modules" || x.name.startsWith(".")) return [];
    const p = join(d, x.name);
    return x.isDirectory() ? walk(p) : (/\.(mjs|md)$/.test(x.name) ? [`driver/${p.slice(DRIVER.length + 1)}`] : []);
  });
  return walk(DRIVER).filter((p) => p !== REGISTRY && !p.startsWith("driver/test/"));
}

test("E3 surface: every row declares one, from the closed enum, witnessed by a path it names", () => {
  // PREMISE FIRST — a derivation that found nothing would make every assertion below vacuously true.
  assert.ok(MCP_SERVERS.length > 0, "no MCP server modules found: the tool-response witness can never fire");
  assert.ok(SKILL_READS.length > 0, "no skillReads declared: the skill-file witness can never fire");

  assert.deepEqual(backlogSurfaceMisses(E3_BACKLOG, TREE), [],
    "a backlog row's declared delivery surface is absent, off-enum, or witnessed by NO path the row names.\n" +
    "  surface-unwitnessed is the #1044 event: the dictation moved and `where` was updated, but `surface` was not.\n" +
    "  Fix the DECLARATION — say which surface delivers it now — rather than deleting the row or re-quoting it.\n" +
    `  The enum is closed: ${E3_SURFACES.join(" / ")}.`);
});

test("E3 surface: the per-surface census is exact in BOTH directions, and its arithmetic closes", () => {
  // EXACT, NOT A CEILING. 's urgency claim is that `tool-response` GROWS; a ceiling on it fails
  // upward exactly as the E3 ceiling did in — a surface that shrank would pass silently and leave
  // room for a move nobody recorded. Red on a legitimate migration IS the recording step.
  const now = surfaceCensus(E3_BACKLOG);
  assert.deepEqual(now, { ...E3_SURFACE_CENSUS },
    "the per-surface census MOVED. A row migrating from `stage-message` to `tool-response` is exactly the\n" +
    "  event this pins — record the new numbers in E3_SURFACE_CENSUS and say in the PR which row moved.");
  // …and no row escapes the enum: the census must account for every row, or a mistyped surface would
  // sit outside all four counters and the totals would still look plausible.
  assert.equal(Object.values(now).reduce((a, b) => a + b, 0), E3_BACKLOG.length,
    "the census does not add up to the backlog length — a row carries a surface outside the enum");
});

test("E3 surface: no live row's dictation has moved to a surface its row does not claim", () => {
  const corpus = surfaceCorpus();
  assert.ok(!corpus.includes(REGISTRY), "the registry must never be in the corpus — it quotes every anchor verbatim");
  assert.ok(corpus.length > 50, `corpus collapsed to ${corpus.length} files — an empty search reports no moves and reads as a pass`);

  const moves = backlogSurfaceMoves(E3_BACKLOG, readRepo, corpus, TREE);
  assert.deepEqual(moves.map((m) => `${m.stage} → ${m.foundIn} [${m.surface.join("+")}]`), [],
    "a backlog row's anchor is ABSENT from every path it names and PRESENT somewhere else.\n" +
    "  That is a dictation that MOVED SURFACE, not one that was deleted: re-point `where` at the new site\n" +
    "  and re-declare `surface`. Retiring the row would under-count the backlog.");
});

test("THE EXCLUSION IS LOAD-BEARING: with the registry in the corpus, every unresolved row reports as moved", () => {
  // Without this, the exclusion could silently regress — a corpus builder that stopped filtering would
  // turn the list above into noise while staying green, because the noise is what it would report.
  const intoRegistry = backlogSurfaceMoves(E3_BACKLOG, readRepo, [REGISTRY], TREE);
  const unresolved = backlogEvidenceMisses(E3_BACKLOG, readRepo).filter((m) => m.reason === "not-found");
  assert.equal(intoRegistry.length, unresolved.length,
    "the registry quotes every anchor, so every row that fails to resolve at its own sites must be found in it");
  assert.ok(intoRegistry.length > 0, "premise: at least one row must be unresolved, or this control proves nothing");
  assert.deepEqual([...new Set(intoRegistry.map((m) => m.foundIn))], [REGISTRY]);
});

test("KNOWN POSITIVE (planted): a dictation that moved from the stage message into a TOOL ANSWER", () => {
  // Planted, and the PR says so: measured across all 51 live rows on 2026-08-18, ZERO have their anchor
  // absent from `where` and present elsewhere. A tree-anchored positive that does not exist cannot be
  // required, so the mechanism is proven on an invented corpus — the same choice the multi-path plant
  // above makes, for the same reason.
  const ANCHOR = "record it on its own line in exactly the shape the driver parses";
  const STAGES_MJS = "driver/stages.mjs", SERVER = "driver/engine/mcp/invented-server.mjs";
  const corpus = { [STAGES_MJS]: "the dispatch no longer says anything of the kind", [SERVER]: `… ${ANCHOR} …` };
  const read = (f) => corpus[f] ?? null;
  const tree = { skillReads: [], servers: [SERVER] };
  const row = [{ stage: "planted", where: `${STAGES_MJS}:100`, evidence: ANCHOR, surface: "stage-message" }];

  // (a) PREMISE, CHECKED NOT ASSUMED.
  assert.ok(!normalizeQuote(corpus[STAGES_MJS]).includes(ANCHOR), "premise: the anchor must be GONE from the stage message");
  assert.ok(normalizeQuote(corpus[SERVER]).includes(ANCHOR), "premise: the anchor must be PRESENT on the server");

  // (b) OLD BEHAVIOUR: a plain not-found. True, and it names neither where the text went nor that it went.
  const old = backlogEvidenceMisses(row, read);
  assert.deepEqual(old.map((m) => m.reason), ["not-found"]);
  assert.equal(old[0].sites.length, 1, "the old check knows only the file it was told to look in");

  // (c) NEW: the move is named, and so is the surface it moved TO. That delta is the whole issue.
  const moves = backlogSurfaceMoves(row, read, Object.keys(corpus), tree);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].foundIn, SERVER, "the miss must name the file the dictation moved to");
  assert.deepEqual(moves[0].surface, ["tool-response"], "…and the SURFACE, which is what tells the reader not to retire the row");

  // (d) and the row's own declaration is now false — the second question, asked separately.
  assert.deepEqual(backlogSurfaceMisses([{ ...row[0], surface: "tool-response" }], tree).map((m) => m.reason),
    ["surface-unwitnessed"],
    "re-declaring the surface without re-pointing `where` must NOT go green: the witness has to be a path the row names");
});

test("NEGATIVE CONTROL (planted): an unwitnessed, absent or off-enum surface is refused", () => {
  const tree = { skillReads: ["skills/planted/SKILL.md"], servers: ["driver/engine/mcp/planted-server.mjs"] };
  const at = (where, surface) => [{ stage: "planted", where, evidence: "a long enough anchor to judge", surface }];
  assert.deepEqual(backlogSurfaceMisses(at("driver/stages.mjs:1", "tool-response"), tree).map((m) => m.reason),
    ["surface-unwitnessed"], "claiming a tool response while naming only the stage file must be refused");
  assert.deepEqual(backlogSurfaceMisses(at("driver/stages.mjs:1", undefined), tree).map((m) => m.reason),
    ["surface-absent"], "a row with no surface is an ABSENCE, never a default");
  assert.deepEqual(backlogSurfaceMisses(at("driver/stages.mjs:1", "mcp"), tree).map((m) => m.reason),
    ["surface-off-enum"], "the enum is closed");
  // …and the SAME claim goes green once the row names the delivering path, so the control is not simply
  // firing on the row's shape.
  assert.deepEqual(backlogSurfaceMisses(at("driver/connotation-search.mjs:1 delivered via driver/engine/mcp/planted-server.mjs:9", "tool-response"), tree), []);
});

test("surfaceWitnesses: all four surfaces, including the one with no live members", () => {
  // `driver-written-form` has ZERO rows today (pinned in E3_SURFACE_CENSUS). An enum member no row
  // exercises is a member nothing has tested, so it is exercised here on an invented path.
  const tree = { skillReads: ["skills/planted/SKILL.md"], servers: ["driver/engine/mcp/planted-server.mjs"] };
  assert.deepEqual(surfaceWitnesses("driver/stages.mjs", tree), ["stage-message"]);
  assert.deepEqual(surfaceWitnesses("driver/stages-knockout.mjs", tree), ["stage-message"]);
  assert.deepEqual(surfaceWitnesses("driver/skills/planted/SKILL.md", tree), ["skill-file"],
    "skillReads are driver-relative and `where` paths are repo-relative — the normalisation is the point");
  assert.deepEqual(surfaceWitnesses("driver/engine/mcp/planted-server.mjs", tree), ["tool-response"]);
  assert.deepEqual(surfaceWitnesses("driver/coverage-form.mjs", tree), ["driver-written-form"],
    "the residue class: a driver module that is not a stage file, a read skill or a server");
  // A skill .md NO stage reads witnesses nothing — a dictation in an unread file is not delivered at all.
  assert.deepEqual(surfaceWitnesses("driver/skills/unread/SKILL.md", tree), []);
  assert.deepEqual(surfaceWitnesses("docs/architecture/04-configuration-reference.md", tree), []);
});
