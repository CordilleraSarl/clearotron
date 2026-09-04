// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Depth 2 — the register hit-count lane (driver/register-count.mjs) and what it puts on the page.
//
// The lane is deterministic code with no model in it, so these are ordinary unit tests. What they
// guard is not arithmetic but MEANING: that an untaken count never reads as zero, that the scope a
// number claims is the scope it was taken at, and that a provider which cannot count refuses the
// product outright instead of publishing a page of honest-looking noughts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COUNT_PREDICATES, COUNT_BASIS, countPreflight, countRegisterHits, countedMarks, countsForMark,
  countLine, variantFormsLine, resolveCountExecutor,
} from "../register-count.mjs";
import { variantForms } from "../register-variants.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { buildKnockoutWorkbook } from "../publish/knockout.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";

const CORSEARCH = capabilitiesFor("corsearch");
const CLARIVATE = capabilitiesFor("clarivate");
const SIGNA = capabilitiesFor("signa");
const AT = () => new Date("2026-07-22T09:00:00Z");

const run = (opts) => countRegisterHits({
  provider: "corsearch", capabilities: CORSEARCH, now: AT, ...opts,
});

// ── preflight: the refusals that must happen BEFORE anything is spent ───────────────────────────────

test("a register that cannot count REFUSES the product — it does not publish zeroes", () => {
  // ── NO SHIPPED PROVIDER TRIGGERS THIS ANY MORE, AND THAT IS WORTH SAYING OUT LOUD ───────────────
  // signa was the exemplar: `countProbe: "none"`, no total anywhere. found the total behind an
  // opt-in flag (`options.include_total`) and moved it to "cheap", so all five providers can count and
  // this refusal has no real contract left to fire on. It is kept, and driven from a synthetic one,
  // because the guard is about what happens when a provider CANNOT count — and the next provider
  // wired might not be able to. A guard deleted for want of a current example is a guard that has to
  // be rediscovered by an incident.
  const CANNOT_COUNT = { ...SIGNA, id: "thinco", countProbe: "none", kernel: { ...SIGNA.kernel, countProbe: "none" } };
  const why = countPreflight({ capabilities: CANNOT_COUNT, jurisdictions: ["US"] });
  assert.ok(why, "a provider with no total anywhere — countProbe 'none'");
  assert.match(why, /cannot count/);
  assert.match(why, /never be rendered as "no filings found"/,
    "the refusal says WHY a partial count is worse than no product");
  assert.match(why, /plain "knockout" level/, "and what to run instead");
  // …and the counterpart: signa's real contract now PASSES preflight, so Stage 0.5 runs where it used
  // to refuse outright. Pinned in this direction too — a contract reverted to "none" would silently
  // withdraw a product from a provider that can serve it, and only this line would notice.
  assert.equal(SIGNA.countProbe, "cheap");
  assert.equal(countPreflight({ capabilities: SIGNA, jurisdictions: ["US"] }), null,
    "#1030: signa counts now — an exact corpus total on the search response");
});

test("preflight passes on a counting provider, and names a missing credential rather than failing per mark", () => {
  assert.equal(countPreflight({ capabilities: CORSEARCH, jurisdictions: ["US"] }), null);
  assert.match(countPreflight({ capabilities: CORSEARCH, jurisdictions: [], credentialPresent: false }), /credential is absent/);
  assert.match(countPreflight({ capabilities: CORSEARCH, jurisdictions: [], hasAdapter: false }), /cannot count/);
});

