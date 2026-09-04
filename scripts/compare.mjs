#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// compare.mjs — the CROSS-SCENARIO comparison views. Lays the sides of each comparison next to
// each other. Reads nothing but files.
//
//   node scripts/compare.mjs [--set product-comparison] [--run <ID>=<runDir> …] [--json]
//
// ── what this is for ─────────────────────────────────────────────────────────────────────────────────
//
// The suite proves runs finish. The offering claims each of the four products BUYS A DIFFERENT ANSWER,
// and no scenario could show that while no two scenarios shared a mark. puts five scenarios on one
// mark; this is the thing that reads them together. The comparisons are the deliverable, not the runs.
//
// ── it does not judge, and there is no number ────────────────────────────────────────────────────────
//
// in its own words: "reject a version that scores the comparisons into a pass/fail number". So
// this prints no verdict, and its EXIT CODE IS ALWAYS 0 — the same rule scripts/score.mjs already
// states about itself ("a caller that branches on it is reading a judgement this tool refuses to
// make"). Each view lays two or more sides beside each other; a human, or the design agent, reads the
// delta.
//
// ── an absence is a finding, and it has three shapes here ────────────────────────────────────────────
//
// A directory that was never walked, a run that does not exist, and an artifact that exists and holds
// nothing are three different facts, and collapsing any pair of them reports "we never looked" as
// "there is nothing there". `findRunsByRef` already keeps the first of those (`searched:false`); this
// file keeps the other two, everywhere, and prints them rather than a zero.
//
// ── why offline, and why it imports what it imports ──────────────────────────────────────────────────
//
// Same reasoning as scripts/score.mjs: it must be pointable at a preserved run directory on any
// machine, so it touches no queue, no door graph and no provider. `driver/e2e-rounds.mjs` is the pure
// leaf (node:fs + node:path) holding round discovery and the scenario filename pattern.
// `driver/reference-score.mjs` supplies the two classifications this view must not restate — the
// non-Latin script segment and the territory fold — because a second copy of either would be a second
// answer that has to agree with the scorer forever.

import "../shared/env-local.mjs";   // step 4 / — FIRST: this program read a
// retired spelling and never reached the alias layer, so an operator who set the name in force
// handed it nothing and the read fell through to a default. Proven both ways from one
// environment: without this import the value is invisible, with it the retired spelling is
// back-filled. Placed above every other import because a side-effecting import runs in order.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";

import { scenarioRefs, roundsFromRuns, mergeRounds, selectRound, SCENARIO_FILE } from "../driver/e2e-rounds.mjs";
// scriptSegments: "a run of letters outside the Latin script, which no Latin-variant sweep can reach".
// territoryKey: the office-alias fold (UK→GB, EM/EUTM/EUIPO→EU) the scorer's axis E is keyed on.
import { scriptSegments, territoryKey } from "../driver/reference-score.mjs";
// normalizeTerritory: the PROSE→CODE half. See territoryIdentity below for why one of these two is not
// enough on its own.
import { normalizeTerritory } from "../providers/_shared/territory-codes.mjs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

const die = (msg, code = 2) => { console.error(`\n${msg}\n`); process.exit(code); };

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// ── the levers this box does not run the way production does ─────────────────────────────────────────
//
// records these, and its acceptance makes parity a PRECONDITION rather than a nicety. They are
// printed HERE, in the comparison, and not only in the design document — the person who needs the
// sentence is looking at a Korea column that reads flat, and the question they are about to answer
// wrongly is whether that is the product or the box.
const CONFIG_PARITY = {
  levers: [
    "native language is OFF on the test instance — rows 3 and 4 are the two scenarios whose whole subject it is",
    "the EU cross-check runs on SAMPLE DATA, not the live corpus",
    "saved searches are SAMPLES, not the customer's own",
  ],
  stores: [
    "CLEAROTRON_E2E_DIR — the scenarios and baselines this round measured against",
    "CLEAROTRON_CUSTOMERS_DIR — the accounts and project overlays rows 2 and 5 are the comparison of",
    "CLEAROTRON_INSTRUCTIONS_DIR — the compute skills the stage prompts resolve against",
  ],
  sentence: "Any round judging those levers on the test box is judging a system nobody ships.",
};

