// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// B1 (report confabulation fix) — the DETERMINISTIC half: per-finding selection + report.md assembly. The
// per-card PROSE isolation (cross-card bleed impossible) is a live-run property; these lock the code that
// orders + stitches the isolated cards into report.md (front-matter + # Marks, render order, single open card).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { assembleReportMd, fullProseOrdinals, buildAskAnswersSection, deferralCoverageRow, clipToWord } from "../pipeline.mjs";

const mkP = (dir) => ({
  reportOverview: join(dir, "report-overview.md"),
  reportCardsDir: join(dir, "report-cards"),
  reportCard: (ord) => join(dir, "report-cards", `${ord}.md`),
  report: join(dir, "report.md"),
});

test("B1 fullProseOrdinals: composite>=3 OR level∈{A,B} (minor (a) — a mis-rated-low high-exposure mark still gets a full card)", () => {
  const findings = [
    { ordinal: 1, composite: 4, level: "C" },   // composite ≥ 3 → full prose
    { ordinal: 2, composite: 1, level: "A" },   // practical composite low BUT level A → full prose (minor (a))
    { ordinal: 3, composite: 2, level: "D" },   // low/low → structured-only (no LLM card)
  ];
  assert.deepEqual(fullProseOrdinals(findings).sort((a, b) => a - b), [1, 2]);
});

test("B1 assembleReportMd: shell + # Marks + cards in composite-desc/ordinal-asc order; single top card opened; missing cards omitted", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-assemble-"));
  mkdirSync(join(dir, "report-cards"));
  const P = mkP(dir);
  writeFileSync(P.reportOverview, "---\ntype: prelim-clearance\noverall_label: MEDIUM\noverall_caption: bottom line\n---\n\n# Actions\n### Only you can close these\n- [Time-critical] confirm prior use\n\n# Coverage\nclean\n\n# Methodology\nshort note\n");
  writeFileSync(P.reportCard("1"), "## Owner A — MARK A, US\n- ord: 1\n- one: net A\n### The read\nRead A.\n### Full detail\n- Source: [x](/mark/us/1)\n");
  writeFileSync(P.reportCard("2"), "## Owner B — MARK B, EU\n- ord: 2\n- one: net B\n### The read\nRead B.\n### Full detail\n- Source: [x](/mark/eu/2)\n");
  const findings = [
    { ordinal: 1, composite: 3, level: "C", owner: { name: "Owner A" }, mark: "MARK A" },
    { ordinal: 2, composite: 5, level: "E", owner: { name: "Owner B" }, mark: "MARK B" },
    { ordinal: 3, composite: 4, level: "D", owner: { name: "Owner C" }, mark: "MARK C" },  // full-prose set but NO card file → omitted (render synthesizes it structured-only)
  ];
  assembleReportMd(P, findings, [1, 2, 3]);
  const md = readFileSync(P.report, "utf8");
  assert.match(md, /^---\ntype: prelim-clearance/, "front-matter preserved at the very top");
  assert.match(md, /^# Marks$/m, "validators.report needs the # Marks heading");
  assert.ok(md.indexOf("MARK B") < md.indexOf("MARK A"), "higher-composite card (ord 2) renders before the lower (ord 1)");
  assert.ok(md.slice(md.indexOf("## Owner B")).startsWith("## Owner B — MARK B, EU\n- ord: 2\n- open: true"), "open: true inserted after the top card's ord line");
  assert.equal((md.match(/- open: true/g) || []).length, 1, "ONLY the single top card is opened");
  assert.doesNotMatch(md, /MARK C/, "a full-prose finding whose card failed is omitted from report.md (render fills it structured-only) — never a broken card");
  assert.match(md, /confirm prior use/, "the overview shell (# Actions) carried through");
});