test("a provider that REQUIRES territories runs worldwide, and refuses only a scope it cannot reach", () => {
  // This assertion used to be the opposite — a worldwide run on clarivate was refused up front,
  // because resolveRegions handed EVERY provider corsearch's shorthand for worldwide (an empty region
  // filter) and clarivate's buildSearchRequest throws without regions[]. Twenty identical failures and
  // an empty column was indeed worse than one sentence; but the refusal was the missing translation
  // wearing a safety jacket. resolveRegions now compiles worldwide to the provider's own office list,
  // so there is a real scope to count in and nothing left to refuse.
  assert.equal(countPreflight({ capabilities: CLARIVATE, jurisdictions: null }), null,
    "worldwide is runnable — it sweeps every office the vendor covers");
  assert.equal(countPreflight({ capabilities: CLARIVATE, jurisdictions: [] }), null);
  assert.equal(countPreflight({ capabilities: CLARIVATE, jurisdictions: ["United States"] }), null,
    "a display name resolves — the territory bridge is the shared one");
  // What the guard still catches, and must: every NAMED territory outside the provider's coverage.
  // regions is empty there too, but with deferrals beside it — there is no honest scope to count in,
  // and sweeping the world instead would be the exact inversion of what was asked.
  //
  // changed the WORDING and widened the gate, not the outcome here. This refusal used to be
  // reachable only on a provider declaring `regionsRequired`, which clarivate does and no free-tier
  // provider does — so the same uncovered scope refused on the paid vendor and silently counted
  // elsewhere on the free one. It now keys on the coverage, which is what the sentence was always
  // about, and says so in terms a reader can act on rather than quoting a wire-protocol requirement.
  const narnia = countPreflight({ capabilities: CLARIVATE, jurisdictions: ["Narnia"] });
  assert.match(narnia, /NARNIA/, "the territory that cannot be counted is named");
  assert.match(narnia, /which clarivate does not cover/);
  assert.match(narnia, /no scope left to count in/);
  // corsearch is unchanged: no region clause IS a worldwide sweep, so worldwide was always runnable.
  assert.equal(countPreflight({ capabilities: CORSEARCH, jurisdictions: [] }), null);
});

// ── the counts themselves ───────────────────────────────────────────────────────────────────────────

test("three counts per mark, class-scoped, with the scope each figure was taken at recorded", async () => {
  const asked = [];
  const doc = await run({
    marks: [{ name: "IRONWHISK", classes: [8, 21] }, { name: "CLUVENDRA" }],
    classes: [35], jurisdictions: ["United States", "EU"],
    counter: async (mark, predicate, scope) => { asked.push({ mark, key: predicate.key, term: mark, ...scope }); return { ok: true, total: 7 }; },
  });
  // The expansion predicate is N calls, not one, so the expected total is DERIVED from the generator
  // rather than typed in: a rule-table edit must move this number, and a hard-coded 15 would either
  // fail for the wrong reason or (worse, once someone "fixed" it) stop watching the fan-out at all.
  const formsOf = (m) => variantForms(m).forms.map((f) => f.form);
  assert.equal(asked.length, 2 * 2 + formsOf("IRONWHISK").length + formsOf("CLUVENDRA").length,
    "2 marks × (2 simple predicates + one call per generated variant form)");
  const forMark = (m) => asked.filter((a) => a.mark === m || formsOf(m).includes(a.mark));
  assert.deepEqual([...new Set(forMark("IRONWHISK").map((a) => a.key))], ["identical", "containing", "close"],
    "all three questions, every mark");
  // Every variant probe uses the EXACT predicate — no provider is asked a fuzzy question anywhere.
  const closeCalls = asked.filter((a) => a.key === "close");
  assert.deepEqual([...new Set(closeCalls.map((a) => a.term))].sort(),
    [...formsOf("IRONWHISK"), ...formsOf("CLUVENDRA")].sort(),
    "the close column asks the register about the generated forms, and about nothing else");
  assert.ok(!closeCalls.some((a) => a.term === "IRONWHISK" || a.term === "CLUVENDRA"),
    "the mark itself is never re-asked under the close column — that is the identical column, already paid for");

  assert.deepEqual(forMark("IRONWHISK")[0].classes, [8, 21], "the mark's own classes win");
  assert.deepEqual(forMark("CLUVENDRA")[0].classes, [35], "…and the batch's are the fallback");
  // WO rides along because an ordered territory is a STACK of registers: a Madrid registration
  // designating the US or the EU binds them, and the counts lane asks the same scope the search does.
  assert.deepEqual(forMark("IRONWHISK")[0].regions, ["US", "EU", "WO"],
    "display names never reach a provider adapter, and every binding layer is asked about");
  // The variant probes inherit the SAME class and territory scope as the two simple predicates — an
  // all-classes close-variation figure beside a class-scoped identical one would be two scopes in one row.
  assert.ok(closeCalls.every((a) => a.classes.length && a.regions.length),
    "every variant probe carries the row's own scope");

  assert.equal(doc.marks[0].classScope, "mark");
  assert.equal(doc.marks[1].classScope, "batch");
  assert.equal(doc.basis, COUNT_BASIS, "the deliverable states what was counted, from one constant");
  assert.equal(countedMarks(doc), 2);
});

