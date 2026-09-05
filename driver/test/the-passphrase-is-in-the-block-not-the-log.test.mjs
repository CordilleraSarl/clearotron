// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F10. The owner, on his first demo run: *"the URL is kind of hidden… same for
// the passphrase, it's really hidden, I only KNEW to look for it."*
//
// The two values that decide whether a first-time reader reaches a report were fourteen lines apart in
// two different registers. The passphrase arrived as the second-to-last of eleven consecutive
// [portal-service] log lines, prefixed identically to the audit path and the token expiry beside it —
// and it is the ONE value in this product that cannot be read back. Every other line in that wall is
// recoverable information about paths, rosters and tokens. This one is not, and it looked the same.
//
// The tell was the summary itself: "The passphrase is printed once, above, by the portal as it starts."
// A summary that sends the reader back up into a log for a value it could have carried.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newPassphrase } from "../portal-local-auth.mjs";
import { childEnv, resolvePorts } from "../../bin/start.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const START = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");

// ── THE VALUE IS NEVER PERSISTED, WHICH IS THE PART THAT COULD HAVE GONE WRONG ─────────────────────

test("2175-F10 the passphrase is NOT part of the composed portal environment", () => {
  // THE WHOLE RISK OF THIS CHANGE, IN ONE ARM. `--background` writes the union of the composed child
  // environments into the units' env file. A passphrase placed in `envs.portal` would therefore become
  // a permanent PLAINTEXT copy on disk — and the product's own sentence, "it is stored only as a
  // digest", would be false. It is handed at the spawn call instead, so the union cannot carry a key
  // the object never had.
  const envs = childEnv({
    ports: resolvePorts({}),
    paths: { base: "/i", pool: "/i/pool", workspace: "/i/w", queue: "/i/q", outbox: "/i/o",
      locks: "/i/l", grants: "/i/grants.json", audit: "/i/audit", recipes: "/i/r", configStore: "/i/c" },
    user: "op@localhost", staffDomains: "localhost",
    portalSecret: "s", tokenSecret: "t", opsToken: "o",
  });
  for (const [name, block] of Object.entries(envs)) {
    if (!block || typeof block !== "object") continue;
    assert.equal(block.PORTAL_LOCAL_PASSPHRASE, undefined,
      `the composed "${name}" environment carries the passphrase, and that composition is what gets `
      + "written to the units' env file — a plaintext copy on disk makes the product's own promise false");
  }
});

test("2175-F10 it is handed at the SPAWN CALL, structurally out of reach of the union", () => {
  // Asserted at source because the seam is which object the value is placed in, and an arm that only
  // checked the composed env would pass on a version that filtered it out of the union afterwards —
  // a filter a later author can drop without noticing, where an absent key cannot be dropped.
  assert.match(START, /PORTAL_LOCAL_PASSPHRASE: mintedPassphrase/,
    "the value must be added at the spawn, not composed into the reusable environment");
  assert.match(START, /\{ \.\.\.envs\.portal, PORTAL_LOCAL_PASSPHRASE: mintedPassphrase \}/,
    "spread at the call site, so envs.portal itself is never mutated");
  // And the union that reaches the env file must be built from envs.*, never from the spawn object.
  assert.match(START, /const union = \{ \.\.\.envs\.mcp, \.\.\.envs\.portal/,
    "if the union stops being built from the composed blocks, this arm's reasoning no longer holds");
});

test("2175-F10 ONE generator, so there is one entropy decision", () => {
  const a = newPassphrase();
  const b = newPassphrase();
  assert.notEqual(a, b, "two mints must not produce the same secret");
  assert.match(a, /^[A-Za-z0-9_-]{24}$/, `expected 24 base64url characters, got ${JSON.stringify(a)}`);
  // The supervisor mints through the same function the credential writer defaults to. Two generators
  // would be two entropy decisions and the second is always the weaker.
  assert.match(START, /newPassphrase\(\)/, "the supervisor must mint through the shared generator");
});

// ── THE BLOCK ITSELF ───────────────────────────────────────────────────────────────────────────────

test("2175-F10 a FIRST start prints the address and the passphrase adjacent, in a frame", () => {
  const block = START.slice(START.indexOf("if (mintedPassphrase) {"), START.indexOf("} else {", START.indexOf("if (mintedPassphrase) {")));
  assert.match(block, /Open\s+\$\{envs\.url\}/, "the address must be in the block");
  assert.match(block, /Passphrase\s+\$\{mintedPassphrase\}/,
    "the block must carry the VALUE — not a pointer to a line above it, which is the finding");
  assert.match(block, /Sign in as/, "and the identity it belongs to");
  assert.match(block, /Lost it\? \$\{reset\}/,
    "the recovery command belongs in this block, not in a paragraph the reader has already skimmed");
  // `reset` IS THAT COMMAND, and it now names the credential when the credential is not where the verb
  // looks by default — the demo keeps its own inside its base, and the bare form run as printed exited 1
  // saying no credential exists. The composition moved into `passphraseResetCommand`, which is driven
  // directly in a-credential-file-is-written-one-way.test.mjs; what this pins is that the launcher asks
  // it rather than spelling the command a second time.
  assert.match(START, /const reset = passphraseResetCommand\(\{/,
    "and `reset` must be composed by the one function that knows when the credential needs naming");
  // Visually distinct from the [portal-service]-prefixed wall it sits under.
  assert.match(block, /┌|└|│/, "the block must be framed, not another prefixed line in the same register");
});

test("2175-F10 the summary no longer sends the reader back up into the log", () => {
  // Comments excluded, as in the retired-claims arm: the phrase legitimately appears in the two
  // comments explaining why it went, and a check that could not tell prose from output would forbid
  // this file from recording its own reason.
  const emitted = START.split("\n").filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  }).join("\n");
  assert.doesNotMatch(emitted, /printed once, above/,
    "the tell for this finding was a summary pointing at a log line for a value it could carry");
  // And the instrument: the phrase IS still in the file, in comments, so an empty result above means
  // the filter worked rather than that the matcher cannot match.
  assert.match(START, /printed once, above/,
    "the comments explaining the retirement are expected to survive — if they are gone, so is the reason");
});

test("2175-F10 a LATER start still says the truth, and does not claim to reprint", () => {
  // F22's fix, kept. On every start after the first the passphrase was minted days ago, possibly to a
  // terminal nobody watched, and a block promising a value would send the reader looking for one that
  // is not there. The branch is chosen by whether THIS run minted, not by whether a file exists now.
  const later = START.slice(START.indexOf("} else {", START.indexOf("if (mintedPassphrase) {")));
  assert.match(later.slice(0, 600), /minted on an earlier start and is NOT reprinted/,
    "the later-start branch must still say the value is not being reprinted");
  assert.match(START, /const mintedPassphrase = credentialExisted \? null : newPassphrase\(\)/,
    "the branch must turn on what this run did, not on a file check made after the mint");
});