test("WP-56 A4: `- group:` stamped from disposition — mislabel overwritten, missing line inserted, legacy (no disposition) untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-group-"));
  mkdirSync(join(dir, "report-cards"));
  const P = mkP(dir);
  writeFileSync(P.reportOverview, "---\noverall_label: MEDIUM\noverall_caption: x\n---\n\n# Coverage\nok\n");
  // ord 1: RATED (distinguished) but the model mislabeled it off-field — the VIBRANTE shape
  writeFileSync(P.reportCard("1"), "## Martini — VIBRANTE, US\n- ord: 1\n- group: off-field\n- one: net\n### The read\nR.\n");
  // ord 2: off-field disposition, model wrote on-field — stamped back to off-field
  writeFileSync(P.reportCard("2"), "## Owner B — MARK B, EU\n- ord: 2\n- group: on-field\n- one: net\n### The read\nR.\n");
  // ord 3: rated card that OMITTED the group line — inserted from the disposition
  writeFileSync(P.reportCard("3"), "## Owner C — MARK C, EU\n- ord: 3\n- one: net\n### The read\nR.\n");
  // ord 4: legacy finding (no disposition) — model-authored group passes through untouched (replay safety)
  writeFileSync(P.reportCard("4"), "## Owner D — MARK D, EU\n- ord: 4\n- group: off-field\n- one: net\n### The read\nR.\n");
  const findings = [
    { ordinal: 1, band: "Medium", disposition: "distinguished", owner: { name: "Martini" }, mark: "VIBRANTE" },
    { ordinal: 2, disposition: "off-field", owner: { name: "Owner B" }, mark: "MARK B" },
    { ordinal: 3, band: "Medium", disposition: "adversarial", owner: { name: "Owner C" }, mark: "MARK C" },
    { ordinal: 4, composite: 4, level: "C", owner: { name: "Owner D" }, mark: "MARK D" },
  ];
  assembleReportMd(P, findings, [1, 2, 3, 4]);
  const md = readFileSync(P.report, "utf8");
  const card = (m) => md.slice(md.indexOf(`— ${m},`)).split(/\n## /)[0];
  assert.match(card("VIBRANTE"), /^- group: on-field$/m, "rated `distinguished` mislabeled off-field → stamped on-field");
  assert.doesNotMatch(card("VIBRANTE"), /group: off-field/);
  assert.match(card("MARK B"), /^- group: off-field$/m, "off-field disposition stamped off-field");
  assert.match(card("MARK C"), /^- group: on-field$/m, "missing group line inserted from the disposition");
  assert.match(card("MARK D"), /^- group: off-field$/m, "legacy card without disposition is untouched");
  assert.equal((md.match(/^- group:/gm) || []).length, 4, "exactly one group line per card");
});

test("B1 assembleReportMd: a clean run with no cards still ships a valid shell (# Marks present)", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-empty-"));
  const P = mkP(dir);
  writeFileSync(P.reportOverview, "---\noverall_label: LOW\noverall_caption: no conflicts\n---\n\n# Coverage\nall clear\n");
  assembleReportMd(P, [], []);
  const md = readFileSync(P.report, "utf8");
  assert.match(md, /^---\noverall_label: LOW/, "front-matter preserved");
  assert.match(md, /# Marks/, "empty # Marks still present so validators.report passes");
});

// ---- spec 64: "Only you can close these" is CODE-BUILT from the typed actions register ------------
import { buildOnlyYouSection } from "../pipeline.mjs";

test("spec 64 buildOnlyYouSection: time-critical conditions lead; advisories tagged; every kind renders (#1285)", () => {
  const findings = [{ ordinal: 1, disposition: "adversarial" }];
  const actions = [
    { id: 1, kind: "consent", text: "Obtain consent from X.", ordinals: [1] },
    { id: 2, kind: "proceeding-response", text: "Respond to the CH opposition.", ordinals: [1], deadline: { kind: "opposition", date: "2026-07-13" } },
    { id: 3, kind: "client-fact", text: "Confirm the older filing is your own.", ordinals: [] },
    { id: 4, kind: "commercial-decision", text: "Decide the coexistence posture.", ordinals: [] },
    { id: 5, kind: "monitoring", text: "Watch the pending application.", ordinals: [] },
    { id: 6, kind: "filing-routine", text: "File in classes 9 and 41.", ordinals: [] },
  ];
  const md = buildOnlyYouSection(actions, findings);
  const lines = md.split("\n");
  assert.equal(lines[0], "### Only you can close these");
  // (c) — the list is grouped now: the conditions the verdict depends on, the questions addressed
  // to the reader, and the standing watch items. The grouping is on the register's own `kind` and the
  // ORDER WITHIN each group is unchanged, which is what the next two assertions still pin.
  assert.equal(lines[2], "**Before you can rely on this result**");
  assert.match(lines[4], /^- \*\*\[Time-critical\]\*\* Respond to the CH opposition\. \(due by 2026-07-13\)$/, "the dated condition leads");
  // — the undated condition carries a tag too. It was the ONE arm of this section that emitted a
  // bare bullet, so the items that block reliance were the only unchipped items on the page.
  assert.match(lines[5], /^- \*\*\[Before you can rely\]\*\* Obtain consent from X\.$/);
  assert.match(md, /\*\*We need an answer from you\*\*/);
  assert.match(md, /\*\*Keep an eye on\*\*/);
  assert.match(md, /\*\*\[Open question\]\*\* Confirm the older filing/);
  assert.match(md, /\*\*\[Your decision\]\*\* Decide the coexistence/);
  assert.match(md, /\*\*\[Monitor\]\*\* Watch the pending/);
  // the blocking group comes first, and the reader meets the questions before the watch list
  assert.ok(md.indexOf("Before you can rely") < md.indexOf("We need an answer")
    && md.indexOf("We need an answer") < md.indexOf("Keep an eye on"), "blocking leads, watch items last");
  // — THIS ARM ASSERTED THE OPPOSITE UNTIL 2026-08-19, and it was not wrong when it was written:
  // filing-routine was dropped by ADVISORY_TAG and this pinned that. then wrote a watch group for
  // "monitoring and filing-routine" without telling the filter, so the kind stayed unreachable and this
  // arm went on defending it. Owner ruling: it renders, in the watch group, with its own chip.
  assert.match(md, /\*\*\[Filing step\]\*\* File in classes 9 and 41\./, "a filing-routine advisory renders, chipped");
  assert.ok(md.indexOf("Keep an eye on") < md.indexOf("File in classes"),
    "…in the WATCH group, not among the asks — #615's split is the ruled behaviour and a standing filing "
    + "step is not a question addressed to the reader");
  assert.equal(buildOnlyYouSection([], findings), "", "no actions ⇒ no section");

  // — ONE BUCKET STILL GETS ITS HEADING, and this assertion is inverted deliberately rather than
  // relaxed. It used to read `"### Only you can close these\n\n- Obtain consent from X."` on the
  // argument that a lone sub-head separates nothing. Across runs that made the section's shape a
  // function of how many buckets a matter happened to fill: the same blocking condition rendered under
  // a name or as an anonymous bullet depending on whether some unrelated item was a watch note. The
  // heading is what tells a reader the line blocks them, and that does not depend on its neighbours.
  const only = buildOnlyYouSection([{ id: 1, kind: "consent", text: "Obtain consent from X.", ordinals: [1] }], findings);
  assert.equal(only, "### Only you can close these\n\n**Before you can rely on this result**\n\n- **[Before you can rely]** Obtain consent from X.");
});

