// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the gate token's three free properties, and they are free ONLY while the name is right.
//
// `findings_net_chained` (findings-model.mjs validateNetShape) is minted with ZERO edits to gateway.mjs
// or pipeline.mjs. That is not a coincidence and it is not robust: three separate shipped regexes decide
// what happens to a failure token, all three key on the token's SPELLING, and each fails SILENTLY in a
// different direction if the spelling drifts:
//
//   1. WARM_ELIGIBLE_RE (gateway.mjs) admits `findings?_[a-z_]+`. A leading digit, a hyphen or an
//      uppercase letter after the prefix and the token is not admitted — the failure goes COLD instead of
//      warm, so the model loses its own session and re-reasons the whole synthesis from nothing. Nothing
//      reports that as a defect; the run just costs more and answers differently.
//   2. repairSiblingName (gateway.mjs) tests `coverage_*` BEFORE `findings?_`. A token carrying
//      `coverage_key` (etc.) as a SUBSTRING routes its repair turn at register-coverage-ledger.json — and
//      the message then forbids rewriting findings.json, the only file that could fix it. The ladder
//      cannot converge, and the reason is invisible in the failure text.
//   3. The A3 predicate (pipeline.mjs quarantineSynth) enrols the SINGULAR `finding_` family in
//      per-finding salvage and excludes the plural. A run-level or lenient-exempt token minted singular
//      is handed to machinery whose re-emit is driven by parseFindingsJsonLenient's quarantined[] — which
//      is EMPTY for this rule, because the lenient path exempts it. The lane runs, finds nothing to name,
//      and falls through to a terminal failure carrying the raw token, after the whole ladder has burned.
//
// So the properties are asserted BY NAME against the shipped predicates. Two of the three are module-
// private, so those are read out of the source and applied — the test tracks the code that ships rather
// than a copy of it that can drift. If a regex here stops being found, that is a failure, not a skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { warmEligible, repairTarget, correctionHint } from "../gateway.mjs";

// The token exactly as validateNetShape throws it, and the wire shape gateway.mjs:525 mints it into:
// `invalid_file:<relative path>:<validator reason>`. Anything reaching the ladder any other way — a
// bespoke StageFailure, a top-level `fail` that is not a validator reason — matches none of the three.
const TOKEN = "findings_net_chained";
const WIRE = `invalid_file:findings.json:${TOKEN}:3`;

const GATEWAY_SRC = readFileSync(new URL("../gateway.mjs", import.meta.url), "utf8");
const PIPELINE_SRC = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");

/** Pull a literal regex out of shipped source by an anchoring prefix, so the test applies the real one. */
function literalRegex(src, anchor, label) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${label}: anchor "${anchor}" is gone from the source — this guard needs updating with it`);
  const line = src.slice(at, src.indexOf("\n", at));
  const m = line.match(/\/(.+)\/([gimsuy]*)(?=[;.\s)])/);
  assert.ok(m, `${label}: no literal regex on that line`);
  return new RegExp(m[1], m[2]);
}

test("#469 gate token — the throw in findings-model.mjs is the one this file pins", () => {
  const model = readFileSync(new URL("../findings-model.mjs", import.meta.url), "utf8");
  assert.match(model, new RegExp(`throw new Error\\(\`${TOKEN}:\\$\\{ord\\}`),
    "the token leads its throw message, so gateway.mjs's correctionHint / WARM_ELIGIBLE_RE can key on it");
});

test("#469 gate token — property 1: WARM_ELIGIBLE_RE admits it, so the repair stays on the model's own session", () => {
  assert.equal(warmEligible(WIRE, { status: "ok" }), true, "admitted — the corrective turn warm-resumes the synthesis session");
  // …and the three spellings that would silently go cold instead. Each is a real way to write this name.
  for (const bad of [
    "invalid_file:findings.json:findings_469_chained",   // leading digit: [a-z_]+ must match >= 1 char
    "invalid_file:findings.json:findings-net-chained",   // hyphen: the literal `_` after `findings?` is required
    "invalid_file:findings.json:findings_NET_CHAINED",   // uppercase: not in [a-z_]
  ]) assert.equal(warmEligible(bad, { status: "ok" }), false, `${bad} would go COLD — a lost session, reported as nothing`);
});