// ── what these five deliberately do not reach ────────────────────────────────────────────────────────
// Recorded as not covered, never silently absent — 's own instruction.
const NOT_COVERED = [
  "common law in a country that has none — Switzerland has no common-law rights system and none of the five points there, so the engine's behaviour when the grid has nothing to search is unexercised",
  "the deliverable step — the client-format document produced at the lawyer's agent is outside tracker #462 and no scenario reaches it",
  "lawyer reference answers for this mark — out of scope by the issue's own wording (comparisons, not gold), so scripts/score.mjs cannot be pointed at any of the five",
];

// ── the store ────────────────────────────────────────────────────────────────────────────────────────
// Read straight off the environment, the way scripts/score.mjs reads its baselines: importing
// scripts/e2e.mjs to reach `scenarioStore()` would drag the whole door graph in behind it.
/**
 * Did this ledger query record a result COUNT at all?
 *
 * `parseCaseLawLedger` writes `results` as a number or as null, and null means "not recorded" — a
 * different fact from a counted zero, because an unrun sweep hides inside an honest negative exactly
 * there. `Number.isFinite(Number(x))` is NOT this predicate: Number(null) is 0 and Number("") is 0, so
 * it scores both as a counted zero. My first version did, and the test below caught it.
 */
export const hasCountedResult = (q) => typeof q?.results === "number" && Number.isFinite(q.results);


function loadSet(setName) {
  const root = (process.env.CLEAROTRON_E2E_DIR ?? "").trim();
  if (!root) die(`CLEAROTRON_E2E_DIR is unset, so there are no scenarios to compare.\n`
    + `  There is one suite and it is not in this repo (owner ruling 2026-08-07). Point CLEAROTRON_E2E_DIR\n`
    + `  at the config repo's e2e/ directory — scenarios/ beneath it.`);
  const dir = join(root, "scenarios");
  let files;
  try { files = readdirSync(dir).filter((f) => SCENARIO_FILE.test(f)); }
  catch (e) { die(`e2e scenario store unreadable: ${dir} (${e.code || e.message})\n`
    + `  CLEAROTRON_E2E_DIR must name the store's e2e/ directory, with scenarios/ beneath it.`); }
  // A SCENARIO THAT IS ON DISK AND UNREADABLE IS NOT A SCENARIO THAT IS ABSENT.
  //
  // This used to be `.map(readJson).filter(Boolean)`, and readJson swallows every read and parse error
  // into null — so a truncated or malformed file vanished and the set silently became four. The output
  // still printed the full comparison, still headed the depth dial as though both its rows were there,
  // and said nothing. That is the failure this whole tool exists to expose, committed by the tool.
  //
  // Torn files are named and the run REFUSES. A comparison whose inputs are not all readable cannot be
  // read as a comparison of the five, and continuing with a quiet four is how a missing product looks
  // like a product that changed nothing.
  const read = files.map((f) => ({ f, doc: readJson(join(dir, f)) }));
  const torn = read.filter((r) => r.doc === null).map((r) => r.f);
  if (torn.length) die(`${torn.length} scenario file(s) in ${dir} are present and unreadable:\n`
    + torn.map((f) => `  ${f}`).join("\n")
    + `\n\n  Not skipped. A comparison missing one of its sides is not a smaller comparison, it is a\n`
    + `  wrong one — and the views below would have printed as though the full set were there.`);
  const all = read.map((r) => r.doc);
  const mine = all.filter((s) => s?.compare?.set === setName);
  if (!mine.length) {
    // AN ABSENCE IS A FINDING. Naming what the store DOES hold is the difference between "this set is
    // not there" and "the store is empty", and the two send a reader to different places.
    die(`no scenario in ${dir} declares compare.set ${JSON.stringify(setName)}.\n`
      + `  the store holds ${all.length} scenario(s): ${all.map((s) => s.id).join(", ") || "none"}\n`
      + `  sets present: ${[...new Set(all.map((s) => s?.compare?.set).filter(Boolean))].join(", ") || "none — no scenario carries a compare block"}\n`
      + `  The five definitions and their compare blocks are in docs/design/e2e-product-comparison.md.`);
  }
  // Ordered by the ROW the scenario declares, never by filename: R10 and R11 sort before R7
  // lexicographically, and a view that labelled row 4's column "row 1" would be read straight past.
  return { root, dir, scenarios: mine.sort((a, b) => a.compare.row - b.compare.row) };
}

