// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real matter-frame prompt and the real product-scope check
//
// — A PROJECT'S DEFAULT TERRITORIES WIDENED AN EXPLICIT ORDER.
//
// MEASURED. A Full country search ordered over Japan, under a project whose defaults are JP,KR,
// retrieved seven Korean records and claimed completed Korean coverage six times. The order was JP.
//
// The widening never touched the validated scope: resolveTerritories correctly returns ["JP"],
// checkProductScope sees one country, and the runner's wall agrees. There are TWO channels from an
// order to the engine — the scope ladder and the matter-frame prompt — and only the ladder had a wall.
//
// THE PROMPT CONTRADICTED ITSELF, fourteen lines apart:
//     Instructed territories (AUTHORITATIVE scope — do NOT widen to "major markets"): JP
//     Customer-default jurisdictions that materially matter: JP, KR.
// and stages.mjs then instructs a UNION of the coverage ledger against that second list. The model
// complied. This is not a hallucination, and an arm that treated it as one would guard the wrong thing.
//
// WHY THESE ARMS READ THE PROMPT AND NOT THE SCOPE. Every scope-level assertion here passes on the
// BROKEN code — the resolved scope was always ["JP"]. The defect is only visible in the bytes the model
// is handed, so that is what is asserted.
import { test } from "node:test";
import assert from "node:assert/strict";

import { STAGES } from "../stages.mjs";
import { territoryTier, recognizedTerritories } from "../territory-tiers.mjs";
import { checkProductScope } from "../products.mjs";

const DEFAULT_LINE = /Customer-default jurisdictions/;

const frame = ({ jurisdictions, defaults }) => STAGES["matter-frame"].message({
  paths: { inboundRequest: "/dev/null" },
  job: { marks: ["EXAMPLEMARK"], classes: [9], ...(jurisdictions === undefined ? {} : { jurisdictions }) },
  customerUnknown: true,
  profile: { defaultJurisdictions: defaults },
  exclusionSeed: [],
});

// ── THE DEFECT: A STATED SCOPE SUPPRESSES THE DEFAULTS ────────────────────────────────────────────

test("2160 an order that names a territory gets NO default-jurisdictions line", () => {
  const msg = frame({ jurisdictions: ["JP"], defaults: ["JP", "KR"] });
  assert.doesNotMatch(msg, DEFAULT_LINE,
    "the order named JP — a project default must not also be announced as materially mattering");
});

test("2160 THE POINT: no territory the order did not name appears ANYWHERE in the prompt", () => {
  // The stronger form, and the one that matches the harm. Suppressing the LINE is not the requirement;
  // the requirement is that the model is never shown KR at all, because the stage that follows is told
  // to UNION the coverage ledger against whatever it was shown.
  const msg = frame({ jurisdictions: ["JP"], defaults: ["JP", "KR"] });
  assert.ok(!/\bKR\b/.test(msg), "KR reached the prompt on an order that named only JP");
  assert.match(msg, /Instructed territories[^\n]*JP/, "and the authoritative scope is still stated");
});

test("2160 the control run's shape is covered too — disjoint defaults were never safe, only lucky", () => {
  // The control run measured beside the defective one: ordered China, project defaults US/EU/UK.
  // It did NOT widen — but its prompt carried
  // the same contradiction, and the archived dispatch proves it. It is a run that happened not to bite,
  // not a run the product got right, so it must be fixed by the same rule rather than left as evidence.
  const msg = frame({ jurisdictions: ["China"], defaults: ["US", "EU", "UK"] });
  assert.doesNotMatch(msg, DEFAULT_LINE);
  for (const t of ["US", "EU", "UK"]) assert.ok(!new RegExp(`\\b${t}\\b`).test(msg), `${t} reached the prompt`);
});

test("2160 the shape rule is the SHARED one — a bare string is a stated scope too", () => {
  // effective-scope.mjs's jobJurisdictions exists because THIS FILE once accepted a bare string where
  // jx-lanes.mjs tested Array.isArray and fell through to the account's defaults. Re-deriving "did the
  // request name any" here by hand is how that disagreement started, so the arm pins the shared answer.
  assert.doesNotMatch(frame({ jurisdictions: "JP", defaults: ["JP", "KR"] }), DEFAULT_LINE,
    "a bare-string scope is still a stated scope");
});