// — THE SHAPE IS A FUNCTION OF THE ITEM KINDS AND OF NOTHING ELSE. This is the property the issue
// reports as "drift": two runs carrying the same kinds of item rendered different structures, because
// the old code keyed the sub-headings on how many buckets were non-empty and the tags on whether an
// action happened to carry a deadline. Both are incidental facts about a matter, not about a report.
test("#763 buildOnlyYouSection: same item kinds ⇒ structurally identical section, whatever else the run carries", () => {
  const findings = [{ ordinal: 1, disposition: "adversarial" }];
  const shape = (md) => md.split("\n").filter(Boolean).map((l) => (
    l.startsWith("### ") ? "H2" : l.startsWith("**") ? `GROUP:${l}` : `ITEM:${(l.match(/^- \*\*\[([^\]]+)\]\*\*/) || [, "UNTAGGED"])[1]}`));

  // the issue's own reproduction: one dated + two undated conditions, ZERO advisories.
  const conditionsOnly = buildOnlyYouSection([
    { id: 1, kind: "consent", text: "Obtain consent from X.", ordinals: [] },
    { id: 2, kind: "proceeding-response", text: "Respond to the opposition.", ordinals: [], deadline: { kind: "opposition", date: "2026-09-01" } },
    { id: 3, kind: "goods-amendment", text: "Narrow the class-9 wording.", ordinals: [] },
  ], findings);
  assert.deepEqual(shape(conditionsOnly),
    ["H2", "GROUP:**Before you can rely on this result**", "ITEM:Time-critical", "ITEM:Before you can rely", "ITEM:Before you can rely"],
    "a conditions-only run is a NAMED group of tagged items — never a flat list of bare bullets");

  // the same three conditions with a monitoring item added: the conditions group must not change shape
  // because something unrelated joined the section.
  const withWatch = buildOnlyYouSection([
    { id: 1, kind: "consent", text: "Obtain consent from X.", ordinals: [] },
    { id: 2, kind: "proceeding-response", text: "Respond to the opposition.", ordinals: [], deadline: { kind: "opposition", date: "2026-09-01" } },
    { id: 3, kind: "goods-amendment", text: "Narrow the class-9 wording.", ordinals: [] },
    { id: 4, kind: "monitoring", text: "Watch the pending application.", ordinals: [] },
  ], findings);
  assert.deepEqual(shape(withWatch).slice(0, 5), shape(conditionsOnly), "the conditions group is identical in both runs");
  assert.deepEqual(shape(withWatch).slice(5), ["GROUP:**Keep an eye on**", "ITEM:Monitor"]);

  // EVERY item in the section carries a tag, on every shape — the property the issue asks for.
  for (const md of [conditionsOnly, withWatch]) {
    for (const line of md.split("\n").filter((l) => l.startsWith("- "))) {
      assert.match(line, /^- \*\*\[(Time-critical|Before you can rely|Open question|Your decision|Monitor)\]\*\* /, `untagged item: ${line}`);
    }
  }
});

test("spec 64 buildOnlyYouSection: an action referencing only withdrawn findings is dead", () => {
  const findings = [{ ordinal: 1, disposition: "withdrawn" }];
  assert.equal(buildOnlyYouSection([{ id: 1, kind: "consent", text: "T.", ordinals: [1] }], findings), "");
});

