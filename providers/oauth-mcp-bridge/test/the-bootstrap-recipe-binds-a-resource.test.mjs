// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The one-time setup recipe binds a resource, and verifies by refreshing — tracker issue 172.
//
// THE DEFECT WAS A DOCUMENT, AND IT PRODUCED A DEAD CREDENTIAL THAT EVERY CHECK CALLED HEALTHY.
// `providers/oauth-mcp-bridge/README.md` is the only documented way to enrol a case-law source.
// Followed exactly against a server that enforces RFC 8707, it issued a token family bound to no
// resource: sign-in worked, the bridge listed tools, `clearotron doctor` said enrolled — and the first
// refresh failed with `InvalidTargetError: resource does not match refresh token`. A week later for one
// source, an hour for the other. Measured on the production install, 2026-09-05.
//
// The SDK sends the indicator on EVERY token request including the refresh, so the bootstrap has to bind
// the same value the SDK will later send. It must be READ from the server: CourtListener publishes
// `https://mcp.courtlistener.com/` with a trailing slash its own serverUrl lacks, and a composed value
// mismatches exactly like an absent one.
//
// ── WHY THIS IS AN ARM OVER PROSE, WHICH IS USUALLY THE WRONG SHAPE ─────────────────────────────────
//
// Nothing in the tree executes this recipe — an operator types it. So there is no code path to drive,
// and the honest alternative to checking the text is checking nothing. What it asserts is therefore kept
// to what the DEFECT was: the indicator is fetched rather than assigned, it rides both legs of the
// exchange, and the verification reaches the refresh. It deliberately does not police wording.
//
// The live half of this issue's acceptance — a real credential surviving a real forced refresh, with the
// refresh token observably rotated — cannot be driven from here and is not claimed here. It was measured
// by the lane that found it, against the production install and both sources.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const README = join(dirname(dirname(fileURLToPath(import.meta.url))), "README.md");
const text = () => readFileSync(README, "utf8");

/** The fenced bash of the one-time setup, which is the part an operator actually runs. */
function recipe() {
  const src = text();
  const start = src.indexOf("## One-time setup");
  assert.notEqual(start, -1, "the one-time setup section is gone — this arm no longer reads the recipe");
  const end = src.indexOf("### Why there is no scripted bootstrap", start);
  assert.notEqual(end, -1, "the recipe's end marker moved, so this arm may be reading half of it");
  return src.slice(start, end);
}

test("tracker issue 172 — the resource indicator is READ from the server, never composed", () => {
  const r = recipe();
  // The fetch, and the field. Both, because a recipe that fetches the metadata and then ignores
  // `.resource` would satisfy a check for either one alone.
  assert.match(r, /\.well-known\/oauth-protected-resource/,
    "the recipe does not fetch the protected-resource metadata, so its indicator is invented");
  assert.match(r, /jq -r \.resource/,
    "the metadata is fetched but the published indicator is not read out of it");

  // THE DEFECT ITSELF: a hand-written constant. This is the line that shipped, and it is the one shape
  // that must not come back — an assignment of a literal URL to the variable the exchange sends.
  assert.doesNotMatch(r, /^RESOURCE=("|')?https?:\/\//m,
    "the resource indicator is assigned a literal URL again — a value composed by hand mismatches the "
    + "server's own by a trailing slash and fails exactly like sending none");
});

test("tracker issue 172 — the indicator rides BOTH the authorize step and the exchange", () => {
  const r = recipe();
  // Binding one leg and not the other is the near-miss: the authorize step alone does not bind the
  // family, and the exchange alone is not what a strict server checks first.
  assert.match(r, /authorize\/\?[^"']*resource=/,
    "the authorize URL carries no resource, so the grant is not bound to one");
  assert.match(r, /--data-urlencode "resource=/,
    "the token exchange sends no resource, so the issued family is bound to nothing");
});

test("tracker issue 172 — verification reaches the refresh, and checks the token rotated on disk", () => {
  const src = text();
  // A `tools/list` on fresh tokens is what shipped and it cannot fail for this reason. The three
  // conditions below are each a different half of "the refresh actually worked", and the rotation is
  // the one whose absence bricks the NEXT spawn rather than this one.
  assert.match(src, /access_token = \\"\\"|access_token = ""/,
    "nothing blanks the access token, so the probe never has to refresh to answer");
  assert.match(src, /tokens refreshed/, "the check does not require evidence that the refresh path ran");
  assert.match(src, /NEW_REFRESH.*!=.*OLD_REFRESH|"\$NEW_REFRESH" != "\$OLD_REFRESH"/,
    "the check never compares the refresh token before and after, so a refresh that did not persist "
    + "its rotation still reads as a pass");

  // In place, with a way back. A copy-test can pass while leaving the deployment dead.
  assert.match(src, /\$CRED\.bak/, "the in-place check has no backup, so a failure costs the credential");
  assert.match(src, /restoring|mv "\$CRED\.bak"/, "a failed refresh does not restore the file it broke");
});

test("tracker issue 172 — the recipe warns that an authorization code expires in seconds", () => {
  // Cost a round-trip on the drive that found all this: the code is dead before the exchange is typed.
  // Asserted because it is the kind of line an edit drops as chatter, and its absence is silent.
  assert.match(recipe(), /SIXTY\s+SECONDS|60 seconds/i,
    "nothing tells the operator to stage the exchange before handing out the authorize URL");
});
