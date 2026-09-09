// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The portal's permission to start a search is stamped when a search starts, not when the portal booted.
//
// The defect: `bin/start.mjs` mints PORTAL_OPS_TOKEN capped to the roster as it stood at boot, so a
// company created afterwards was offered by the portal and refused by the engine door — the first thing
// a person met after being told to set a company up.
//
// The cap itself is a real second wall and these arms are as much about keeping it as about refreshing
// it: every failure path here must hand back the BOOT token, never an uncapped one.

import test from "node:test";
import assert from "node:assert/strict";
import { opsTokenFor } from "../portal-service.mjs";

const BOOT = "boot-token-capped-at-start";

test("the cap is re-taken against the roster as it stands, so a company created after boot is covered", () => {
  const seen = [];
  const token = opsTokenFor({
    bootToken: BOOT,
    roster: ["generic", "acme"],           // acme did not exist when the portal booted
    mint: (args) => { seen.push(args); return "fresh-token"; },
  });
  assert.equal(token, "fresh-token", "a fresh credential is used, not the one minted at boot");
  assert.equal(seen.length, 1, "one mint per call, not one per account");
  assert.deepEqual(seen[0].accounts, ["generic", "acme"],
    "the fresh credential names the roster as it stands — which is the whole fix");

  // THE WALL SURVIVES THE REFRESH. Re-minting was the easy half; re-minting without quietly widening
  // what the credential may do is the half worth asserting.
  assert.equal(seen[0].scope, "ops");
  assert.equal(seen[0].sub, "portal");
  assert.deepEqual(seen[0].verbs, ["start_run", "stop_run"], "no verb is added on the way through");
  assert.ok(seen[0].ttlSec <= 3600, `a per-call credential is short-lived, got ${seen[0].ttlSec}s`);
});

test("an empty roster hands back the BOOT token, because empty is what the boot mint reads as uncapped", () => {
  // The one case that could turn an unreadable store into a token good for every account: bin/start.mjs
  // mints with `accounts: roster.length ? roster : null`, and null is no cap at all. Re-deriving that
  // rule here would make a store that lists nothing the widest credential the system can issue.
  let minted = false;
  for (const roster of [[], null, undefined, "not-an-array"]) {
    const token = opsTokenFor({ bootToken: BOOT, roster, mint: () => { minted = true; return "wide"; } });
    assert.equal(token, BOOT, `roster ${JSON.stringify(roster)} must fall back, not mint`);
  }
  assert.equal(minted, false, "nothing was minted for any empty-ish roster");
});

test("a mint that throws falls back to the boot token, never to an uncapped one", () => {
  // An unset signing secret is the realistic cause. The failure direction is the point: a stale cap
  // refuses the newest company, which is the bug being fixed; a widened cap admits every company, which
  // is a larger and quieter one.
  const token = opsTokenFor({
    bootToken: BOOT,
    roster: ["generic", "acme"],
    mint: () => { throw new Error("TRADEMARK_MCP_TOKEN_SECRET unset — cannot mint a scoped token"); },
  });
  assert.equal(token, BOOT);
});