test("PR-3 buildOnlyYouSection: the ask's subject is CODE-JOINED from its ordinals — never model-typed, never repeated", () => {
  const findings = [
    { ordinal: 1, mark: "MATCHDAY", disposition: "adversarial", owner: { name: "Matchday, Inc." } },
    { ordinal: 2, mark: "FROSTBERRY", disposition: "adversarial", owner: { name: "Arctic Foods AG" } },
    { ordinal: 3, mark: "GHOST", disposition: "withdrawn" },
  ];
  // an ask that does NOT name its finding gains the joined subject
  const md1 = buildOnlyYouSection([{ id: 1, kind: "consent", text: "Obtain the consent before filing.", ordinals: [1] }], findings);
  assert.match(md1, /- \*\*\[Before you can rely\]\*\* Obtain the consent before filing\. \(re: MATCHDAY \(Matchday, Inc\.\)\)/);
  // an ask that already names the owner is not double-stamped
  const md2 = buildOnlyYouSection([{ id: 1, kind: "consent", text: "Obtain consent from Matchday, Inc. before filing.", ordinals: [1] }], findings);
  assert.doesNotMatch(md2, /\(re: /);
  // multiple referenced findings join in ordinal order; withdrawn references never surface
  const md3 = buildOnlyYouSection([{ id: 1, kind: "consent", text: "Obtain both consents.", ordinals: [1, 2, 3] }], findings);
  assert.match(md3, /\(re: MATCHDAY \(Matchday, Inc\.\); FROSTBERRY \(Arctic Foods AG\)\)/);
  assert.doesNotMatch(md3, /GHOST/);
  // run-level asks ([] ordinals) carry no subject
  const md4 = buildOnlyYouSection([{ id: 1, kind: "consent", text: "Obtain the consent.", ordinals: [] }], findings);
  assert.doesNotMatch(md4, /\(re: /);
});

// render.mjs actYouConditions used to cut the "subject to" bound line at the first '.'/':' followed by
// whitespace — the subject's own "(re:" qualified, so a period-less subject-joined ask shipped as a
// mangled "…terms (re" on the report hero and the email conditions box. The fix normalizes terminal
// punctuation on the ask BEFORE the subject; this drives the assembled lines through the real extractor
// so the interaction can never regress uncovered again.
//
// RE-POINTED (, 2026-08-10). The cut is gone — it fired on punctuation rather than length, so an
// ask naming a company shipped as "Obtain consent from Matchday, Inc". The punctuation normalisation
// STAYS, because it was always the right output, and this test now records what the extractor returns
// with nothing shortening it: the ask, its subject and its deadline, whole.
import { actYouConditions } from "../publish/render.mjs";

test("PR-3 review fix: a period-less subject-joined ask survives the frozen first-sentence cut whole", () => {
  const findings = [{ ordinal: 1, mark: "FROSTBERRY", disposition: "adversarial", owner: { name: "Arctic Foods AG" } }];
  // model text with NO terminal punctuation (the prompt demands one sentence; nothing enforces the period)
  const md = buildOnlyYouSection([
    { id: 1, kind: "consent", text: "Obtain the consent before filing", ordinals: [1] },
    { id: 2, kind: "proceeding-response", text: "Secure the coexistence terms", ordinals: [1], deadline: { kind: "opposition", date: "2026-09-01" } },
  ], findings);
  assert.match(md, /- \*\*\[Before you can rely\]\*\* Obtain the consent before filing\. \(re: FROSTBERRY \(Arctic Foods AG\)\)/, "terminal punctuation lands before the subject");
  assert.match(md, /\*\*\[Time-critical\]\*\* Secure the coexistence terms\. \(re: FROSTBERRY \(Arctic Foods AG\)\) \(due by 2026-09-01\)/);
  // through the extractor: whole asks, never a mangled "(re" head
  const conds = actYouConditions({ label: "Only you can close these", body: md.split("\n").slice(2).join("\n") });
  assert.deepEqual(conds.sort(), [
    "Obtain the consent before filing. (re: FROSTBERRY (Arctic Foods AG))",
    "Secure the coexistence terms. (re: FROSTBERRY (Arctic Foods AG)) (due by 2026-09-01)",
  ]);
  for (const c of conds) assert.doesNotMatch(c, /\(re(?!:)/, "the truncated subject head never surfaces");
  // — and the group sub-heading is not among them. This function split on bullet boundaries, so the
  // heading before the first bullet came back AS a condition and any later heading was welded onto the
  // bullet above it. The email's conditions box was delivering both.
  for (const c of conds) assert.doesNotMatch(c, /Before you can rely on this result|We need an answer from you|Keep an eye on/, `a sub-heading reached the conditions box: ${c}`);
  // an ask with no subject stays byte-identical to pre-PR output — no stray period appended
  const bare = buildOnlyYouSection([{ id: 1, kind: "consent", text: "Obtain the consent before filing", ordinals: [] }], findings);
  // — the tag rides in front; actYouConditions strips it (asserted just above), so the email's
  // conditions box is byte-identical to what it carried before.
  assert.match(bare, /- \*\*\[Before you can rely\]\*\* Obtain the consent before filing$/m);
});

test("spec 64 assembleReportMd: the code-built only-you section merges INTO # Actions from findings.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-assemble-"));
  mkdirSync(join(dir, "report-cards"));
  const P = { ...mkP(dir), findings: join(dir, "findings.json") };
  writeFileSync(P.reportOverview, "---\ntype: prelim-clearance\n---\n\n# Actions\n### Checks we ran — what we found\n- Register sweep: clean.\n\n# Methodology\nnote\n");
  writeFileSync(P.findings, JSON.stringify({ schema_version: 1, findings: [], coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }], actions: [{ id: 1, kind: "consent", text: "Obtain consent from X.", ordinals: [] }] }));
  assembleReportMd(P, [], []);
  const md = readFileSync(P.report, "utf8");
  assert.match(md, /### Only you can close these\n\n\*\*Before you can rely on this result\*\*\n\n- \*\*\[Before you can rely\]\*\* Obtain consent from X\./);
  const actionsIdx = md.indexOf("# Actions"), methIdx = md.indexOf("# Methodology"), onlyIdx = md.indexOf("### Only you can close these");
  assert.ok(actionsIdx < onlyIdx && onlyIdx < methIdx, "inserted inside # Actions, before # Methodology");
});

