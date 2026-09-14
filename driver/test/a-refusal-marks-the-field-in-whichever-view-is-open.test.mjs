// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SERVER REFUSAL MARKS ITS FIELD IN WHICHEVER EDITOR IS ON SCREEN.
//
// The staff page has two editors that write into the same element and therefore replace each other: the
// customer editor, whose inputs are `f_*`, and the project overlay, whose inputs are `p_*`. The
// server-error table names the customer editor's id. On the overlay that id is absent, markField's
// guard returns, and the refusal reaches the panel with no field marked — the reader is told what is
// wrong and not where.
//
// THIS ARM DRIVES BOTH VIEWS, because the defect is invisible in the one that works. An arm that
// exercised only the customer editor passed throughout the period the overlay was broken.
//
// It drives the SHIPPED functions, extracted from the template, rather than a copy of them: a test
// carrying its own transcription of markField would keep passing after the page stopped agreeing with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../profile-page.html", import.meta.url)), "utf8");

/** The page's OWN onScreenField, over a document holding exactly `present`. */
function resolver(present) {
  const m = src.match(/function onScreenField\(id\) \{[\s\S]*?\n\}/);
  assert.ok(m, "could not find onScreenField in the shipped template — the arm cannot look");
  const $ = (id) => (present.includes(id) ? { id } : null);
  return new Function("$", `${m[0]}\nreturn onScreenField;`)($);
}

// The ids the two editors actually render, read off the template rather than typed here — a hand-copied
// list stops matching the page and the arm goes on passing.
const idsWithPrefix = (p) => [...new Set(
  [...src.matchAll(new RegExp(`"(${p}_[a-z]+)"`, "g"))].map((m) => m[1]))].sort();

test("a concept the overlay also renders resolves to the overlay's input when that is the open view", () => {
  const onCustomerEditor = resolver(["f_juris"]);
  const onProjectOverlay = resolver(["p_juris"]);

  assert.equal(onCustomerEditor("f_juris"), "f_juris", "the customer editor marks its own field");
  assert.equal(onProjectOverlay("f_juris"), "p_juris", "and the overlay marks the one it renders");

  // THE TWO MUST DIFFER, or this arm is asserting one thing twice. Both calls pass the SAME id; only
  // the document differs, which is the whole property.
  assert.notEqual(onCustomerEditor("f_juris"), onProjectOverlay("f_juris"));
});

test("it never crosses views: a rendered field is never passed over for the other editor's", () => {
  // If the alternate were consulted first, or unconditionally, the customer editor would mark the
  // overlay's input whenever both names existed — a defect with no symptom on either view alone.
  const bothPresent = resolver(["f_juris", "p_juris"]);
  assert.equal(bothPresent("f_juris"), "f_juris", "the named id wins whenever it is actually there");
  assert.equal(bothPresent("p_juris"), "p_juris", "and an overlay id is never rewritten backwards");
});

test("a concept with no counterpart resolves to nothing, exactly as before", () => {
  // Three of the customer editor's concepts are not on the overlay at all, because a project cannot
  // change them. They must keep the old behaviour — markField's own guard drops them — rather than
  // resolve to some other field and mark the wrong input.
  const onProjectOverlay = resolver(["p_juris", "p_name"]);
  for (const id of ["f_excl", "f_match", "f_product"])
    assert.equal(onProjectOverlay(id), id, `${id} has no overlay counterpart and must not be redirected`);
});

test("every concept the overlay renders is reachable from the customer editor's id — the population, not one member", () => {
  // THE FLOOR. The arms above drive one concept; this one asserts the mapping holds across every
  // concept both editors share, so a field renamed on one side only is caught here rather than by a
  // reader meeting an unmarked refusal.
  const f = idsWithPrefix("f");
  const p = idsWithPrefix("p");
  assert.ok(f.length >= 10 && p.length >= 10, `the template rendered too few inputs to be measuring anything: ${f.length}/${p.length}`);

  const shared = f.filter((id) => p.includes(id.replace(/^f_/, "p_")));
  assert.ok(shared.length >= 9, `expected the two editors to share most concepts, found ${shared.length}`);
  for (const id of shared) {
    const onOverlay = resolver(p);
    assert.equal(onOverlay(id), id.replace(/^f_/, "p_"), `${id} must reach the overlay's input`);
  }
});