test("the close column is a SUM over the generated forms, and the forms ride with the figure", async () => {
  const doc = await run({
    marks: [{ name: "ALCHEMIST" }],
    counter: async (term, p) => ({ ok: true, total: p.key === "close" ? 2 : (p.key === "identical" ? 5 : 40) }),
  });
  const cell = doc.marks[0].counts.close;
  const forms = variantForms("ALCHEMIST").forms.map((f) => f.form);
  assert.deepEqual(cell.forms.map((f) => f.form), forms, "every generated form is recorded with its own figure");
  assert.equal(cell.total, 2 * forms.length, "the column is the sum of what each form found");
  assert.equal(cell.counted, forms.length);
  assert.ok(forms.includes("ALKEMIST"), "the near-form counsel named is in the set (ALKEMIST for ALCHEMIST)");
  // The rule that produced a form travels with it — a number nobody can trace to a rule is unauditable.
  assert.ok(cell.forms.every((f) => Array.isArray(f.rules) && f.rules.length));
  assert.match(variantFormsLine(doc.marks[0]), /ALKEMIST/, "and the report has one line naming them");
  assert.match(countLine(doc.marks[0]), /on close variations/,
    "the glance line says FILINGS on close variations, never a count of the variations themselves");
});

test("a PARTIAL variant sweep is null, not a smaller number", async () => {
  // The sum over a half-answered form set is a lower bound wearing the clothes of a total. That is the
  // never-zero rule one step along: a confident small figure over a name that may be everywhere.
  let n = 0;
  const doc = await run({
    marks: [{ name: "ALCHEMIST" }],
    counter: async (_t, p) => {
      if (p.key !== "close") return { ok: true, total: 1 };
      return (++n === 2) ? { ok: false, reason: "HTTP 502 from the register" } : { ok: true, total: 3 };
    },
  });
  const cell = doc.marks[0].counts.close;
  assert.equal(cell.total, null, "one form missing ⇒ no total");
  assert.match(cell.unavailable, /1 of \d+ variant form\(s\) could not be counted/);
  assert.match(cell.unavailable, /HTTP 502/, "with the provider's own words kept");
  assert.equal(cell.deterministic, undefined, "a 502 is transient — a resume may still complete this cell");
  assert.equal(cell.counted, cell.forms.length - 1, "…and every form that DID land keeps its figure");
  assert.ok(cell.forms.some((f) => Number.isFinite(f.total)), "nothing measured is thrown away");
  assert.match(countLine(doc.marks[0]), /on close variations: not available/);
  assert.doesNotMatch(countLine(doc.marks[0]), /\b0\b/);
  // …and the forms line beside that "not available" does not call them COUNTED. The column has no
  // figure precisely because some of these searches never ran; "counted" there would tell the reader
  // the searches happened and only the arithmetic went missing.
  const line = variantFormsLine(doc.marks[0]);
  assert.match(line, /Close variations searched/);
  assert.doesNotMatch(line, /Close variations counted/);
  assert.match(line, /1 of \d+ could not be counted/, "and it names how many, beside the forms themselves");
  // The missing form is named ONCE. When every form misses (a capability gap) the sentence would
  // otherwise print the same list twice, so that case collapses to a bare count.
  const allMissed = await run({
    marks: [{ name: "ALCHEMIST" }],
    counter: async (_t, p) => (p.key === "close"
      ? { ok: false, reason: "capability-gap: cannot be expressed" }
      : { ok: true, total: 1 }),
  });
  const everyOne = variantFormsLine(allMissed.marks[0]);
  assert.match(everyOne, /None of the \d+ could be counted/);
  assert.doesNotMatch(everyOne, /ALKEMIST.*ALKEMIST/s, "the form list is not printed twice in one sentence");
});