test("spec 64 assembleReportMd: a model-authored only-you subsection is REPLACED by the register (code wins)", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-assemble-"));
  mkdirSync(join(dir, "report-cards"));
  const P = { ...mkP(dir), findings: join(dir, "findings.json") };
  writeFileSync(P.reportOverview, "---\n---\n\n# Actions\n### Only you can close these\n- stale model-authored ask\n\n### Checks we ran — what we found\n- Register sweep: clean.\n");
  writeFileSync(P.findings, JSON.stringify({ schema_version: 1, findings: [], coverage: [{ area: "x", state: "note", note: "" }], actions: [{ id: 1, kind: "consent", text: "Obtain consent from X.", ordinals: [] }] }));
  assembleReportMd(P, [], []);
  const md = readFileSync(P.report, "utf8");
  assert.doesNotMatch(md, /stale model-authored ask/);
  assert.match(md, /- \*\*\[Before you can rely\]\*\* Obtain consent from X\./);
  assert.match(md, /### Checks we ran — what we found/, "the results bucket survives");
});

//, RE-STATED, not relaxed. This used to assert that a findings.json with NO `actions` key left a
// model-authored "### Only you can close these" verbatim. That was the second source of the section's
// drift: the same report region rendered either as the code-built three groups or as whatever prose the
// model wrote, decided by whether one key was present in a file the reader never sees. Spec 64 ruled the
// section code-built precisely so it can never contradict the register the verdict derives from, and a
// register that declares no actions is that ruling's answer, not an exemption from it.
test("#763 assembleReportMd: a findings register with no actions key REMOVES an authored only-you section", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-assemble-"));
  mkdirSync(join(dir, "report-cards"));
  const P = { ...mkP(dir), findings: join(dir, "findings.json") };
  writeFileSync(P.reportOverview, "---\n---\n\n# Actions\n### Only you can close these\n- authored ask (legacy run)\n\n### Checks we ran — what we found\n- Register sweep: clean.\n");
  writeFileSync(P.findings, JSON.stringify({ schema_version: 1, findings: [], coverage: [{ area: "x", state: "note", note: "" }] }));
  assembleReportMd(P, [], []);
  const md = readFileSync(P.report, "utf8");
  assert.doesNotMatch(md, /authored ask \(legacy run\)/, "the register is the authority; it declares none");
  assert.doesNotMatch(md, /### Only you can close these/, "an empty answer is no section, never an authored one");
  assert.match(md, /### Checks we ran — what we found/, "the results bucket is untouched");
});

// The OTHER side of that gate, and the reason it is a gate rather than an unconditional replace: a run
// with no findings.json at all is not a register saying nothing — it is nothing to compare against.
test("#763 assembleReportMd: with NO findings register at all the overview passes through untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-assemble-"));
  mkdirSync(join(dir, "report-cards"));
  const P = mkP(dir);   // no `findings` path — the pre-register shape
  writeFileSync(P.reportOverview, "---\n---\n\n# Actions\n### Only you can close these\n- authored ask (legacy run)\n");
  assembleReportMd(P, [], []);
  assert.match(readFileSync(P.report, "utf8"), /authored ask \(legacy run\)/, "legacy prose kept verbatim");
});

