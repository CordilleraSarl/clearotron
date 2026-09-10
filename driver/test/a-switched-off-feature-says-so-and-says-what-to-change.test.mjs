// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A CONFIGURED-OFF FEATURE ANSWERS WITH ITS REASON, AND THE REASON IS STAFF-ONLY.
//
// Found by the owner on the test box. Custom searches answered 404 — deliberately, permanently, and for
// a cause the portal had already written into its own boot log — and the screen said "try again
// shortly". Advice that can never work, on a state nobody could learn about from that screen.
//
// The route answered a bare `not_found`, which is indistinguishable from a page that does not exist. It
// carries the code and the operator sentence now.
//
// THE DETAIL IS WITHHELD FROM A CLIENT, and that is the half worth a test: the sentence names
// environment variables and filesystem paths on the server, and this screen is company-scoped, so a
// client reaches it. The CODE goes to everyone — "this installation does not have saved searches" is
// true and useful and gives nothing away.

import test from "node:test";
import assert from "node:assert/strict";
import { makeUpstream } from "../portal-upstream.mjs";

const OFF = { code: "store_outside_repo", detail: "CLEAROTRON_RECIPES_DIR is outside RECIPE_REPO_ROOT — point it at the repository that contains the store." };
const up = (recipesOff) => makeUpstream({ callUpstream: async () => ({ status: 200, json: {} }), callRecipes: null, recipesOff });

test("a switched-off feature names itself rather than answering a bare not-found", async () => {
  const r = await up(OFF).listSearches({ role: "staff", email: "s@x", accounts: ["acme"] }, "acme");
  assert.equal(r.status, 404, "the route must still answer 404 — the page genuinely is not there");
  assert.equal(r.json.error, "store_outside_repo",
    "the refusal is a bare not_found again, which is what let the screen call a permanent state transient");
});

test("staff get the sentence saying what to change", async () => {
  const r = await up(OFF).listSearches({ role: "staff", email: "s@x", accounts: ["acme"] }, "acme");
  assert.equal(r.json.detail, OFF.detail, "the operator sentence is gone, so the screen cannot say what is wrong");
});

test("a client gets the code and NOT the sentence", async () => {
  // The leak direction. This is the same rule the stop control's reason follows, and the reason it
  // exists: the detail names server paths and variables.
  const r = await up(OFF).listSearches({ role: "client", email: "c@x", accounts: ["acme"] }, "acme");
  assert.equal(r.json.error, "store_outside_repo", "a client should still learn the feature is off");
  assert.equal(r.json.detail, undefined,
    "a client was handed the server's configuration detail — it names environment variables and paths");
});

test("with no reason recorded it is an ordinary not-found, not a half-named one", async () => {
  // The absence direction: a deployment that never set the field must not produce a refusal naming a
  // code no screen knows, and must not carry an undefined detail.
  const r = await up(null).listSearches({ role: "staff", email: "s@x", accounts: ["acme"] }, "acme");
  assert.equal(r.json.error, "not_found");
  assert.equal(r.json.detail, undefined);
});
