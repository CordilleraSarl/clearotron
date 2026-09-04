// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The close-variation form generator (driver/register-variants.mjs).
//
// This is the input to a number a client reads, so what these tests guard is not string manipulation
// but the three properties that make the number trustworthy: the set is DETERMINISTIC (same name, same
// forms, forever — a set that varies between runs is a figure that varies between runs), it is BOUNDED
// (every form is a provider call, billable on Corsearch), and every form is ONE named rule from the
// mark, so the report's list of forms is an explanation and not a list of guesses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { variantForms, VARIANT_RULES, VARIANT_CAP } from "../register-variants.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── the fixed input → expected set (the acceptance criterion, spelled out) ───────────────────────────

test("a fixed name produces an exact, ordered, deterministic form set", () => {
  const got = variantForms("ALCHEMIST");
  assert.deepEqual(got.forms.map((f) => f.form), [
    "ALCHEMMIST",   // single-to-doubled
    "ALKEMIST",     // ch-to-k     ← the near-miss counsel named
    "ALKHEMIST",    // c-to-k
    "ALCHEMIZT",    // s-to-z
    "ALCHEMYST",    // i-to-y
    "ALCHAMIST",    // first e-to-a
    "ELCHEMIST",    // first a-to-e
  ]);
  assert.equal(got.base, "ALCHEMIST");
  assert.equal(got.generated, 7);
  assert.equal(got.truncated, false);

  // Deterministic across calls: byte-identical, including order. The order is not cosmetic — it is the
  // survival order under the cap, so a set that reorders is a set that truncates differently.
  assert.deepEqual(JSON.parse(JSON.stringify(variantForms("ALCHEMIST"))), JSON.parse(JSON.stringify(got)));
});

test("every form carries the rule that produced it, and every rule id is one this build declares", () => {
  const known = new Set(VARIANT_RULES.map((r) => r.id));
  for (const name of ["ALCHEMIST", "SUMMIT", "BLUE-SKY", "VENQORI", "BRIMSTONE"]) {
    for (const f of variantForms(name).forms) {
      assert.ok(f.rules.length, `${name}/${f.form}: a form with no rule behind it is a guess`);
      for (const id of f.rules) assert.ok(known.has(id), `${name}/${f.form}: unknown rule "${id}"`);
    }
  }
});

test("a form two rules reach is asked ONCE, and records both rules", () => {
  // Two rules landing on one form is rare on a real mark and it is not impossible, so the behaviour is
  // pinned rather than left to chance. Asking the register twice for one term would double-bill it; and
  // the audit question is "why was this form asked", whose answer is every rule that reached it.
  // "CCK" is synthetic — a search over three-letter names found it as the shortest collision there is
  // (doubled-to-single and ck-to-k both yield CK).
  const forms = variantForms("CCK").forms;
  assert.equal(new Set(forms.map((f) => f.form)).size, forms.length, "deduped");
  const ck = forms.find((f) => f.form === "CK");
  assert.deepEqual(ck.rules, ["doubled-to-single", "ck-to-k"], "both routes recorded, in declaration order");

  // Uniqueness holds over ordinary names too — that is the property the billing depends on.
  for (const name of ["ALCHEMIST", "SUMMIT", "BLUE-SKY", "PHYSICALIZE", "ACCLAIM"]) {
    const f = variantForms(name).forms.map((v) => v.form);
    assert.equal(new Set(f).size, f.length, `${name}: one term, one call`);
  }
});

// ── the bound ───────────────────────────────────────────────────────────────────────────────────────

test("the set is capped, the truncation is declared, and the cap cannot be raised by a caller", () => {
  const long = variantForms("PHYSICALIZE");
  assert.ok(long.generated > 0);
  assert.ok(long.forms.length <= VARIANT_CAP, "never more than the cap, whatever the name");

  const tight = variantForms("PHYSICALIZE", { cap: 3 });
  assert.equal(tight.forms.length, 3);
  assert.equal(tight.truncated, true, "a truncated set says so — the reader cannot otherwise tell");
  assert.deepEqual(tight.forms.map((f) => f.form), long.forms.slice(0, 3).map((f) => f.form),
    "truncation takes the head of the rule order, deterministically");

  // A typo'd env var must not turn a bounded fan-out into an unbounded bill. Every unusable cap
  // collapses to NO forms — the safe direction, since each form is a paid call.
  for (const bad of [0, -1, NaN, "twelve", null])
    assert.equal(variantForms("ALCHEMIST", { cap: bad }).forms.length, 0,
      `cap ${String(bad)} must not produce an unbounded set`);
  // …and an omitted cap is the code default, not "no limit".
  assert.equal(variantForms("ALCHEMIST", {}).forms.length, 7);
});

// ── what is never in the set ────────────────────────────────────────────────────────────────────────

test("the mark itself is never a variation of itself", () => {
  for (const name of ["ALCHEMIST", "SUMMIT", "ARBORA", "77", "X", "  spaced  "]) {
    const v = variantForms(name);
    assert.ok(!v.forms.some((f) => f.form === v.base), `${name}: the base is the identical predicate, already counted`);
  }
});

test("a name with no near-form returns an EMPTY set, never a placeholder", () => {
  // The caller must be able to tell "nothing to count" from "counted nothing" — an empty list is what
  // makes that distinction possible, and register-count.mjs turns it into a null with a reason.
  const v = variantForms("77");
  assert.deepEqual(v.forms, []);
  assert.equal(v.generated, 0);
  assert.equal(v.truncated, false);
});

test("an absent or blank name is an empty set, not a throw and not a form", () => {
  for (const bad of [null, undefined, "", "   "]) {
    const v = variantForms(bad);
    assert.deepEqual(v.forms, []);
    assert.equal(v.base, "");
  }
});

// ── the lane's rule 1, made mechanical ──────────────────────────────────────────────────────────────

test("NO MODEL IS REACHABLE FROM THE COUNT LANE — the imports say so", () => {
  // Rule 1 of register-count.mjs is that no model touches a number, and the variant generator sits one
  // step upstream of one: the forms decide the figure. This is the grep that proves it, kept as a test
  // so it runs on every change rather than on the day someone remembers to run it.
  const BANNED = /(engine\/|gateway\.mjs|anthropic|openai|stages\.mjs|compose-read)/;
  for (const file of ["register-variants.mjs", "register-count.mjs"]) {
    const src = readFileSync(join(HERE, "..", file), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]+from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of imports)
      assert.doesNotMatch(spec, BANNED, `${file} imports "${spec}" — the count lane must reach no model`);
  }
  // register-variants.mjs imports NOTHING at all, which is the strongest form of the same guarantee.
  const gen = readFileSync(join(HERE, "..", "register-variants.mjs"), "utf8");
  assert.equal([...gen.matchAll(/^\s*import\s/gm)].length, 0, "the generator has no dependencies to drift");
});