test("spec 64 A×B glue: an in-window FINDING deadline with no matching action surfaces as a code-built time-critical alert", () => {
  const NOW = Date.parse("2026-07-11T00:00:00Z");
  const findings = [
    { ordinal: 1, mark: "DEMVENZY", disposition: "adversarial", deadline: { kind: "opposition", date: "2026-07-13" } },
    { ordinal: 2, mark: "OLDMARK", disposition: "adversarial", deadline: { kind: "opposition", date: "2015-08-05" } },   // history, not an ask
    { ordinal: 3, mark: "COVERED", disposition: "adversarial", deadline: { kind: "opposition", date: "2026-08-01" } },   // an action carries this date
  ];
  const actions = [{ id: 1, kind: "proceeding-response", text: "Respond to the COVERED opposition.", ordinals: [3], deadline: { kind: "opposition", date: "2026-08-01" } }];
  const md = buildOnlyYouSection(actions, findings, { nowMs: NOW });
  assert.match(md, /\*\*\[Time-critical\]\*\* DEMVENZY: the opposition window closes 2026-07-13/,
    "the enriched finding deadline surfaces even with no authored action — never silently disappears");
  assert.doesNotMatch(md, /OLDMARK/, "an archived window is history, not an ask");
  assert.equal((md.match(/2026-08-01/g) ?? []).length, 1, "a date already carried by an action is not duplicated");
});

// ── PR-9: the code-built "Answers to your instructions" section + the assembly-level folds ────────────

test("PR-9 buildAskAnswersSection: frozen-intake order leads; unjoined register answers follow; empty register ⇒ no section", () => {
  const askAnswers = [
    { ask: "confirm the Chinese transliteration reading", answer: "clean across zh-CN forms" },
    { ask: "check the Benelux position", answer: "nothing found" },
    { ask: "a volunteered extra answer", answer: "also noted" },
  ];
  const intakeAsks = [{ ask: "check the Benelux position", owner: "register" }, { ask: "confirm the Chinese transliteration reading", owner: "synthesis" }];
  const md = buildAskAnswersSection(askAnswers, intakeAsks);
  assert.match(md, /^### Answers to your instructions\n/);
  assert.ok(md.indexOf("Benelux") < md.indexOf("transliteration"), "the requester's own order leads, not the register's");
  assert.ok(md.indexOf("transliteration") < md.indexOf("volunteered"), "unjoined answers follow — never dropped");
  assert.match(md, /- You asked: check the Benelux position → nothing found/);
  assert.equal(buildAskAnswersSection([], intakeAsks), "", "no answers ⇒ no section");
  assert.equal(buildAskAnswersSection(null, intakeAsks), "", "no register ⇒ no section");
});

// ── — the label is printed ONCE ────────────────────────────────────────────────────────────────
//
// WHY THIS ARM EXISTS AND THE TWO ABOVE DO NOT COVER IT: both PR-9 fixtures pass BARE answers
// ("nothing found", "nothing found in BX registers"), so neither could ever have caught the doubling —
// the defect only appears when the answer arrives carrying the label, which is what the model actually
// emitted under the old dictation. The strings below are the DELIVERED ones from
// examples/sample-run/run/findings.json (ask_answers[0] and [1]), not invented shapes.
test("#762 buildAskAnswersSection: an answer that arrives carrying the label prints it ONCE, not twice", () => {
  const askAnswers = [
    { ask: "EU register only.", answer: `You asked: "EU register only." → Satisfied. Every record in the band is an EUTM or an International registration designating the EU.` },
    { ask: "Nothing outside the EU is in scope for this example.", answer: `You asked: "Nothing outside the EU is in scope for this example." → Honoured. Nothing outside the EU is cited as a conflict.` },
  ];
  const intakeAsks = [{ ask: "EU register only.", owner: "register" }, { ask: "Nothing outside the EU is in scope for this example.", owner: "synthesis" }];
  const md = buildAskAnswersSection(askAnswers, intakeAsks);
  assert.equal((md.match(/You asked/g) ?? []).length, 2, "one label per ask — the delivered report printed each twice");
  for (const l of md.split("\n").filter((x) => x.startsWith("- "))) {
    assert.equal((l.match(/You asked/g) ?? []).length, 1, `the label is printed once per line: ${l.slice(0, 90)}`);
    assert.doesNotMatch(l, /→[^→]*→/, "one arrow per line — a second arrow is the doubled label");
  }
  assert.match(md, /- You asked: EU register only → Satisfied\. Every record/);
  assert.match(md, /- You asked: Nothing outside the EU is in scope for this example → Honoured\./);
  // ANCHORED, and it strips only the label — the answer's own prose is untouched.
  assert.match(md, /designating the EU\./, "the answer body survives verbatim");
  assert.equal(
    buildAskAnswersSection([{ ask: "check X", answer: "nothing found" }], []),
    "### Answers to your instructions\n\n- You asked: check X → nothing found",
    "a bare answer is unchanged — the strip is a no-op when there is no label to remove");
  // Not a vocabulary rule: "You asked" mid-answer is prose, and only a position-0 label + arrow goes.
  assert.match(
    buildAskAnswersSection([{ ask: "check Y", answer: "the file records what You asked: earlier → see note" }], []),
    /→ the file records what You asked: earlier → see note$/,
    "the strip is anchored at position 0 — it never edits the middle of a sentence");
});

test("PR-9 assembleReportMd: the answers section is code-built at the HEAD of # Actions; an authored one is replaced wholesale", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr9-asks-"));
  mkdirSync(join(dir, "report-cards"));
  mkdirSync(driverDir(dir));
  const P = { ...mkP(dir), findings: join(dir, "findings.json"), runDir: dir };
  writeFileSync(driverDir(dir, "intake-asks.json"), JSON.stringify({ asks: [{ ask: "check the Benelux position", owner: "register" }] }));
  writeFileSync(P.reportOverview, "---\noverall_caption: One line.\n---\n\n# Actions\n### Answers to your instructions\n- stale model-authored answer line\n\n### Checks we ran — what we found\n- Register sweep: clean.\n");
  writeFileSync(P.findings, JSON.stringify({
    schema_version: 5, rated_under_framework: "house-default", findings: [], coverage: [{ area: "x", state: "note", note: "" }],
    ask_answers: [{ ask: "check the Benelux position", answer: "nothing found in BX registers" }],
  }));
  assembleReportMd(P, [], []);
  const md = readFileSync(P.report, "utf8");
  assert.doesNotMatch(md, /stale model-authored answer line/, "code wins — the authored section is replaced");
  assert.match(md, /### Answers to your instructions\n\n- You asked: check the Benelux position → nothing found in BX registers/);
  assert.ok(md.indexOf("Answers to your instructions") < md.indexOf("Checks we ran"), "the section OPENS # Actions");
});

test("PR-9 assembleReportMd: folds fire at assembly — caption clipped, card read folded, card-folds.json records both", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr9-folds-"));
  mkdirSync(join(dir, "report-cards"));
  mkdirSync(driverDir(dir));
  const P = { ...mkP(dir), findings: join(dir, "findings.json"), runDir: dir };
  const longCaption = "First sentence here. Second sentence here. Third sentence here. Fourth sentence overflowing now.";
  const longRead = Array.from({ length: 5 }, (_, i) => `Read sentence number ${i + 1} carries about nine words in total.`).join(" ");
  writeFileSync(P.reportOverview, `---\noverall_caption: ${longCaption}\n---\n\n# Actions\n### Checks we ran — what we found\n- Register sweep: clean.\n`);
  writeFileSync(P.reportCard("1"), `## Owner A — MARK A, US\n- ord: 1\n### The read\n${longRead}\n\n### Full detail\n- Source: [x](/mark/us/1)\n`);
  writeFileSync(P.findings, JSON.stringify({ schema_version: 1, findings: [], coverage: [{ area: "x", state: "note", note: "" }] }));
  const findings = [{ ordinal: 1, composite: 4, level: "C", owner: { name: "Owner A" }, mark: "MARK A" }];
  const res = assembleReportMd(P, findings, [1]);
  const md = readFileSync(P.report, "utf8");
  assert.match(md, /^overall_caption: First sentence here\. Second sentence here\. Third sentence here\.$/m, "caption clipped at 3 sentences");
  assert.match(md, /- \*\*Continued summary:\*\* Fourth sentence overflowing now\./, "caption overflow moved, not deleted");
  assert.match(md, /- \*\*Continued read:\*\* /, "read overflow moved into Full detail");
  // motion not deletion — every word of the original read and caption survives in the assembled report
  for (const w of `${longCaption} ${longRead}`.split(/\s+/)) assert.ok(md.includes(w), `word lost: ${w}`);
  const sidecar = JSON.parse(readFileSync(driverDir(dir, "card-folds.json"), "utf8"));
  assert.equal(sidecar.schema, 1);
  assert.deepEqual(sidecar.folds.map((f) => f.surface).sort(), ["card:1", "overview:caption"]);
  assert.deepEqual(res.folds.length, 2, "the assembly returns what it recorded");
});

