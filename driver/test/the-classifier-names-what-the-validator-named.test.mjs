// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-classifier-names-what-the-validator-named.test.mjs — BUILD A.
//
// The issue's title: "the recovery classifier could not name a failure the validator had already
// named, and a default rescued the run by luck". Build A, owner-ruled 2026-08-19, closes the FIRST
// half only — the naming. `classSource` becomes `validator-token` where the reason carries an
// allowlisted validator token, so the record says where the classification came from instead of
// reporting a guess and a gap.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO, AND WHY THE ARMS BELOW PROVE IT ──────────────────────────
//
// The issue's own 2026-08-13 correction WITHDREW the rule its body proposed. R6 showed a flat
// 74 → 74 on a stage that was about to succeed, and a ceiling read off that trend would have killed
// the run at 2/9. So no budget, no lane, no ceiling and no class value moves here, and that is not
// caution — `decideRecovery` sends any class outside transient|stale|unknown to ZERO parks, so
// minting a "structured" class would be the refuted rule arriving by the back door as a silent
// terminal. The budget arms below are the ones that keep this honest.
//
// ── THE SHAPE THIS FILE EXISTS TO AVOID ──────────────────────────────────────────────────────────
//
// `unnamedStructuredFailure` was already exported, pure and tested 9 ways when the classifier had
// never named anything — because the derivation lived inline at the call site and no test drove it.
// A component test cannot see an unwired component. So `classificationSource` is exported and pure,
// and there is a call-site arm asserting the pipeline reads it rather than restating the precedence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classificationSource, unnamedStructuredFailure, decideRecovery, failureSignature } from "../repairs.mjs";
import { aggregateFailureRecurrence, renderFailureRecurrence } from "../repair-digest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (f) => readFileSync(join(ROOT, "driver", f), "utf8");

// ── THE DERIVATION ────────────────────────────────────────────────────────────────────────────────

test("#849 a validator-named token is classified as `validator-token`, not as a text guess", () => {
  assert.equal(classificationSource({ quantityToken: "connotation_form_damaged" }), "validator-token");
  assert.equal(classificationSource({ quantityToken: null }), "reason-text");
  assert.equal(classificationSource({}), "reason-text", "no argument at all must not invent a name");
});

test("#849 the throw site OUTRANKS the token — it counted the things", () => {
  // A stage that stamped its own class knows more than any read of its prose. If this inverted, a
  // throw-site stamp would start reporting as a text-derived name and the digest's `measured` split
  // would quietly change meaning for every stamped failure.
  assert.equal(classificationSource({ stamped: true, quantityToken: "connotation_form_damaged" }), "throw-site");
  assert.equal(classificationSource({ stamped: true }), "throw-site");
});

test("#849 a `kindToken` is NOT a validator name — the prefix regex must not launder into one", () => {
  // THE LOAD-BEARING SCOPE DECISION. `kindToken` is any leading `word:` prefix, not a vocabulary:
  // `invalid_file:<path>` is 71 of 76 recorded stage failures and no validator named it. Routing it to
  // `validator-token` would silence the gap detector on exactly the shape it was widened to catch —
  // relabelling the failure instead of understanding it, which is this issue's own complaint.
  // Driven from the REAL signature over the REAL dominant reason shape, not from hand-built values:
  // a fixture I invented could agree with my reading of the regex and with nothing that ships.
  const dominant = failureSignature("common-law-half:m", "invalid_file:/tmp/run/report.md");
  assert.equal(dominant.kindToken, "invalid_file", "the dominant failure shape stopped parsing — this arm reads nothing");
  assert.equal(dominant.quantityToken, null, "invalid_file is not in PROGRESS_TOKENS and must not become a validator name");
  assert.equal(classificationSource({ quantityToken: dominant.quantityToken }), "reason-text");
  assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text", kind: dominant.kindToken }), true,
    "a kind-only failure stopped being reportable — the detector has been silenced, not satisfied");

  // …and the contrast, from the shape the issue was filed on: same prefix mechanism, but this token IS
  // in the allowlist, so it gets named and the two cases separate.
  const named = failureSignature("common-law-half:m", "connotation_form_damaged: form_damaged=27;");
  assert.equal(named.quantityToken, "connotation_form_damaged");
  assert.equal(named.kindToken, "connotation_form_damaged", "both fields carry the prefix — the DISCRIMINATOR is the allowlist");
  assert.equal(classificationSource({ quantityToken: named.quantityToken }), "validator-token");
});