test("#469 gate token — property 2: the repair turn is aimed at findings.json, not the coverage ledger", () => {
  assert.equal(repairTarget(WIRE, "/run/narrative.md"), "/run/findings.json",
    "the `/findings?_/` branch is a bare family-prefix test — it routes with no gateway edit");
  // The collision this name exists to avoid: `coverage_*` is tested FIRST in the same ternary, so a
  // plausible alternative spelling would send the model to rewrite the wrong file entirely.
  assert.equal(repairTarget("invalid_file:findings.json:findings_net_coverage_key_chained", "/run/narrative.md"),
    "/run/register-coverage-ledger.json",
    "demonstrated, not assumed: a coverage_* substring wins the ternary and the repair is aimed at a file that cannot fix this");
  const coverageFirst = literalRegex(GATEWAY_SRC, "return /coverage_(ledger|axis|key|mirror|status_invalid)/", "repairSiblingName coverage arm");
  for (const forbidden of ["coverage_ledger", "coverage_axis", "coverage_key", "coverage_mirror", "coverage_status_invalid"])
    assert.ok(!TOKEN.includes(forbidden), `the token must not contain "${forbidden}" as a substring`);
  assert.equal(coverageFirst.test(TOKEN), false, "…checked against the shipped regex itself, not the list above");
});

test("#469 gate token — property 3: PLURAL, so the A3 per-finding salvage lane never claims it", () => {
  const a3 = PIPELINE_SRC.slice(PIPELINE_SRC.indexOf("const eligible = /^invalid_file:/"));
  assert.ok(a3.startsWith("const eligible ="), "the A3 predicate is gone from pipeline.mjs — this guard needs updating with it");
  const eligible = (fail) => /^invalid_file:/.test(fail) && /:finding_[a-z]/.test(fail) && !/:findings_/.test(fail);
  assert.match(a3.slice(0, 120), /\/:finding_\[a-z\]\/\.test\(fail\) && !\/:findings_\/\.test\(fail\)/,
    "the predicate applied below is the one pipeline.mjs ships");
  assert.equal(eligible(WIRE), false, "excluded by the `!/:findings_/` clause — the normal corrective ladder handles it");
  assert.equal(eligible("invalid_file:findings.json:finding_net_chained:3"), true,
    "the SINGULAR spelling is claimed by A3 — whose re-emit reads parseFindingsJsonLenient's quarantined[], which this rule leaves empty by design");
  // The singular family is right for the tokens that ARE per-object shape defects and DO quarantine.
  assert.equal(eligible("invalid_file:findings.json:finding_net_missing:3"), true,
    "…which is why finding_net_missing keeps its singular name: the lenient path drops those objects, so there is something to salvage");
});

test("#469 gate token — the repair message is the GENERIC findings.json recital, and that is accepted", () => {
  // Honest correction to "zero gateway edits": ROUTING is free, a token-specific hint is not. The
  // `/findings?_/` branch fires first and unconditionally; with no matching `extra` arm the token falls
  // through to the base text, which recites the findings.json key contract and appends the failed check.
  // Accepted rather than fixed: the throw message itself already names the two markers, the ordinal and
  // where the reasoning goes, and it is carried into the turn verbatim. Adding an arm here would be a
  // gateway edit for wording that is already in the message.
  const hint = String(correctionHint(WIRE));
  assert.match(hint, /findings\.json is a JSON OBJECT/, "the generic recital, as expected");
  assert.match(hint, new RegExp(`The failed check was: .*${TOKEN}`), "…with the token appended, so the turn still learns which check failed");
});
