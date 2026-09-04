// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// / part 2 — no knockout seat characterises whether the registers were searched.
//
// part 2 was ruled after a live report carried "the register overlay has not been run" directly
// under a table of register counts the same run had taken. The cure went in at the ASSESS seat and
// nowhere else, so the SWEEP seat kept the same blindness with no prohibition — and produced the same
// class of sentence on R4, 2026-08-21: "No USPTO, EUIPO, WIPO, Swiss, or other trademark-register
// searches were performed, as instructed", in the delivered research file, on a run that took THIRTEEN
// EUIPO register searches and printed their counts in the same delivery's email body.
//
// The seat was not lying and "as instructed" truly described its own scope line. The client has no way
// to read it that narrowly, and one artifact then told them no EUIPO search happened while another
// reported EUIPO figures.
//
// SO THE ARM IS OVER EVERY SEAT, NOT THE TWO WE KNOW ABOUT. 's cure survived in one seat for months
// precisely because it was applied by hand to the seat that had failed. A prompt that TELLS a seat to
// stay off the registers has, by saying so, given it a fact about the run it will reach for when it
// writes about scope — so a prompt that says the first thing must say the second.
import { test } from "node:test";
import assert from "node:assert/strict";
import { knockoutPrompt, KO_STAGES } from "../stages-knockout.mjs";
import { RETIRED_POLICIES } from "../search-policy.mjs";   // — the retired rungs, derived not recited

/** Says something about the seat not searching registers. */
const SCOPES_OFF_REGISTERS = /do not search trademark registers|common-law \/ marketplace only/i;
/**
 * The prohibition part 2 ruled. TWO WORDINGS, because sharpened the assess
 * seat's and left the sweep seat's alone — the alternation is exact, not a loosening.
 *
 * The assess seat now says "SAY NOTHING ABOUT WHETHER THE REGISTER LANE RAN — whether registers were
 * searched, counted, overlaid or checked…", because that seat is handed the run's fetched FILINGS now
 * and the old sentence was being read as a bar on weighing them. The rule it states is the same rule
 * and slightly stronger; only the words moved. The marker moves in the same commit as the rephrasing,
 * which is the standing rule for every detector in this repository — a marker that goes quiet on a
 * rephrasing is the failure the detector exists to refuse, arriving as a pass.
 */
const CARRIES_SILENCE = /SAY NOTHING ABOUT WHETHER THE REGISTER(?:S WERE SEARCHED| LANE RAN)/;

/** Every knockout seat prompt this build can produce, keyed by the seat's name. */
function seatPrompts() {
  const out = {};
  out["knockout-sweep"] = knockoutPrompt(
    { name: "HESPRA", classes: [9, 41] }, { productContext: "games" }, { jurisdictions: ["CH"] });
  // The four K members the seats read. Paths are strings because the builders join them.
  const K = {
    runDir: "/tmp/ko-run", plan: "/tmp/ko-run/plan.json",
    assessChunk: (n) => `/tmp/ko-run/assess-${n}.json`, research: (name) => `/tmp/ko-run/research/${name}.md`,
  };
  const ctx = {
    K, job: { mark: "HESPRA", classes: [9, 41] }, profile: { key: "demo" },
    chunkNo: 0, chunkMarks: [{ name: "HESPRA", classes: [9] }], chunkTotal: 1, probeNote: "",
    framework: { title: "House default", framework_key: "house-default", entity_label: "the applicant",
      bands: [{ label: "High" }, { label: "Manageable" }] },
  };
  // A build failure is REPORTED, never swallowed: a seat this fixture cannot construct is a seat whose
  // cure nothing here checks, and the first cut of this file hid exactly that behind an empty catch.
  for (const [name, def] of Object.entries(KO_STAGES)) {
    if (typeof def?.message !== "function") continue;
    try { out[name] = def.message(ctx); }
    catch (e) { out[name] = new Error(`could not build: ${e.message}`); }
  }
  return out;
}

test("#1511 the seat fixture builds real prompts — an empty set would pass every arm below", () => {
  const seats = seatPrompts();
  const names = Object.keys(seats);
  assert.ok(names.length >= 2, `only built ${names.length} seat prompt(s): ${names.join(", ")}. The `
    + "arms below assert over what this builds, so a fixture that stopped building is a silent pass.");
  assert.ok(names.includes("knockout-sweep"), "the sweep seat — the one #1511 is about — is not in the set");
  for (const [name, text] of Object.entries(seats)) {
    assert.ok(!(text instanceof Error), `${name} could not be built by this fixture — ${text?.message}. `
      + "Its prompt is therefore unchecked by every arm below, which is the shape of gap #1511 is about.");
    assert.ok(String(text).length > 200, `${name}'s prompt came out empty or stubbed (${String(text).length} chars)`);
  }
});