test("#849 the gap detector goes quiet for a NAMED token, and only for that reason", () => {
  const named = classificationSource({ quantityToken: "connotation_quote_unbound" });
  assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: named, token: "connotation_quote_unbound" }), false,
    "the validator named it and the classifier now says so — reporting a gap here would be reporting nothing");
  // …and the predicate itself is unchanged: hand it the OLD source and it still fires. This separates
  // "build A routed it" from "the detector broke", which otherwise look identical from a zero.
  assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text", token: "connotation_quote_unbound" }), true);
});

// ── THE CALL SITE, WHICH IS WHERE THE LAST ONE OF THESE WENT WRONG ───────────────────────────────

test("#849 the pipeline DERIVES classSource from the helper — one rule, not two copies", () => {
  const p = src("pipeline.mjs");
  assert.match(p, /classSource = classificationSource\(/,
    "the pipeline no longer derives classSource from the shared helper, so the precedence rule now has "
    + "a second copy that can disagree with the tested one");
  assert.match(p, /import \{[^}]*classificationSource[^}]*\} from "\.\/repairs\.mjs"/s,
    "classificationSource is used without being imported, or the import moved");
  // The inline ternary this replaced must not come back beside it.
  const site = p.slice(p.indexOf("classSource = classificationSource("), p.indexOf("classSource = classificationSource(") + 400);
  assert.doesNotMatch(site, /\?\s*"validator-token"/,
    "the call site restates the rule it just delegated");
});

test("#849 the strike relabel STILL outranks everything — the caller's deliberate override survives", () => {
  // `invalid-artifact-loop` is a terminal diagnosis reached from the run's own spine, and it is applied
  // after this. If build A had been written to win there, three consecutive invalid artifacts would
  // start reporting as a validator-named failure and the terminal would lose its name.
  const p = src("pipeline.mjs");
  const helperAt = p.indexOf("classSource = classificationSource(");
  const strikeAt = p.indexOf('classSource = "invalid-artifact-strikes"');
  assert.ok(helperAt > 0 && strikeAt > 0, "one of the two assignment sites is gone — this arm is reading nothing");
  assert.ok(strikeAt > helperAt,
    "the strike relabel no longer runs after the derivation, so it can no longer override it");
});