// ── — the deferral coverage row a CLIENT reads ─────────────────────────────────────────────────
//
// THE ABSENCE THAT MADE THESE NECESSARY: `injectDeferralCoverage` had no test of its own. It was not
// exported and no test file imported or called it, so nothing anywhere asserted the shape of the row it
// pushes onto findings.json coverage[] — the row that renders as a client heading under "What we
// covered — and what's open". (A grep for "Follow-up /" across driver/test/ is NOT empty: it returns
// eight hits, all of them static fixture data carrying the OLD truncated shape. Fixture rows are inputs
// other lanes own, so these arms assert only over rows this code MINTS.)
//
// The two directives below are the delivered specimens from examples/sample-run.
const DELIVERED_DIRECTIVES = [
  "field:consumer and prosumer water testing (pool, spa, aquarium, home tap-water kits)",
  "field:agri-tech, irrigation, aquaculture and hydrology monitoring software",
];
const CLASS_GAP_REASON = "no-code-remedy: a field class-gap with no searchable term×class pair (closing it in the matter's own classes only re-runs the primary sweep — disclosed)";
const LABEL_REASON = "no-code-remedy: the directive's item is a label, not a mark-shaped search term (a literal dispatch would be a nil search reading as clean) — disclosed; a directive that knows its terms must carry a structured remedy{terms, nice_classes}";

