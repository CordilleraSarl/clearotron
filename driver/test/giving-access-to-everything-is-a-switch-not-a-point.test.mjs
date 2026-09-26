// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// "Everything on this Clearotron" — the row the add form draws only to somebody who holds it.
//
// It had never worked. The form sends it as `{kind:"everything"}` beside the organisation and company
// points; the route matched only those two kinds, so it fell to the 404 they share and the page rendered
// the refusal it keeps for a point outside the adder's reach — "You can only give access to what you
// have access to yourself. Nothing was saved." — to the one person on the install for whom that sentence
// is false. Nothing tested this route at all, and reading it does not catch it either: both branches are
// correct about their own subject and neither mentions the third kind.
//
// Access to everything is a SWITCH on the person's entry under `people` and not a point in any
// organisation, which is why it needed its own branch rather than a wider match.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makePortalService } from "../portal-service.mjs";

const FILE = () => ({
  tenants: {
    anthropic: { name: "Anthropic", accounts: ["anthropic-eu"], users: { "priya@anthropic.example": "*" } },
    cordillera: { name: "Cordillera", accounts: ["mailagent"], users: {} },
  },
  people: {
    "priya@anthropic.example": { run: true, manage: true },
    "krzys@cordillera.example": { run: true, manage: true, everything: true },
  },
});
const KRZYS = { email: "krzys@cordillera.example" };
const PRIYA = { email: "priya@anthropic.example" };

const on = () => {
  const state = { grants: FILE(), writes: 0 };
  const svc = makePortalService({
    poolRoot: "/nonexistent", workspaceRoot: "/nonexistent", secret: "s",
    grants: () => state.grants, writeGrants: async (g) => { state.grants = g; state.writes++; },
  });
  return { state, add: (who, body) => svc.route("POST", "/portal/admin/people", who, body) };
};

test('the form’s "Everything on this Clearotron" grants it, where it used to answer 404', async () => {
  const { state, add } = on();
  const r = await add(KRZYS,
    { email: "new@cordillera.example", permissions: { run: true, manage: true }, access: [{ kind: "everything" }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(state.grants.people["new@cordillera.example"].everything, true,
    "the route answered 201 and wrote no access to everything");
  assert.deepEqual(r.json.person.access, [{ kind: "everything" }]);
  // AND ONLY FOR SOMEBODY WHO HOLDS IT. The form draws the row to nobody else; the route refuses it
  // anyway, because the form is not the gate.
  const no = await add(PRIYA,
    { email: "other@anthropic.example", permissions: { run: true, manage: false }, access: [{ kind: "everything" }] });
  assert.equal(no.status, 404);
});
