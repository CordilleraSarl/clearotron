// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F45, AND THE WORDS THE ACCESS MODEL SETTLED ──
//
// `grants.json` said TENANT, the CLI verb said BRANDOWNER, the portal said ACCOUNT, and nothing said what
// contained what. The owner, who commissioned the product: "don't we create an org first or what." The
// access model settled it: the product's words are organisation, company, project and person, and the
// file, the wire and the command line keep `tenant` and `account`, because moving them would break every
// file and script written against them. So the glossary names both, side by side.
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
//   · the file's words sit beside the product's    → break: drop the mapping, arm 3 red
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
  for (const word of ["organisation", "company", "project", "person"])
    assert.match(INSTALL, new RegExp(`\\*\\*${word}`, "i"), `the glossary does not name "${word}"`);
  assert.match(INSTALL, /an organisation contains companies; a company contains projects/i,
    "the containment sentence is gone — the table alone leaves the nesting to be inferred");
  // The things a reader cannot deduce from the table.
  assert.match(INSTALL, /belongs to exactly one organisation/i, "the glossary no longer says a company sits in one organisation");
  assert.match(INSTALL, /two switches/i, "the glossary no longer says what a person may do is two switches");
  assert.match(INSTALL, /Enrol first, issue second/i,
    "the glossary no longer says a key grants no reach of its own — the order that made a real account refuse every clearance");
});

test("the containment the glossary states is the one the validator enforces", () => {
  // A GRANTS FILE SHAPED THE WAY THE GLOSSARY DESCRIBES MUST PASS. If the model ever changes under the
  // prose, this fails here rather than in a reader's hands.
  const asDescribed = { tenants: { acme: { accounts: ["acmelaw"], users: { "lawyer@acme.example": ["acmelaw"] } } } };
  assert.doesNotThrow(() => assertGrantsShape(asDescribed, "glossary"),
    "the shape the glossary tells a reader to write is refused by the product");
  // A whole-organisation grant is the user's "*", never the organisation's: an organisation lists the
  // companies it holds, and a company belongs to exactly one of them.
  assert.doesNotThrow(() => assertGrantsShape({ tenants: { acme: { accounts: ["acmelaw"], users: { "*@acme.example": "*" } } } }, "glossary"));
  assert.throws(() => assertGrantsShape({ tenants: { acme: { accounts: "*" } } }, "glossary"), /exactly one organisation/);
  assert.throws(() => assertGrantsShape({ tenants: { a: { accounts: ["acmelaw"] }, b: { accounts: ["acmelaw"] } } }, "glossary"),
    /listed under both/);
  // A user mapped to something that is neither "*" nor a list of account keys is refused — which is
  // what makes "reaches a named subset of that tenant's accounts" a real statement rather than a hope.
  assert.throws(() => assertGrantsShape({ tenants: { acme: { users: { "lawyer@acme.example": { all: true } } } } }, "glossary"));
});

test("the file's words are named beside the product's, so a reader can get from one to the other", () => {
  assert.match(INSTALL, /\*\*organisation\*\* \(`tenant` in `grants\.json`\)/i,
    "the glossary no longer says which word in the file an organisation is");
  assert.match(INSTALL, /\*\*company\*\* \(`account` in `grants\.json`/i,
    "the glossary no longer says which word in the file a company is");
  assert.match(INSTALL, /keep `tenant` and `account`/i,
    "the glossary no longer says the file keeps its words — a reader would look for `organisation` in grants.json and not find it");
});
