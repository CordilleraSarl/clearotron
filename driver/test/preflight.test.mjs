// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doc-27 Item 2: the run-start credential preflight fails fast / fails closed when the active register
// provider's key is absent — so a cold run AND a resume halt before any model spend instead of cascading
// into unverified registry citations discovered only at delivery (the teal-bastion CORSEARCH_SESSION_KEY
// drop). Provider-agnostic: it reads the active adapter's `credEnv`, never a baked-in provider name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightCredentials, activeProvider } from "../driver.config.mjs";

test("preflightCredentials: present credential → returns {provider, credEnv}; absent/blank → throws", () => {
  const { id, credEnv } = activeProvider();
  // a custom env object keeps the global process.env untouched
  // added `checked` — the full list of variables actually tested. It exists because euipo needs
  // TWO (an OAuth id and secret) and `credEnv` alone had silently become a half check, so a caller
  // reading the preflight line must be able to tell a two-credential check from a one-credential one.
  const r = preflightCredentials({ [credEnv]: "a-real-looking-key" });
  assert.equal(r.provider, id);
  assert.equal(r.credEnv, credEnv);
  assert.ok(r.checked.includes(credEnv), "the report must name what it checked");
  assert.throws(() => preflightCredentials({}), new RegExp(`missing ${credEnv}`),
    "absent credential fails closed with an explicit, named error");
  assert.throws(() => preflightCredentials({ [credEnv]: "   " }), /missing/,
    "a blank value also fails closed (whitespace is not a credential)");
});