test("a MISCONFIGURED cap says so — it never reads as a name with no near-forms", async () => {
  // A typo'd CLEAROTRON_KNOCKOUT_VARIANT_CAP zeroes the form set, and the obvious wording for an empty set
  // is "this name has no near-form" — which reports a configuration fault as a property of the client's
  // mark, and silently retires the whole column on that deployment. The two are distinguishable
  // (`generated` counts what the rule table produced BEFORE the cap) so they are distinguished.
  const doc = await run({ marks: [{ name: "ALCHEMIST" }], variantCap: NaN, counter: async () => ({ ok: true, total: 1 }) });
  const cell = doc.marks[0].counts.close;
  assert.equal(cell.total, null);
  assert.match(cell.unavailable, /configuration fault, not a property of the name/);
  assert.match(cell.unavailable, /CLEAROTRON_KNOCKOUT_VARIANT_CAP/, "the refusal names the variable to fix");
  assert.equal(cell.generated, 7, "the rule table did produce forms — the cap cut them");
  assert.equal(cell.deterministic, undefined,
    "and it does NOT settle: fixing the variable and resuming must re-take the column, not carry the gap forward");
  // THE HALF THAT REACHES A READER. The artifact separated the two cases from the day the column
  // shipped; the rendered line did not, so a misconfigured cap printed "no near-forms could be
  // generated from this name" — about a mark with seven — on the report, in the workbook and in
  // report-data.json, with the true account reachable only by hovering the "not available" cell.
  const line = variantFormsLine(doc.marks[0]);
  assert.doesNotMatch(line, /no near-forms could be generated/,
    "a configuration fault must never render as a property of the client's mark");
  assert.match(line, /none were searched/);
  assert.match(line, /7 near-forms/, "it says the forms DID exist, and how many");
  assert.match(line, /not a property of the name/);
});

test("a name with no near-form says so — it never reads as a counted zero", async () => {
  const doc = await run({ marks: [{ name: "77" }], counter: async () => ({ ok: true, total: 4 }) });
  const cell = doc.marks[0].counts.close;
  assert.deepEqual(cell.forms, []);
  assert.equal(cell.total, null, "no forms is not a count of none");
  assert.match(cell.unavailable, /no close-variation forms could be generated/);
  assert.equal(cell.deterministic, true, "the rule table will not produce one on a retry either");
  assert.match(variantFormsLine(doc.marks[0]), /no near-forms could be generated/);
});

test("ADDING the third predicate does not re-bill a schema-1 resume", async () => {
  // The reuse test used to be all-or-nothing over the whole row, so a new predicate would have re-probed
  // every mark in every prior sidecar — on a billing provider, real money, and no error anywhere to show
  // for it. Reuse is per CELL: the two old figures stand, only the new column is paid for.
  const prior = {
    marks: [{
      name: "IRONWHISK", classes: [8], classScope: "mark",
      counts: { identical: { total: 3 }, containing: { total: 41 } },
    }],
  };
  const asked = [];
  const doc = await run({
    marks: [{ name: "IRONWHISK", classes: [8] }], prior,
    counter: async (term, p) => { asked.push(p.key); return { ok: true, total: 1 }; },
  });
  assert.deepEqual([...new Set(asked)], ["close"], "only the column that did not exist before was bought");
  assert.equal(doc.marks[0].counts.identical.total, 3, "the settled figures came from the prior sidecar");
  assert.equal(doc.marks[0].counts.containing.total, 41);
  assert.equal(doc.marks[0].reused, undefined, "the row is not wholly reused — one cell was probed");

  // …and a second resume over the SAME form set re-asks nothing at all.
  const again = await run({ marks: [{ name: "IRONWHISK", classes: [8] }], prior: doc, counter: async () => { asked.push("x"); return { ok: true, total: 1 }; } });
  assert.deepEqual([...new Set(asked)], ["close"], "nothing further was asked");
  assert.equal(again.marks[0].reused, true);
});

test("a close cell counted under a DIFFERENT form set is not reused", async () => {
  // The aggregate's meaning is its form set. A sidecar written by a build with a different rule table
  // carries a number over forms this build never asked about, and reusing it would publish that number
  // under this build's own list of forms — a figure and a legend that do not describe each other.
  const stale = {
    marks: [{
      name: "ALCHEMIST", classes: null, classScope: "all-classes",
      counts: {
        identical: { total: 1 }, containing: { total: 2 },
        close: { total: 99, forms: [{ form: "SOMETHING-ELSE", rules: ["gone"], total: 99 }], counted: 1 },
      },
    }],
  };
  const doc = await run({ marks: [{ name: "ALCHEMIST" }], prior: stale, counter: async () => ({ ok: true, total: 1 }) });
  assert.notEqual(doc.marks[0].counts.close.total, 99, "the stale aggregate was re-taken");
  assert.match(doc.marks[0].counts.close.reprobedBecause, /form set changed/,
    "…and the artifact says WHY it was bought again — an unexplained re-bill is the defect this lane's resume exists to avoid");
  assert.deepEqual(doc.marks[0].counts.close.forms.map((f) => f.form), variantForms("ALCHEMIST").forms.map((f) => f.form));
  assert.equal(doc.marks[0].counts.identical.total, 1, "…while the simple cells were still not re-billed");
});

