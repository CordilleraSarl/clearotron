// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The marketplace rule exists TWICE, and this is what stops the copy drifting.
//
// `driver/profiles.mjs platformEntryErrors` is the authority: it decides what a profile may hold, and a
// profile it refuses bricks every run under that customer. `portal-ui` cannot import it — separate
// workspace, self-contained bundle, the same constraint profileFields.ts records for the search-level
// registry — so the settings page carries a COPY of the shape test to warn a lawyer before they save.
//
// A copy with no guard drifts silently, and the failure is the one was filed on: the
// page accepts something in silence and the server refuses it. So the two are DRIVEN over one corpus
// here and must agree entry by entry.
//


import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platformEntryErrors } from "../profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_FIELDS = join(HERE, "..", "..", "portal-ui", "src", "contract", "profileFields.ts");

/** The regex the settings page applies to a marketplace entry, lifted from its source. */
function uiPlatformPattern() {
  const src = readFileSync(UI_FIELDS, "utf8");
  // Anchored on the platforms spec so a regex elsewhere in the file cannot be picked up by accident.
  const at = src.indexOf("key: 'platforms'");
  assert.notEqual(at, -1, "could not find the platforms spec — this arm has stopped looking at anything");
  const window = src.slice(at, at + 2000);
  const m = window.match(/\/\^\[a-z0-9\][^/]*\/(?=\.test)/);
  assert.ok(m, "could not extract the platform pattern from the settings page — a could-not-look, not a pass");
  return new RegExp(m[0].slice(1, -1));
}

test("1996 the settings page and the server agree, entry by entry, on what a marketplace is", () => {
  const pattern = uiPlatformPattern();
  const uiRejects = (e) => {
    const d = String(e).trim().toLowerCase();
    return d === "web" || /\s/.test(d) || !pattern.test(d);
  };

  const corpus = [
    "amazon.com", "etsy.com", "shop.example.co.uk", "a1.io", "sub.domain.example.com",
    "Amazon", "web", "WEB", "big retail site", "amazon", "http://amazon.com",
    "amazon.com/dp", "", "   ", ".com", "-bad.com", "amazon..com", "amazon.c",
  ];

  const disagreed = [];
  for (const entry of corpus) {
    // The server's own answer for a ONE-entry list, so duplicate detection cannot colour the result.
    const serverRefuses = platformEntryErrors([entry]).length > 0;
    if (serverRefuses !== uiRejects(entry)) disagreed.push({ entry, serverRefuses, ui: uiRejects(entry) });
  }
  assert.deepEqual(disagreed, [],
    "the page would accept in silence something the server refuses, or warn about something it accepts — "
    + "that gap IS tracker issue 1996's complaint, and the copy is only allowed to exist because this arm holds");
});

test("1996 the corpus actually exercises BOTH verdicts, so agreement is not vacuous", () => {
  // Two lists that agree on nothing but "reject everything" would pass the arm above. This is the control.
  const accepted = ["amazon.com", "etsy.com"].filter((e) => platformEntryErrors([e]).length === 0);
  const refused = ["Amazon", "web", "big retail site"].filter((e) => platformEntryErrors([e]).length > 0);
  assert.ok(accepted.length >= 2, "the corpus must contain entries the server ACCEPTS");
  assert.ok(refused.length >= 3, "and entries it REFUSES, or agreement proves nothing");
});