test("#849 the park row carries the KIND token too, or the digest half of the detector is blind", () => {
  // The digest never opens run.jsonl; the recoveryHistory park row is its only carrier. Before this it
  // carried `quantityToken` alone, so the digest could only ever ask half the question — harmless while
  // every structured reason was `reason-text`, and fatal once a token implies NOT-a-gap.
  assert.match(src("pipeline.mjs"), /kindToken: failSig\.kindToken \?\? null/,
    "the archived park row dropped kindToken, so a kind-only gap can never be reported downstream");
  assert.match(src("repair-digest.mjs"), /unnamedStructuredFailure\(\{[^}]*kind: row\.kindToken/,
    "the digest still decides the gap question without the kind half the pipeline passes");
});

// ── THE BUDGET DID NOT MOVE, AND THAT IS ASSERTED RATHER THAN ASSUMED ────────────────────────────

test("#849 `decideRecovery` cannot see classSource at all — the budget is unreachable from this change", () => {
  // Structural, not behavioural, on purpose: a behavioural arm proves the budget did not move for the
  // inputs it happened to try. This proves there is no branch to move.
  const sig = /export function decideRecovery\(\{([^}]*)\}/.exec(src("repairs.mjs"));
  assert.ok(sig, "decideRecovery's destructured signature no longer parses — this arm is reading nothing");
  assert.doesNotMatch(sig[1], /classSource/,
    "decideRecovery now accepts classSource, so build A can reach a budget decision — the branch the "
    + "2026-08-13 correction refuted");
});

test("#849 an `unknown` park still gets exactly ONE park, before and after naming it", () => {
  // The number the issue's rescue-by-luck depended on. Both runs in the evidence recovered on exactly
  // this park, which is why the ruling left it alone.
  const d = decideRecovery({ failClass: "unknown", sig: "s|1", reason: "connotation_form_damaged = 27", history: [], priorAttempts: 0, recoveryMax: 3 });
  assert.equal(d.parkBudget, 1, "the catch-all lane's single park moved — build A was supposed to change no budget");
  assert.equal(d.recoverable, true);
});

test("#849 the failure this was filed on still signs and counts identically — `sig` is untouched", () => {
  // The signature keys the per-signature ladder. If naming the source had perturbed it, every archived
  // park row would stop joining to its live successor and the ladder would silently re-arm.
  // The census shape the validator actually emits: `<token>: <field>=<n>;`. Written out rather than
  // paraphrased because the first version of this arm used `token = 27` and parsed to NOTHING — the
  // fixture agreed with my reading of the code and not with the code, and every assertion under it
  // would have been vacuous while reading green.
  const R = "connotation_form_damaged: form_damaged=27;";
  const a = failureSignature("common-law-half:m", R);
  assert.equal(a.quantityToken, "connotation_form_damaged");
  assert.equal(a.quantity, 27, "the count the ladder compares across attempts");
  assert.equal(a.sig, failureSignature("common-law-half:m", R).sig);
  assert.equal(a.sig.split("|")[0], "common-law-half:m", "the signature still keys on the bare stage");
});

// ── THE DIGEST, DRIVEN RATHER THAN SCANNED ───────────────────────────────────────────────────────

const IN_WINDOW = "2026-08-12T10:00:00.000Z";
const NOW = Date.parse("2026-08-13T10:00:00.000Z");
// Synthetic codename, outside the generator's vocabulary — no-client-identifiers refuses a real pair.
const run = (rows) => ({ runId: "venzy-2026-08-12-linen-spindle", state: "delivered", runDir: null,
  status: { state: "delivered", updatedAt: IN_WINDOW, recoveryHistory: rows } });
const PARK = (extra) => ({ sig: "common-law-half:m|80aa500874e6", stage: "common-law-half:m",
  class: "unknown", lane: "defect", attempt: 1, quantity: 1, ts: IN_WINDOW, ...extra });

test("#849 a KIND-ONLY park is still counted and NAMED by the digest after build A", () => {
  // The arm that proves the digest's gap line can still fire. Post-A this is the shape that reaches it:
  // no validator token, a kind prefix, classSource still `reason-text`.
  const agg = aggregateFailureRecurrence({
    enumerate: () => [run([PARK({ classSource: "reason-text", quantityToken: null, kindToken: "invalid_file" })])],
    now: NOW, days: 7,
  });
  assert.equal(agg.classifierGaps.count, 1, "a kind-only gap is invisible to the digest — the line cannot fire");
  assert.equal(agg.classifierGaps.unmeasured, 0);
  assert.deepEqual(agg.classifierGaps.tokens, ["invalid_file"],
    "the gap fired and named nothing, which is the defect this instrument exists to report, inside the instrument");
  assert.match(renderFailureRecurrence(agg), /invalid_file/);
});

test("#849 a park the validator NAMED is measured and clean — not a gap, not unmeasured", () => {
  const agg = aggregateFailureRecurrence({
    enumerate: () => [run([PARK({ classSource: "validator-token", quantityToken: "connotation_quote_unbound" })])],
    now: NOW, days: 7,
  });
  assert.equal(agg.classifierGaps.count, 0, "a named failure was still reported as one the classifier could not name");
  assert.equal(agg.classifierGaps.unmeasured, 0, "it WAS measured — build A is the measurement");
  assert.doesNotMatch(renderFailureRecurrence(agg), /classifier gap/);
});

test("#849 ARCHIVED rows keep their old verdict — a pre-A park is read as the gap it was", () => {
  // Rows written before build A carry `reason-text` WITH a quantity token, a combination the pipeline
  // can no longer produce. They must still report as gaps: that is what they were, and re-reading
  // history through the new rule would erase the evidence this issue was filed on.
  const agg = aggregateFailureRecurrence({
    enumerate: () => [run([PARK({ classSource: "reason-text", quantityToken: "connotation_quote_unbound" })])],
    now: NOW, days: 7,
  });
  assert.equal(agg.classifierGaps.count, 1);
  assert.deepEqual(agg.classifierGaps.tokens, ["connotation_quote_unbound"]);
  // …and a row predating the fields entirely is still NOT MEASURED, never a clean.
  const old = aggregateFailureRecurrence({ enumerate: () => [run([PARK({})])], now: NOW, days: 7 });
  assert.equal(old.classifierGaps.count, 0);
  assert.equal(old.classifierGaps.unmeasured, 1, "an absent verdict was read as a measured zero");
});