test("an unscoped run counts across all classes AND says so", async () => {
  const doc = await run({ marks: [{ name: "SOLO" }], counter: async () => ({ ok: true, total: 3 }) });
  assert.equal(doc.marks[0].classScope, "all-classes");
  assert.equal(doc.marks[0].classes, null);
  assert.match(countLine(doc.marks[0]), /all classes/,
    "a count across every class is a bigger, scarier number — it must never pass as a class-scoped one");
});

test("A FAILED PROBE IS NULL, NOT ZERO — the whole product rests on this", async () => {
  const doc = await run({
    marks: [{ name: "REAL" }, { name: "BROKEN" }],
    counter: async (mark, p) => (mark === "REAL"
      ? { ok: true, total: p.key === "identical" ? 0 : 12 }
      : { ok: false, reason: "HTTP 502 from the register" }),
  });
  const real = countsForMark(doc, "REAL");
  assert.equal(real.counts.identical.total, 0, "a counted zero is a zero");
  assert.equal(real.counts.identical.unavailable, undefined);

  const broken = countsForMark(doc, "BROKEN");
  assert.equal(broken.counts.identical.total, null);
  assert.match(broken.counts.identical.unavailable, /HTTP 502/, "with the provider's own words kept");
  assert.equal(broken.counts.identical.deterministic, undefined, "a 502 is transient — it may be retried");
  assert.match(countLine(broken), /identical: not available/);
  assert.doesNotMatch(countLine(broken), /\b0\b/, "nothing in the rendered line can be mistaken for a nought");
  assert.equal(countedMarks(doc), 1, "only the mark that got a number counts as counted");
});

test("a counter that THROWS is caught per mark — one bad name never takes the batch down", async () => {
  const doc = await run({
    marks: [{ name: "BOOM" }, { name: "FINE" }],
    counter: async (mark) => { if (mark === "BOOM") throw new Error("socket hang up"); return { ok: true, total: 1 }; },
  });
  assert.match(doc.marks[0].counts.identical.unavailable, /socket hang up/);
  assert.equal(doc.marks[1].counts.identical.total, 1);
});

test("a DETERMINISTIC capability gap is marked as one — and a resume does not re-bill it", async () => {
  // Corsearch bills per search, so a resume that re-asks a question whose answer can never change is
  // money spent on nothing. Multi-word marks under a space-unsafe contains mode are the live case.
  let calls = 0;
  const counter = async (_m, p) => {
    calls += 1;
    return p.key === "identical"
      ? { ok: true, total: 2 }
      : { ok: false, reason: "capability-gap: a multi-word term cannot be expressed under this mode" };
  };
  const perMark = 2 + variantForms("SIM PRAXIS").forms.length;
  const first = await run({ marks: [{ name: "SIM PRAXIS" }], counter });
  assert.equal(calls, perMark);
  assert.equal(first.marks[0].counts.containing.deterministic, true);
  // Same rule through the aggregate: EVERY form hit the same structural refusal, so the whole cell is
  // settled. One retryable form in the set would leave it unsettled — see the next assertion block.
  assert.equal(first.marks[0].counts.close.deterministic, true);
  assert.equal(first.marks[0].counts.close.total, null);

  const second = await run({ marks: [{ name: "SIM PRAXIS" }], counter, prior: first });
  assert.equal(calls, perMark, "settled: nothing was re-asked");
  assert.equal(second.marks[0].reused, true);

  // …whereas a TRANSIENT failure is retried on resume, because the answer really can change.
  let n = 0;
  const flaky = await run({ marks: [{ name: "FLAKY" }], counter: async () => { n += 1; return { ok: false, reason: "HTTP 502" }; } });
  const flakyCalls = 2 + variantForms("FLAKY").forms.length;
  await run({ marks: [{ name: "FLAKY" }], counter: async () => { n += 1; return { ok: true, total: 4 }; }, prior: flaky });
  assert.equal(n, flakyCalls * 2, "every probe failed transiently, then every one was retried");

  // A MIXED close cell — one form structurally refused, one merely 502'd — must NOT settle. Freezing it
  // would keep a retryable gap forever, and the column would read "not available" on every later resume.
  let seen = 0;
  const mixed = await run({
    marks: [{ name: "ALCHEMIST" }],
    counter: async (_t, p) => {
      if (p.key !== "close") return { ok: true, total: 1 };
      return (++seen === 1)
        ? { ok: false, reason: "capability-gap: cannot be expressed" }
        : { ok: false, reason: "HTTP 502" };
    },
  });
  assert.equal(mixed.marks[0].counts.close.deterministic, undefined,
    "one retryable form in the set keeps the whole cell open");
  let after = 0;
  await run({ marks: [{ name: "ALCHEMIST" }], prior: mixed, counter: async (_t, p) => { if (p.key === "close") after += 1; return { ok: true, total: 1 }; } });
  assert.equal(after, variantForms("ALCHEMIST").forms.length, "so the resume re-asks the form set");
});