test("#1511 a seat told to stay OFF the registers is also told not to describe them", () => {
  const seats = seatPrompts();
  const scoped = Object.entries(seats).filter(([, t]) => SCOPES_OFF_REGISTERS.test(t));
  assert.ok(scoped.length >= 1,
    "no seat prompt scopes itself off the registers any more — either the wording moved, in which case "
    + "this arm is watching nothing, or the scoping is gone and the failure mode changed shape");
  for (const [name, text] of scoped) {
    assert.match(text, CARRIES_SILENCE,
      `${name} tells its seat not to search the registers and does not tell it to stay silent about `
      + "whether they WERE searched. That is exactly the pair that produced #1511: the scope line is a "
      + "true statement about the seat, the seat reads it as a fact about the run, and it writes that "
      + "fact into a client-facing artifact the renderer is supposed to own.");
  }
});

test("#1511 the assess seat's cure is still there — #706 part 2 is not traded for #1511", () => {
  const assess = seatPrompts()["knockout-assess"];
  assert.ok(assess, "the assess seat no longer builds, so its cure is unverified");
  assert.match(assess, CARRIES_SILENCE, "the cure #706 part 2 put on the assess seat is gone");
});

// ── NO LIVE DISPATCH NAMES A RETIRED PRODUCT RUNG ─────────────────────────────
//
// The frame seat's second line read "You are framing a KNOCKOUT batch (Depth 1 triage)". Depth is a rung
// on a ladder the offering retired, and the doctrine that seat is told to read on line 1 mentions Depth
// zero times — a product name in the prompt with nothing in its own authority to resolve it against.
//
// The rule already existed on the other side of the same wall. `render-knockout.mjs` refuses a depth
// number on a client's page because it "is a rung on a ladder the offering no longer has". It had never
// been applied to the surface a MODEL reads. If it is meaningless to a reader holding the report, it is
// worse than meaningless to a seat being told what job it is doing.
//
// WHY THE PREVIOUS SWEEP MISSED IT, and why this arm is shaped the way it is: the closed audit of
// retired mechanisms walked `driver/skills/**`. This string is not in a skill file — it is composed in
// a `.mjs` and only exists as text once a dispatch is written. A corpus of skill files cannot see it.
// The model-facing surface is not only the skills tree; it is anything that reaches a dispatch.
//
// THE CORPUS IS COMPOSED TEXT, AND THAT IS HOW COMMENTS STAY OUT. This walks the strings the builders
// RETURN, never their source, so a comment explaining why a lane is shaped as it is can never be
// selected. That exclusion is structural rather than a rule someone has to remember — and it matters,
// because several of those comments are load-bearing history and the first person to run a source-level
// version of this check would delete one.
const RETIRED_RUNGS = [...new Set(
  Object.values(RETIRED_POLICIES).map((p) => p?.stageLabel).filter(Boolean),
)];

test("tracker issue 1915 — the retired-rung list is DERIVED from the registry, not recited here", () => {
  // A hand list is a second copy of the offering's history, and it goes stale in the direction that
  // passes: a rung retired after this file was written would simply not be looked for.
  assert.ok(RETIRED_RUNGS.length >= 2,
    `only ${RETIRED_RUNGS.length} retired rung(s) derived — RETIRED_POLICIES stopped carrying stageLabel, `
    + "and this arm is now searching for almost nothing");
  assert.ok(RETIRED_RUNGS.includes("Depth 1"),
    "the rung this issue is about is not in the derived set — the derivation is reading the wrong field");
});

test("tracker issue 1915 — no live seat prompt carries a retired product rung", () => {
  const seats = seatPrompts();
  const offenders = [];
  for (const [name, text] of Object.entries(seats)) {
    if (text instanceof Error || typeof text !== "string") continue;
    for (const rung of RETIRED_RUNGS) if (text.includes(rung)) offenders.push(`${name}: "${rung}"`);
  }
  assert.deepEqual(offenders, [],
    "a live dispatch names a rung the offering retired. The seat's own doctrine does not define it, so it "
    + "is a dangling product name in a prompt — name the product the registry names instead");
});

test("…and the arm FIRES on a planted dispatch string, so it cannot rot into a check that stopped selecting", () => {
  // The predicate driven against a KNOWN-BAD input, because every arm above passes on an empty corpus
  // and on a corpus this stopped matching. Planted as TEXT, in the shape a dispatch really has — the
  // thing under test is "would this be caught if it came back", not "does `includes` work".
  const planted = "You are framing a KNOCKOUT batch (Depth 1 triage) — you frame, you do NOT search.";
  const caught = RETIRED_RUNGS.filter((rung) => planted.includes(rung));
  assert.deepEqual(caught, ["Depth 1"],
    "the exact line this issue removed would not be caught if it returned");

  // …and it does not fire on the replacement, which is the half that says the fix is a fix rather than
  // a rewording that happens to dodge the matcher.
  const live = "You are framing a KNOCKOUT SEARCH batch — a triage pass. You frame, you do NOT search.";
  assert.deepEqual(RETIRED_RUNGS.filter((rung) => live.includes(rung)), []);
});