test("#762 deferralCoverageRow: the client heading is never cut mid-word, and the full directive survives in the note", () => {
  const PREFIX = "Follow-up / ";
  for (const directive of DELIVERED_DIRECTIVES) {
    const row = deferralCoverageRow(directive, CLASS_GAP_REASON);
    const full = directive.replace(/^field:/, "");
    assert.ok(row.area.startsWith(PREFIX), "the 'Follow-up / ' prefix is the contract coverage-ledger keys on");
    const item = row.area.slice(PREFIX.length);
    assert.ok(item.length <= 48, `the heading item stays within budget: ${item.length} — "${item}"`);
    assert.doesNotMatch(row.area, /\s$/, "no trailing whitespace (the delivered 'monitoring ' row)");

    // NOT CUT MID-WORD: the shortened item is a genuine PREFIX of the directive, and the character it
    // stops before is a boundary — never another letter. "…aquarium, ho" fails this; "…(pool, spa…" passes.
    const stripped = item.replace(/…$/, "");
    assert.ok(full.startsWith(stripped), `the heading is a prefix of the directive: "${stripped}"`);
    const rest = full.slice(stripped.length);
    assert.ok(rest === "" || /^[\s,;:.)\]\-–—/]/.test(rest),
      `the cut lands on a word boundary, not inside a word — next char was "${rest.slice(0, 6)}"`);
    if (rest !== "") assert.match(item, /…$/, "a shortened heading says so with an explicit ellipsis");

    // The directive is not LOST, it moves to where there is room for it.
    assert.ok(row.note.includes(full), "the full directive rides in the note, which has room");
    assert.equal(row.state, "open");
  }
  // A directive that already fits is untouched — no gratuitous ellipsis.
  const short = deferralCoverageRow("field:WHO INN stem screening", CLASS_GAP_REASON);
  assert.equal(short.area, "Follow-up / WHO INN stem screening");
  assert.doesNotMatch(short.area, /…/, "a heading that fits is never marked as shortened");
});

test("#762 deferralCoverageRow: BOTH no-code-remedy branches reach the client with no engine token", () => {
  // The colon-prefixed engine vocabulary — "no-code-remedy:", "mechanical-fail:" — is minted by the
  // driver for the driver. It must never render raw on a client surface, and it must never be DELETED
  // either: the disclosure that the slice went unsearched is the whole reason the row exists.
  for (const reason of [CLASS_GAP_REASON, LABEL_REASON]) {
    const row = deferralCoverageRow("field:consumer water testing kits", reason);
    assert.doesNotMatch(row.note, /no-code-remedy:/i, "the engine token never reaches the page");
    assert.doesNotMatch(row.note, /\bterm×class\b|remedy\{/, "nor the engine's shorthand for it");
    assert.doesNotMatch(row.note, /[a-z]+-[a-z]+:/i, "no colon-prefixed engine token of any kind");
    // TRANSLATED, NOT FILTERED — the reader is still told it was not searched, and why.
    assert.match(row.note, /not completed this run/, "the disclosure survives translation");
    assert.match(row.note, /no search could be built for it/, "and it says why");
  }
  // The two branches say DIFFERENT things — a class gap is not a label-shaped item.
  assert.notEqual(
    deferralCoverageRow("field:x", CLASS_GAP_REASON).note,
    deferralCoverageRow("variant:x", LABEL_REASON).note);
  assert.match(deferralCoverageRow("field:x", CLASS_GAP_REASON).note, /names classes but no searchable name/);
  assert.match(deferralCoverageRow("variant:x", LABEL_REASON).note, /names a category rather than a name/);
  // An unrecognised no-code-remedy variant still translates rather than leaking its prefix.
  assert.doesNotMatch(
    deferralCoverageRow("variant:x", "no-code-remedy: something nobody has minted yet").note, /no-code-remedy:/i);
  // The mechanical-fail arms that already lived here are unchanged.
  assert.match(deferralCoverageRow("source:who inn list", "mechanical-fail:timeout").note, /the source timed out this run/);
});

test("#762 clipToWord: cuts on whitespace, marks the cut, and trims dangling punctuation", () => {
  assert.equal(clipToWord("short enough", 48), "short enough", "a string within budget is returned unchanged");
  assert.equal(clipToWord("alpha beta gamma delta", 12), "alpha beta…");
  assert.equal(clipToWord("alpha, beta, gamma", 8), "alpha…", "a trailing comma is trimmed before the ellipsis");
  assert.equal(clipToWord("alpha (beta gamma", 7), "alpha…", "no heading ends on a dangling bracket");
  assert.doesNotMatch(clipToWord("alpha beta gamma", 11), /\s…$/, "never 'alpha …'");
  assert.equal(clipToWord("supercalifragilistic", 8), "supercal…", "a single word longer than the budget still gets an ellipsis");
  assert.equal(clipToWord(null, 10), "", "null is empty, not the string 'null'");
});