test("receipts: one ledger row per call, carrying what it cost and what it asked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-count-"));
  const ledgerPath = join(dir, "register-count.jsonl");
  await run({
    marks: [{ name: "IRONWHISK", classes: [8] }], jurisdictions: ["US"], ledgerPath,
    counter: async (_m, p) => (p.key === "identical" ? { ok: true, total: 3, probe: "cheap" } : { ok: false, reason: "nope" }),
  });
  const rows = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const forms = variantForms("IRONWHISK").forms.map((f) => f.form);
  assert.equal(rows.length, 2 + forms.length,
    "every billable question is on the record — this is the cost of the product, and the close column is N of them");
  assert.deepEqual(rows.slice(0, 2).map((r) => r.predicate), ["identical", "containing"]);
  assert.deepEqual(rows[0], {
    ts: "2026-07-22T09:00:00.000Z", mark: "IRONWHISK", predicate: "identical", match_mode: "exact",
    // ["US","WO"], not ["US"]: the receipt records the scope the call was actually made at, and since
    // a US order carries the international register that binds it. A ledger that said "US" for a
    // call priced over two registers would misstate what the client paid for.
    classes: [8], regions: ["US", "WO"], provider: "corsearch", probe: "cheap", ok: true, total: 3,
    took_ms: rows[0].took_ms,
  });
  assert.equal(rows[1].total, null, "a failed call records no figure at all");
  assert.match(rows[1].cause, /nope/);

  // THE MULTIPLIER IS READ OFF THE LEDGER, not inferred. Each variant probe is its own line and names
  // the form it asked about — a single aggregate row would report one call where N were billed.
  const variantRows = rows.filter((r) => r.predicate === "close");
  assert.deepEqual(variantRows.map((r) => r.variant_form), forms);
  assert.ok(variantRows.every((r) => r.mark === "IRONWHISK" && r.term === r.variant_form),
    "the line names both the mark it belongs to and the term actually sent");
  assert.ok(variantRows.every((r) => r.match_mode === "exact"), "…under the exact predicate, always");
  assert.ok(rows.slice(0, 2).every((r) => r.variant_form === undefined),
    "and a simple predicate's line is byte-unchanged — no empty variant key on it");
});

test("the fixture executor is the $0 path, and a missing figure is unavailable rather than zero", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-countfix-"));
  mkdirSync(dir, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "ironwhisk.json"), JSON.stringify({ identical: 3, containing: 41 }));
  writeFileSync(join(dir, "half.json"), JSON.stringify({ identical: 1 }));
  // A PARAMETER, NOT THE ENVIRONMENT. This used to set
  // `CLEAROTRON_KNOCKOUT_COUNT_FIXTURES` and restore it in a `finally` — the save/restore dance is what an
  // ambient switch costs every test that touches it, and getting it wrong leaks fixture mode into
  // whatever runs next in the same process.
  const { count, source } = resolveCountExecutor({ fixtureDir: dir });
  assert.match(source, /^fixtures:/);
  const doc = await run({ marks: [{ name: "IRONWHISK" }, { name: "HALF" }, { name: "ABSENT" }], counter: count });
  assert.equal(doc.marks[0].counts.containing.total, 41);
  assert.equal(doc.marks[1].counts.containing.total, null);
  assert.match(doc.marks[2].counts.identical.unavailable, /fixture missing/);
});