// ── which run directory belongs to each scenario ─────────────────────────────────────────────────────
function locateRun(sc, { workspaceRoot, named }) {
  if (named.has(sc.id)) {
    const dir = named.get(sc.id);
    if (!existsSync(dir)) return { dir: null, why: `named with --run, and ${dir} is not on disk`, searched: true };
    return { dir, token: null, why: `named with --run: ${dir}`, searched: true };
  }
  const refs = scenarioRefs(sc);
  if (!refs.length) return { dir: null, searched: false, why: `${sc.id} declares no ref, so no run can be found for it` };
  const disk = roundsFromRuns(refs, workspaceRoot);
  if (!disk.searched) return { dir: null, searched: false, why: disk.why };
  const rounds = mergeRounds({ receiptRounds: [], diskRounds: disk.byToken });
  const { round, why } = selectRound(rounds);
  if (!round) return { dir: null, searched: true, why: `${why} — the workspace was searched and holds no round of ${sc.id}` };
  const run = round.runs?.[0] ?? null;
  if (!run) return { dir: null, searched: true, token: round.token, why: `round ${round.token} is known and holds no run directory` };
  return { dir: run.runDir, token: round.token, searched: true, why: `${why} (round ${round.token})` };
}

// ── the artifact reads, each one three-valued ────────────────────────────────────────────────────────
//
// `{ state: "absent" | "unreadable" | "present" }`. Never a bare null and never a bare 0: a
// findings.json that is missing and one holding an empty array are different facts about a run, and the
// whole point of this view is that a reader can tell which they are looking at.
function artifact(runDir, rel) {
  const p = join(runDir, rel);
  if (!existsSync(p)) return { state: "absent", path: rel, why: `${rel} absent`, doc: null };
  const raw = readText(p);
  if (raw == null) return { state: "unreadable", path: rel, why: `${rel} is on disk and could not be read`, doc: null };
  if (!rel.endsWith(".json")) return { state: "present", path: rel, why: null, doc: null, text: raw };
  try { return { state: "present", path: rel, why: null, doc: JSON.parse(raw), text: raw }; }
  catch (e) { return { state: "torn", path: rel, why: `${rel} is on disk (${raw.length} bytes) and does not parse (${e.message})`, doc: null }; }
}

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * ONE identity for a territory, and it takes BOTH folds — this is the trap that manufactures an
 * absence, and it took a red test to see it.
 *
 * `territoryKey` alone does NOT map prose to a code: it strips non-alphanumerics, uppercases, and folds
 * a small office-alias set. So `"South Korea"` becomes `"SOUTHKOREA"` while a register plan's regions
 * say `"KR"`, the two never compare equal, and the depth dial reports "no sub-query for this territory"
 * on every run forever — an absence invented by the view, indistinguishable from a product that does
 * not deepen. That is precisely the failure docs/design/e2e-product-suite.md records for the scorer's
 * own office-vocabulary fold, arriving one layer higher up.
 *
 * `normalizeTerritory` alone is not enough either: it passes any two-letter token through uppercased,
 * so `EM` (the provider's spelling of the EU trade mark office) stays `EM` and never meets `EU`.
 *
 * So: prose → code first, then the office-alias fold. A worldwide token normalizes to nothing and
 * yields `null` here — a mode is not a place, and counting one as a territory is what let a worldwide
 * sweep read as a single-country deep dive.
 */
const territoryIdentity = (label) => territoryKey(normalizeTerritory(label) || label);

/** The territories a finding names, folded to the scorer's own comparison key. */
function findingTerritories(f) {
  const raw = [
    ...arr(f?.jurisdictions),
    ...(typeof f?.jurisdiction === "string" ? [f.jurisdiction] : []),
    ...arr(f?.registrations).flatMap((r) => (typeof r?.jurisdiction === "string" ? [r.jurisdiction] : arr(r?.jurisdictions))),
  ];
  return [...new Set(raw.map(territoryIdentity).filter(Boolean))];
}

/**
 * 's classification, on the frozen register plan: is a query THIS territory's own deep-dive, one
 * that merely reaches it, or one restricted to nowhere?
 *
 * "Per-jurisdiction is not narrower than the scope. It is a query that names ONE territory and no
 * other" (driver/reference-score.mjs). Collapsing `own` into `grouped` makes a worldwide sweep read as
 * a single-country deep dive, which is the exact claim the depth dial exists to test.
 */
function planShape(plan, country) {
  const key = territoryIdentity(country);
  const entries = arr(plan?.doc?.entries);
  if (plan.state !== "present") return { readable: false, why: plan.why };
  const out = { readable: true, own: 0, grouped: 0, unrestricted: 0, total: entries.length };
  for (const e of entries) {
    const regions = [...new Set(arr(e?.regions).map(territoryIdentity).filter(Boolean))];
    if (!regions.length) { out.unrestricted++; continue; }
    if (!regions.includes(key)) continue;
    if (regions.length === 1) out.own++; else out.grouped++;
  }
  return out;
}

// ── the report, as one object, printed two ways ──────────────────────────────────────────────────────
function gather(sc, loc) {
  if (!loc.dir) return null;
  const A = (rel) => artifact(loc.dir, rel);
  const findings = A("findings.json");
  const knockout = A("knockout-findings.json");
  const plan = A("_driver/register-plan.json");
  const scope = A("_driver/instructed-scope.json");
  const profile = A("_driver/profile.json");
  const framework = A("_driver/framework.json");
  const jx = A("_driver/jx-lanes.json");
  const caseLaw = A("case-law-citations.json");
  const caseLawProse = A("case-law-findings.md");
  const report = A("report.md");
  const lint = A("_driver/predelivery-lint.json");
  const verdict = A("_driver/verdict.json");
  const list = arr(findings.doc?.findings);
  return {
    dir: loc.dir, token: loc.token ?? null, why: loc.why,
    findings: { state: findings.state, why: findings.why, count: findings.state === "present" ? list.length : null, list },
    knockout: { state: knockout.state, why: knockout.why, marks: arr(knockout.doc?.marks) },
    plan, scope, profile, framework, jx, caseLaw, caseLawProse, report, lint, verdict,
  };
}

function print(set, rows) {
  const L = (s = "") => console.log(s);
  const label = (r) => `row ${r.sc.compare.row} · ${r.sc.id}`;
  const pad = (s, n) => String(s).padEnd(n);

  L();
  L(`PRODUCT COMPARISON — set "${set.name}"`);
  L(`store:     ${set.dir}`);
  L(`workspace: ${set.workspaceLine}`);
  L();
  L("This lays the sides of each comparison next to each other and states nothing about which side is");
  L("better. There is no verdict here, no score, and the exit code carries no judgement — a reader");
  L("reads the delta.");
  L();

  L("── READ THIS FIRST · the test instance is not the system that ships ──────────────────────────────");
  for (const lever of CONFIG_PARITY.levers) L(`  · ${lever}`);
  L(`  ${CONFIG_PARITY.sentence}`);
  L("  Three stores must also resolve to the same content as the run being compared against — recorded");
  L("  as paths and content hashes in the round's evidence, never assumed from the deploy:");
  for (const s of CONFIG_PARITY.stores) L(`    · ${s}`);
  L();

  L("── WHAT WAS ORDERED ──────────────────────────────────────────────────────────────────────────────");
  for (const r of rows) {
    const j = r.sc.job ?? {};
    const names = j.markName ? 1 : arr(j.marks).length;
    const where = j.geography?.mode === "worldwide" ? "worldwide"
      : arr(j.jurisdictions).length ? `${j.jurisdictions.length} named: ${j.jurisdictions.join(", ")}`
      : "the account's own territories";
    const toggles = [
      j.nativeLanguage === true ? "native language ON (a paid toggle)" : null,
      j.product === "full-country-search" ? "case law + native language AUTOMATIC (what the product IS)" : null,
      j.product === "knockout-search" ? "register hit-counts (always on)" : null,
    ].filter(Boolean).join(" · ") || "—";
    L(`  ${pad(label(r), 13)} ${pad(j.product ?? "?", 28)} ${names} name(s)`);
    L(`  ${pad("", 13)} scope:   ${where}`);
    L(`  ${pad("", 13)} client:  account ${JSON.stringify(j.profileKey ?? null)}${j.projectKey ? `, project ${JSON.stringify(j.projectKey)}` : ", no project"}`);
    L(`  ${pad("", 13)} toggles: ${toggles}`);
    L(`  ${pad("", 13)} run:     ${r.run ? `${r.run.dir}  (${r.run.why})` : `NONE — ${r.loc.why}`}`);
    L();
  }

  // ── the headline test ──────────────────────────────────────────────────────────────────────────────
  const dial = rows.filter((r) => r.sc.compare.depthDialCountry);
  const country = dial[0]?.sc.compare.depthDialCountry ?? null;
  L(`── DEPTH DIAL · rows ${dial.map((r) => r.sc.compare.row).join(" ↔ ")} on ${country ?? "(no shared country declared)"} ────────────────────────────`);
  // WHAT THIS VIEW COMPARES, SAID ON THE VIEW. `planShape` reads the register plan — what the run was
  // ORDERED to search. It does not join the execution receipt, so it cannot show what was actually
  // dispatched, and a plan that was never executed renders identically to one that was.
  //
  // The issue's headline claim — a single-country search finds materially more IN that country than a
  // global search did — is a claim about EXECUTION. Until the join lands this panel is evidence about
  // intent only, and a reader who takes it for evidence about outcome is being misled by the view
  // rather than by the run. Stated here because a limitation a reader cannot see is a wrong answer.
  L("  READS THE PLAN, NOT THE RECEIPT — what each run was ordered to search. A plan that never executed");
  L("  renders the same as one that did, so this shows the dial was SET, never that it was turned.");
  L("  The headline claim: a single-country search finds materially more in that country than a global");
  L("  search did. What is laid out is the shape of the register plan for that ONE territory —");
  L("  `own` = queries naming it and no other (the deep-dive), `grouped` = queries reaching it");
  L("  alongside others, `unrestricted` = queries restricted to nowhere and never attributed to it.");
  L("  Whether a difference is a MATERIAL one is the reading, and it is not made here.");
  if (!country) L("  no scenario in this set declares compare.depthDialCountry — the comparison cannot be selected");
  for (const r of dial) {
    if (!r.run) { L(`  ${pad(label(r), 13)} no run — ${r.loc.why}`); continue; }
    const shape = planShape(r.run.plan, country);
    // The two lines are printed INDEPENDENTLY. An unreadable plan used to skip the findings line with
    // it, which reports one absence by manufacturing a second: whether the run surfaced anything about
    // this territory is a fact its findings carry whether or not the frozen plan can be read.
    L(`  ${pad(label(r), 13)} ${shape.readable
      ? `own ${shape.own} · grouped ${shape.grouped} · unrestricted ${shape.unrestricted}   (of ${shape.total} planned queries)`
      : `${shape.why} — so this is not a count of queries`}`);
    const hits = r.run.findings.state === "present"
      ? r.run.findings.list.filter((f) => findingTerritories(f).includes(territoryIdentity(country))).length
      : null;
    L(`  ${pad("", 13)} findings naming ${country}: ${hits === null ? r.run.findings.why : `${hits} finding(s)`}`);
  }
  L();

  // ── the config layers ──────────────────────────────────────────────────────────────────────────────
  const layers = rows.filter((r) => [2, 5].includes(r.sc.compare.row));
  L("── CONFIG LAYERS · rows 2 ↔ 5 ────────────────────────────────────────────────────────────────────");
  L("  Same mark, same product, same scope; different account and a project overlay on one of them. A");
  L("  layer that reaches the same search or the same weighing is decoration.");
  for (const r of layers) {
    if (!r.run) { L(`  ${pad(label(r), 13)} no run — ${r.loc.why}`); continue; }
    const sc = r.run.scope;
    const pr = r.run.profile;
    L(`  ${pad(label(r), 13)} account ${JSON.stringify(r.sc.job?.profileKey ?? null)}${r.sc.job?.projectKey ? ` · project ${JSON.stringify(r.sc.job.projectKey)}` : ""}`);
    L(`  ${pad("", 13)} classes:      ${sc.state === "present" ? JSON.stringify(sc.doc?.classes ?? sc.doc?.nice_classes ?? null) : sc.why}`);
    L(`  ${pad("", 13)} territories:  ${sc.state === "present" ? JSON.stringify(sc.doc?.jurisdictions ?? sc.doc?.territories ?? null) : sc.why}`);
    L(`  ${pad("", 13)} marketplaces: ${pr.state === "present" ? `${arr(pr.doc?.platforms ?? pr.doc?.profile?.platforms).length} platform(s)` : pr.why}`);
    L(`  ${pad("", 13)} framework:    ${r.run.framework.state === "present" ? JSON.stringify(r.run.framework.doc?.framework_key ?? null) : r.run.framework.why}`);
    L(`  ${pad("", 13)} findings:     ${r.run.findings.count === null ? r.run.findings.why : `${r.run.findings.count} finding(s)`}`);
    L(`  ${pad("", 13)} verdict:      ${r.run.verdict.state === "present" ? JSON.stringify(r.run.verdict.doc?.verdict ?? r.run.verdict.doc?.level ?? null) : r.run.verdict.why}`);
  }
  L();

  // ── fan-out ────────────────────────────────────────────────────────────────────────────────────────
  const fan = rows.find((r) => r.sc.compare.row === 1);
  L("── FAN-OUT · row 1 ───────────────────────────────────────────────────────────────────────────────");
  L("  Eight names must produce eight reports, each with typed findings and the register counts as");
  L("  context rather than as the answer.");
  if (!fan) L("  no row 1 in this set");
  else if (!fan.run) L(`  ${pad(label(fan), 13)} no run — ${fan.loc.why}`);
  else {
    const k = fan.run.knockout;
    const asked = arr(fan.sc.job?.marks).length;
    L(`  ${pad(label(fan), 13)} names asked: ${asked}`);
    L(`  ${pad("", 13)} names in knockout-findings.json: ${k.state === "present" ? k.marks.length : k.why}`);
    for (const m of k.marks) {
      const typed = arr(m?.findings).length;
      L(`  ${pad("", 13)}   ${pad(m?.name ?? m?.mark ?? "(unnamed)", 16)} typed findings: ${arr(m?.findings).length ? typed : (m?.findings === undefined ? "field absent" : "0")}`
        + `  register counts: ${m?.counts ? JSON.stringify(m.counts) : "field absent"}`);
    }
  }
  L();

  // ── native language ────────────────────────────────────────────────────────────────────────────────
  const nat = rows.find((r) => r.sc.job?.nativeLanguage === true);
  L("── NATIVE LANGUAGE · row 3 ───────────────────────────────────────────────────────────────────────");
  L("  Findings whose mark carries a run of letters outside the Latin script — the part no Latin-variant");
  L("  sweep can reach. If nothing is marked, the differentiator is not real. Read this beside the");
  L("  parity block above before concluding anything: on the test box this lever is switched off.");
  if (!nat) L("  no scenario in this set turns the native-language toggle on");
  else if (!nat.run) L(`  ${pad(label(nat), 13)} no run — ${nat.loc.why}`);
  else {
    const f = nat.run.findings;
    if (f.state !== "present") L(`  ${pad(label(nat), 13)} ${f.why} — whether any finding was script-reached cannot be established`);
    else {
      const reached = f.list.filter((x) => scriptSegments(x?.mark ?? x?.name ?? "").length);
      L(`  ${pad(label(nat), 13)} script-reached findings: ${reached.length} of ${f.list.length}`);
      for (const x of reached) L(`  ${pad("", 13)}   ${x.mark ?? x.name}`);
    }
    const jx = nat.run.jx;
    L(`  ${pad("", 13)} lanes folded:   ${jx.state === "present" ? JSON.stringify(Object.keys(jx.doc?.fold?.lanes ?? {})) : jx.why}`);
    L(`  ${pad("", 13)} lanes executed: ${jx.state === "present" ? JSON.stringify(jx.doc?.fold?.executes ?? null) : jx.why}`);
  }
  L();

  // ── the deep end ───────────────────────────────────────────────────────────────────────────────────
  const deep = rows.find((r) => r.sc.compare.row === 4);
  L("── DEEP END · row 4 ──────────────────────────────────────────────────────────────────────────────");
  L("  Case law is what a Full country search IS. A report claiming no adverse case law and a run whose");
  L("  sweep never dispatched produce byte-identical prose, so only the retrieval ledger tells them");
  L("  apart — every dispatched query INCLUDING the ones that returned nothing.");
  if (!deep) L("  no row 4 in this set");
  else if (!deep.run) L(`  ${pad(label(deep), 13)} no run — ${deep.loc.why}`);
  else {
    const cl = deep.run.caseLaw;
    if (cl.state !== "present") {
      L(`  ${pad(label(deep), 13)} ${cl.why} — whether any query was dispatched cannot be established from this run.`);
      L(`  ${pad("", 13)} ${deep.run.caseLawProse.state === "present"
        ? "case-law-findings.md IS present, and it is prose: it cannot distinguish a clean sweep from a sweep that never ran."
        : deep.run.caseLawProse.why}`);
    } else {
      // THE FIELD NAMES ARE THE ONES driver/case-law-ledger.mjs `parseCaseLawLedger` WRITES, and nothing
      // else. This view read `hits`, `proceedings` and `entries`; the ledger has `results`, `citations`
      // and no `entries` at all. Every one of those failed in the SAME direction — a sweep that
      // dispatched queries and read documents rendered as one that found nothing and read nothing.
      // A false empty here is worse than no view: this is the panel that decides whether a Full country
      // search bought anything, and it was answering "no" for every run.
      //
      // `read` was the sharpest of the three. Its states are "read" | "listed-not-read" | "unreachable"
      // (CASE_LAW_READ_STATES), so `!p.read` — a truthiness test on a non-empty string — counted an
      // explicitly UNREAD citation as read, and reported "0 unread of 0" on a dive that opened nothing.
      const queriesCl = arr(cl.doc?.queries);
      const citesCl = arr(cl.doc?.citations);
      const noQueryArray = !Array.isArray(cl.doc?.queries);
      L(`  ${pad(label(deep), 13)} dispatched queries: ${noQueryArray ? "NO queries[] IN THE LEDGER — this is not zero, it is unreadable" : queriesCl.length}`);
      if (!noQueryArray) {
        // `results: null` is "not recorded", which is NOT the same fact as a counted zero. Reporting
        // them together is how an unrun sweep hides inside an honest negative.
        const counted = queriesCl.filter(hasCountedResult);
        const empty = counted.filter((q) => Number(q.results) === 0);
        L(`  ${pad("", 13)} returned nothing:   ${empty.length} of ${counted.length} with a counted result`
          + `${counted.length < queriesCl.length ? `; ${queriesCl.length - counted.length} carry NO count (unrecorded, not zero)` : ""}`);
      }
      const unread = citesCl.filter((c) => c?.read !== "read");
      L(`  ${pad("", 13)} citations unread:   ${unread.length} of ${citesCl.length}`
        + `${citesCl.length && unread.length === citesCl.length ? "  <- every citation listed and NOT ONE opened" : ""}`);
    }
    const jx = deep.run.jx;
    L(`  ${pad("", 13)} native lanes (automatic here): folded ${jx.state === "present" ? JSON.stringify(Object.keys(jx.doc?.fold?.lanes ?? {})) : jx.why}`);
  }
  L();

  // ── the report rules ───────────────────────────────────────────────────────────────────────────────
  L("── REPORT RULES · all five ───────────────────────────────────────────────────────────────────────");
  L("  One sentence above the fold, nothing cut below it, one product name everywhere, coverage named");
  L("  concretely, no advice anywhere. What is printed is what each run RECORDED — the first line of the");
  L("  report and the engine's own predelivery lint. Whether the sentence is a good one is a read.");
  for (const r of rows) {
    if (!r.run) { L(`  ${pad(label(r), 13)} no run — ${r.loc.why}`); continue; }
    const rep = r.run.report;
    const first = rep.state === "present"
      ? (String(rep.text).split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"))[0] ?? "(no non-heading line)")
      : rep.why;
    L(`  ${pad(label(r), 13)} above the fold: ${String(first).slice(0, 96)}`);
    L(`  ${pad("", 13)} predelivery lint: ${r.run.lint.state === "present" ? JSON.stringify(r.run.lint.doc?.state ?? r.run.lint.doc?.status ?? "recorded") : r.run.lint.why}`);
  }
  L();

  L("── NOT COVERED · recorded, not silently absent ───────────────────────────────────────────────────");
  for (const n of NOT_COVERED) L(`  · ${n}`);
  L();
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────
// ── THE CLI RUNS ONLY WHEN THIS FILE IS THE ENTRYPOINT ─────────────────────────────────────────────
//
// Everything above is importable; everything below reads argv and exits. Without this split, importing
// the file to reuse one predicate RUNS THE WHOLE TOOL and exits the importing process — which is what
// happened the first time a test tried to bind to `hasCountedResult` instead of restating it. A rule
// restated in a test is a second copy that can disagree with the one that ships, and this file's own
// header is about exactly that.
if (isEntrypoint(import.meta.url)) {
  const raw = process.argv.slice(2);
  let setName = "product-comparison", asJson = false;
  const named = new Map();
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--json") asJson = true;
    else if (a === "--set") setName = raw[++i] ?? die("--set needs a set name");
    else if (a.startsWith("--set=")) setName = a.slice("--set=".length);
    else if (a === "--run" || a.startsWith("--run=")) {
      const v = a === "--run" ? raw[++i] : a.slice("--run=".length);
      const eq = String(v ?? "").indexOf("=");
      if (eq < 1) die(`--run takes <ID>=<runDir>, e.g. --run R8=/path/to/run. Got ${JSON.stringify(v ?? null)}.`);
      named.set(v.slice(0, eq).toUpperCase(), v.slice(eq + 1));
    } else die(`unexpected argument ${JSON.stringify(a)}\n`
      + `  usage: compare.mjs [--set <name>] [--run <ID>=<runDir> …] [--json]`);
  }

  const set = loadSet(setName);
  const workspaceRoot = envFrom(process.env, "CLEAROTRON_WORK_DIR") ?? "";
  // The unset case is carried as a SENTENCE rather than as an empty result, because "no run found" and
  // "no directory was walked" are the two answers this view most needs to keep apart.
  const workspaceLine = workspaceRoot
    ? workspaceRoot
    : "CLEAROTRON_WORK_DIR is unset — no directory was walked, so nothing below is a count of runs";

  const rows = set.scenarios.map((sc) => {
    const loc = locateRun(sc, { workspaceRoot, named });
    return { sc, loc, run: gather(sc, loc) };
  });

  if (asJson) {
    console.log(JSON.stringify({
      set: setName,
      store: set.dir,
      workspace: workspaceRoot || null,
      workspaceWhy: workspaceRoot ? null : workspaceLine,
      configParity: CONFIG_PARITY,
      notCovered: NOT_COVERED,
      scenarios: rows.map((r) => ({
        id: r.sc.id,
        row: r.sc.compare.row,
        product: r.sc.job?.product ?? null,
        mark: r.sc.compare.mark ?? null,
        depthDialCountry: r.sc.compare.depthDialCountry ?? null,
        // NULL, never {}. An empty object reads as a run that was found and had nothing in it.
        run: r.run ? { dir: r.run.dir, token: r.run.token, why: r.run.why, findings: r.run.findings.count } : null,
        whyNoRun: r.run ? null : r.loc.why,
      })),
    }, null, 2));
  } else {
    print({ name: setName, dir: set.dir, workspaceLine }, rows);
  }

  // ALWAYS 0. See the header: a caller that branches on this is reading a judgement this tool refuses to
  // make.
  process.exit(0);

}
