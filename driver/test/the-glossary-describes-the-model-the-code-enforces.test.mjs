// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F45 — THREE WORDS, NO GLOSSARY, AND THE CUSTOMER'S WORD DOES NOT EXIST ──
//
// `grants.json` says TENANT. The CLI verb is BRANDOWNER. The portal and `grant`'s own output say
// ACCOUNT. Nothing said what contains what. The owner, who commissioned the product: "don't we create
// an org first or what. Confused… does that make it easier to categorize for users, because I'm still
// confusing and I built the thing." There is no "org" in the product at all.
//
// The glossary states the containment so a reader can act today. Aligning the three surfaces onto ONE
// customer-facing word is a product decision nobody has taken, and the glossary says so rather than
// quietly picking one.
//
// WHAT THIS ARM IS FOR, AND WHAT IT CANNOT DO. Prose cannot be checked for being helpful. What CAN be
// checked is that it still describes the model the code enforces — a glossary that drifts from the
// shape `assertGrantsShape` refuses is worse than none, because a reader would follow it into a file
// the product rejects. So the arms bind the words to the validator, not to a copy of the sentence.
//
// BREAK MATRIX:
//   · the glossary exists in the install document   → break: delete it, arm 1 red
//   · it names every level the model has            → break: drop one, arm 1 red
//   · the containment it states is the enforced one → break: change the model, arm 2 red
//   · the unaligned words are disclosed, not hidden → break: quietly pick one, arm 3 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertGrantsShape } from "../../shared/scope.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const INSTALL = readFileSync(join(ROOT, "INSTALL.md"), "utf8");

test("the install document defines every level of the model", () => {
  assert.match(INSTALL, /### The four things, and what contains what/, "the glossary is gone");
  for (const word of ["tenant", "account", "project", "user"])
    assert.match(INSTALL, new RegExp(`\\*\\*${word}`, "i"), `the glossary does not name "${word}"`);
  assert.match(INSTALL, /a tenant contains accounts; an account contains projects/i,
    "the containment sentence is gone — the table alone leaves the nesting to be inferred");
  // The two things that surprised the owner are the two a reader cannot deduce from the table.
  assert.match(INSTALL, /does not span tenants/i, "the glossary no longer says an account is per-tenant");
  assert.match(INSTALL, /Enrol first, issue second/i,
    "the glossary no longer says a key grants no reach of its own — the order that made a real account refuse every clearance");
});

test("the containment the glossary states is the one the validator enforces", () => {
  // A GRANTS FILE SHAPED THE WAY THE GLOSSARY DESCRIBES MUST PASS. If the model ever changes under the
  // prose, this fails here rather than in a reader's hands.
  const asDescribed = { tenants: { acme: { accounts: ["acmelaw"], users: { "lawyer@acme.example": ["acmelaw"] } } } };
  assert.doesNotThrow(() => assertGrantsShape(asDescribed, "glossary"),
    "the shape the glossary tells a reader to write is refused by the product");
  // And the two legal spellings of a whole-tenant grant, both of which the glossary's wording covers.
  assert.doesNotThrow(() => assertGrantsShape({ tenants: { acme: { accounts: "*", users: { "*@acme.example": "*" } } } }, "glossary"));
  // A user mapped to something that is neither "*" nor a list of account keys is refused — which is
  // what makes "reaches a named subset of that tenant's accounts" a real statement rather than a hope.
  assert.throws(() => assertGrantsShape({ tenants: { acme: { users: { "lawyer@acme.example": { all: true } } } } }, "glossary"));
});

test("the unaligned words are disclosed rather than quietly resolved", () => {
  assert.match(INSTALL, /not yet aligned across the surfaces/i,
    "the glossary stopped disclosing that the file, the CLI and the UI use different words");
  assert.match(INSTALL, /product decision that has not been taken/i,
    "the glossary reads as though the naming were settled — it is the owner's call and it is open");
});
