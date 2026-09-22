// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// SETUP CONFIRMS A KEY BY ITS LENGTH, AND BY NOTHING ELSE.
//
// Measured on the published 0.3.2-beta.13 during a paid install, 2026-09-19: for every secret pasted
// into `clearotron install` — the engine key, the register key, the Perplexity key — setup answered
//
//     · received — <N> characters, ending …<last four>
//
// on stdout, every run. Four live characters of a key then sit in whatever caught that output: a
// script, a CI job, a tee'd install, an assistant's transcript. Ours had to be masked by hand.
//
// NOT GATED ON A TERMINAL, and that is the point of this arm rather than an accident of it. The
// passphrase answers a TTY check, which is right for the passphrase. It is wrong here: one of the
// leak paths named in the report is an assistant driving the terminal, and such a session HAS a pty,
// so `isTTY` is true and the tail would still be captured. A gate that passes in the case you are
// defending against is not a defence, so the tail is gone unconditionally.
//
// Length is still a real confirmation: a masked prompt shows the reader nothing, and a paste that
// half-landed is a different number of characters. That is the failure this line exists to catch.
//
// WHY THIS READS THE SOURCE. The two prompts live inside a closure in `bin/onboard.mjs`, behind the
// TTY refusal at the top of the file, so there is no seam to call them through without restructuring
// the file this arm exists to protect. It therefore guards the tail's RETURN: any `slice(-4)` — or any
// other tail — reaching a confirmation line fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const ONBOARD = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
/** The confirmation lines, wherever they are: the ones that answer a value with its size. */
const RECEIVED = [...ONBOARD.matchAll(/received — \$\{[^}]+\}[^`]*/g)].map((m) => m[0]);

test("every received-line answers with a length and carries no piece of the value", () => {
  assert.ok(RECEIVED.length >= 2, `expected the received-lines to still exist, found ${RECEIVED.length}`);
  for (const line of RECEIVED) {
    assert.match(line, /\$\{[A-Za-z0-9_.]+\.length\}/, `a received-line no longer states a length: ${line}`);
    assert.doesNotMatch(line, /slice\(/, `a received-line carries part of the value again: ${line}`);
    assert.doesNotMatch(line, /ending/, `a received-line offers a tail again: ${line}`);
  }
});

test("nothing in setup takes the tail of a secret for display", () => {
  // The defect as the assertion, against the whole file rather than the two lines it was found on:
  // `raw.slice(-4)` and `v.slice(-4)` were the two, and a third would be the same defect somewhere new.
  const tails = [...ONBOARD.matchAll(/^.*\.slice\(\s*-\d+\s*\).*$/gm)].map((m) => m[0].trim());
  const shown = tails.filter((l) => /info\(|say\(|console\.|process\.stdout/.test(l));
  assert.deepEqual(shown, [], `setup prints the tail of a value:\n${shown.join("\n")}`);
});

test("the masked prompt still says something, so a half-landed paste is still visible", () => {
  // THE OTHER DIRECTION. Removing the line entirely would be the easy way to pass the arms above and
  // would take away the only signal a reader of a masked prompt has that their paste arrived whole.
  const at = ONBOARD.indexOf("const a = secret ? await askSecretRaw");
  assert.ok(at > 0, "the masked prompt could not be found, so nothing below reads it");
  const masked = ONBOARD.slice(at, ONBOARD.indexOf("return v;", at));
  assert.match(masked, /if \(secret\) info\(`received — \$\{v\.length\} characters`\)/,
    "the masked prompt no longer confirms what it received at all");
});