test("#2038 no fixture directory means the provider is called — the ambient switch is gone", () => {
  // THE DIRECTION THAT MATTERS. With the environment read in place, a shell that had exported the old
  // variable made this return fixtures no matter what the caller asked for. Nothing can now put this
  // lane on fixtures except the caller saying so.
  const { source } = resolveCountExecutor({ adapter: { countHits: async () => ({}) } });
  assert.equal(source, "provider");
  assert.equal(resolveCountExecutor({}).source, "none", "and with no adapter either, it is honest about having nothing");
});

test("the adapter path passes the neutral shape through to the provider", async () => {
  const seen = [];
  const { count, source } = resolveCountExecutor({
    adapter: { countHits: async (q, ctx) => { seen.push({ q, ctx }); return { ok: true, total: 5 }; } },
    // — `recordLog` rides every adapter call, including this one. No core writes a record BODY from
    // a count today; one that started to would otherwise write it to the box-global fallback, where the
    // run-dir reader never looks and nothing throws.
    agentId: "clawdi", sessionKey: "prelim-x", recordLog: "/run/_driver/register-record-bodies.jsonl",
  });
  assert.equal(source, "provider");
  await count("IRONWHISK", COUNT_PREDICATES[0], { classes: [8], regions: ["US"] });
  assert.deepEqual(seen[0].q, { name: "IRONWHISK", matchMode: "exact", classes: [8], regions: ["US"] });
  assert.deepEqual(seen[0].ctx,
    { agentId: "clawdi", sessionKey: "prelim-x", recordLog: "/run/_driver/register-record-bodies.jsonl" });
});

// ── what reaches the client ─────────────────────────────────────────────────────────────────────────