// ── THE NEGATIVE CONTROL: FILLING AN ABSENT SCOPE IS LEGITIMATE AND MUST SURVIVE ──────────────────

test("2160 CONTROL: an order naming NO territory still gets the defaults", () => {
  const msg = frame({ defaults: ["JP", "KR"] });
  assert.match(msg, DEFAULT_LINE, "defaults fill an absent scope — that is what they are for");
  assert.match(msg, /JP, KR/);
  const empty = frame({ jurisdictions: [], defaults: ["JP", "KR"] });
  assert.match(empty, DEFAULT_LINE, "an EMPTY list names no territory — it is absence, not a scope of none");
});

// ── ITEM 2: A STAFF FREE-TEXT FIELD MUST NOT REACH A PROMPT UNCHECKED ─────────────────────────────

test("2160 garbage in a staff profile never reaches the prompt", () => {
  const msg = frame({ defaults: ["JP", "QQ", "NOWHERE"] });
  assert.match(msg, /JP/);
  for (const junk of ["QQ", "NOWHERE"]) assert.ok(!new RegExp(junk).test(msg), `${junk} reached the prompt`);
});

test("2160 defaults that are ENTIRELY garbage omit the line rather than announcing an empty list", () => {
  assert.doesNotMatch(frame({ defaults: ["QQ", "NOWHERE"] }), DEFAULT_LINE,
    "an empty 'these materially matter:' is a sentence with nothing in it");
});

test("2160 recognizedTerritories reports what it dropped — an absence is a finding", () => {
  const { kept, dropped } = recognizedTerritories(["JP", "QQ", "EU"]);
  assert.deepEqual(kept, ["JP", "EU"], "regions are places too — only the unrecognized go");
  assert.deepEqual(dropped, ["QQ"], "a silent drop is how nobody finds out the staff form has a typo");
  assert.deepEqual(recognizedTerritories(null), { kept: [], dropped: [] }, "null is not a throw");
});

// ── 1945, REPRODUCED AND FIXED — SAME FAMILY: A VALIDATED CHANNEL AND AN UNVALIDATED ONE ──────────

test("1945 ZZ names nowhere and is no longer a country", () => {
  // ZZ is WIPO ST.3's code for UNSPECIFIED and sat in KNOWN_JURISDICTION_CODES' register-world extras.
  // territoryTier tiered any known non-region code as "country", so the code meaning "nowhere" satisfied
  // the one-country rule — exactly the failure territory-tiers.mjs was written to prevent ("QQ would
  // otherwise look exactly like a country code"), arriving from INSIDE the known set.
  assert.equal(territoryTier("ZZ"), "unrecognized");
  assert.equal(territoryTier("zz"), "unrecognized", "the fold is applied before the tier, in both directions");
});

test("1945 a Full country search over ZZ is refused", () => {
  const v = checkProductScope({ product: "full-country-search", territories: ["ZZ"] });
  assert.equal(v.ok, false, "a search naming nowhere is a search with a hole in it, not a narrower one");
  assert.match(v.message, /names no country or region/);
});

test("1945 the vocabulary rule runs even when NO product is named", () => {
  // The second half, and independent of ZZ: `if (!spec) return OK` sat BEFORE the unrecognized check, so
  // "every product refuses it" was true of every NAMED product and of nothing else. A request omitting
  // `product` took any string at all, and the doors that resolve the product later never re-asked.
  for (const product of [null, undefined, ""]) {
    const v = checkProductScope({ product, territories: ["QQ", "NOWHERE"] });
    assert.equal(v.ok, false, `product ${JSON.stringify(product)} skipped the territory vocabulary`);
  }
});

test("1945 REGRESSION FLOOR: real places still resolve, and an unnamed product still says nothing else", () => {
  for (const t of ["JP", "Japan", "US", "ZA", "ZW", "XK"]) assert.equal(territoryTier(t), "country", `${t}`);
  assert.equal(territoryTier("EU"), "region");
  assert.equal(territoryTier("WO"), "region");
  assert.equal(checkProductScope({ product: "full-country-search", territories: ["Japan"] }).ok, true);
  // With no product named, a RECOGNIZED territory list must still pass — the early return is narrowed,
  // not removed: everything below it genuinely depends on which search was bought.
  assert.equal(checkProductScope({ product: null, territories: ["JP", "KR", "US"] }).ok, true,
    "three countries is illegal for a Full country search and fine for a product nobody named yet");
});
