// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CASE-LAW SOURCE WITH NO KNOWN SITE SAYS IT IS OPTIONAL.
//
// For Legal Data Hunter, whose site this build does not record, doctor told a newcomer to "ask whoever
// provisioned the bridge" (measured on a fresh install of a beta, 2026-11-04). On an install of their own
// there is nobody to ask. What the code shows is true is that the source is optional: without it a Full
// country search still runs, and its report discloses the case-law gap. The sentence now says that.
//
// The control is CourtListener, whose site this build does know: its row still names the site, so the
// change is confined to the row that had nowhere to send the reader.

import { test } from "node:test";
import assert from "node:assert/strict";
import { caseLawInventory } from "../config-inventory.mjs";

// A directory that cannot exist, so every source that needs a sign-in reads as not set up.
const UNENROLLED = { OAUTH_BRIDGE_CREDS_DIR: "/nonexistent/no-case-law-sign-in" };
const row = (provider) => caseLawInventory(UNENROLLED).find((r) => r.provider === provider);

test("a source with no recorded site is called optional, and the reader is sent to nobody", () => {
  const ldh = row("legaldatahunter");
  assert.ok(ldh, "legaldatahunter is no longer a case-law source; this arm needs repointing");
  assert.equal(ldh.configured, false, "the source read as set up against a directory that cannot exist");
  assert.doesNotMatch(ldh.remedy, /ask whoever|provisioned/i,
    `the reader is still told to ask somebody, which an install of their own has nobody to answer:\n${ldh.remedy}`);
  assert.match(ldh.remedy, /^Optional, and not set up\./, `the row does not say the source is optional:\n${ldh.remedy}`);
  assert.match(ldh.remedy, /A Full country search runs without it/,
    `the row does not say what still runs without it:\n${ldh.remedy}`);
  assert.doesNotMatch(ldh.remedy, /https?:\/\//, `a URL appeared for a source this build records no site for:\n${ldh.remedy}`);
});

test("the control: a source whose site is known still names it", () => {
  const cl = row("courtlistener");
  assert.ok(cl, "courtlistener is no longer a case-law source; this arm needs repointing");
  assert.match(cl.remedy, /create an account at https:\/\/www\.courtlistener\.com\//);
});