test("the report prints the figures as their own section, and the model's guess is nowhere near them", async () => {
  const doc = await run({
    marks: [{ name: "IRONWHISK", classes: [8] }],
    counter: async (_m, p) => ({ ok: true, total: p.key === "identical" ? 3 : (p.key === "containing" ? 41 : 2) }),
  });
  const findings = {
    marks: [{
      name: "IRONWHISK", rating: "Medium", bullets: ["An active seller in the same goods space."],
      registerEstimate: "moderate filings expected", purpleNotes: ["Register search pending."], findings: [],
    }],
  };
  const fw = { bands: [{ label: "High", tone: "high" }, { label: "Medium", tone: "medium" }, { label: "Low", tone: "low" }] };
  const opts = { runId: "r", overall: "Medium", identity: { banner: "Depth 2 — Knockout review with register hit-counts" } };

  const html = renderKnockoutHtml(findings, fw, { ...opts, registerCounts: doc });
  // spine (spec 2026-07-30): the counts table now lives inside the merged "On-field conflicts"
  // section — still a first-class numbered section, never a bullet in a cell.
  assert.match(html, /<h2>On-field conflicts<\/h2>/, "the counts live in the merged numbered section, not a bullet in a cell");
  assert.match(html, /class="ko-counts/, "the counts table renders");
  assert.match(html, /<td class="num">3<\/td>/);
  assert.match(html, /<td class="num">41<\/td>/);
  // Three columns, and the third is the one counsel asked for.
  assert.match(html, /<th>Close variations<\/th>/, "the close-variation column is on the page");
  for (const f of variantForms("IRONWHISK").forms.map((v) => v.form))
    assert.ok(html.includes(f), `the form ${f} the number was counted over is printed under the table`);
  assert.match(html, /class="ko-forms"/);
  // THE SCOPE LEADS. A class-scoped figure and an all-classes one are different products of the same
  // machinery, and a reader who cannot tell them apart has been told the narrow search found this.
  assert.match(html, /classes 8/, "the row states the scope its figures were taken at");

  // The model's ESTIMATE of what the registers hold is not printed beside the measurement of it — and
  // now it is not printed at all: it is an internal working note, and it lives in the audit workbook.
  assert.doesNotMatch(html, /moderate filings expected/, "the guess never sits beside the fact");
  assert.doesNotMatch(html, /Register search pending/, "nor does the staff note");

  // An all-classes run SAYS the count was not narrowed — the bigger, scarier number never passes as
  // the narrow one counsel asked for.
  const wide = await run({ marks: [{ name: "IRONWHISK" }], counter: async () => ({ ok: true, total: 9 }) });
  assert.match(renderKnockoutHtml(findings, fw, { ...opts, registerCounts: wide }),
    /all classes — this run named none/);

  // ── THE TIER-ABSENCE LINE ( part 2) ───────────────────────────────────────────────────────────
  // A knockout that bought no register step used to render NOTHING about the registers, and silence
  // read as an omission to the one reader the product serves. It now says which it is — and says the
  // opposite thing when the product DID include counts and none could be taken.
  const plain = renderKnockoutHtml(findings, fw, { ...opts, registerCounts: null, probeRan: false });
  assert.match(plain, /not included in this product tier/, "absence reads as a tier fact, never as an omission");
  assert.match(plain, /identical · containing · close variations/, "and names what the tier that has them includes");
  assert.doesNotMatch(plain, /moderate filings expected/, "a report with no counts still does not print the guess");
  assert.match(plain, /register searches are addressed separately/);

  const failed = renderKnockoutHtml(findings, fw, { ...opts, registerCounts: null, probeRan: true });
  assert.match(failed, /none could be taken on this run/, "a bought-but-failed count is a gap, not a lesser tier");
  assert.doesNotMatch(failed, /not included in this product tier/,
    "…and must never tell a client who paid for counts that their product does not have them");
});

test("the workbook grows a fourth sheet only when counts exist, and never a blank cell for a missing one", async () => {
  const ironForms = variantForms("IRONWHISK").forms.map((f) => f.form);
  const doc = await run({
    marks: [{ name: "IRONWHISK", classes: [8] }, { name: "SIM PRAXIS" }], jurisdictions: ["US"],
    counter: async (mark, p) => (mark === "IRONWHISK" || ironForms.includes(mark)
      ? { ok: true, total: p.key === "identical" ? 3 : (p.key === "containing" ? 41 : 2) }
      : { ok: false, reason: "capability-gap: multi-word" }),
  });
  const findings = { marks: [{ name: "IRONWHISK", findings: [], negatives: [] }, { name: "SIM PRAXIS", findings: [], negatives: [] }] };
  const dir = mkdtempSync(join(tmpdir(), "ko-wb-"));
  const ExcelJS = (await import("exceljs")).default;

  await buildKnockoutWorkbook(findings, [], join(dir, "plain.xlsx"));
  const plain = new ExcelJS.Workbook();
  await plain.xlsx.readFile(join(dir, "plain.xlsx"));
  assert.deepEqual(plain.worksheets.map((w) => w.name), ["Findings", "Negative Results", "Audit Trail"],
    "a knockout without counts ships the skill's exact three sheets");

  await buildKnockoutWorkbook(findings, [], join(dir, "counted.xlsx"), doc);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(dir, "counted.xlsx"));
  const sheet = wb.getWorksheet("Register Counts");
  assert.ok(sheet, "the fourth sheet is additive");
  const header = sheet.getRow(1).values.slice(1);
  assert.deepEqual(header, ["Mark", "Classes counted", "Territories", "Identical filings", "Filings containing the name",
    "Filings on close variations", "Close variation forms", "Register", "Basis", "Notes"]);
  const iron = sheet.getRow(2).values.slice(1);
  assert.equal(iron[0], "IRONWHISK");
  assert.equal(iron[1], "8");
  assert.equal(iron[2], "US, WO", "the Territories cell names every register the figure was taken over (#1028)");
  assert.equal(iron[3], 3);
  assert.equal(iron[4], 41);
  assert.equal(iron[5], 2 * ironForms.length, "the aggregate is the sum over the forms");
  assert.match(String(iron[6]), new RegExp(ironForms[0]), "and the forms it summed are auditable in the same row");
  const sim = sheet.getRow(3).values.slice(1);
  assert.equal(sim[0], "SIM PRAXIS");
  assert.equal(sim[1], "all classes");
  assert.equal(sim[3], "not available", "a cell can never be blank — blank reads as none found");
  assert.equal(sim[4], "not available");
  assert.equal(sim[5], "not available", "…the close column included");
  assert.match(String(sim[9]), /multi-word/, "the auditable reason travels with the missing figure");
});
