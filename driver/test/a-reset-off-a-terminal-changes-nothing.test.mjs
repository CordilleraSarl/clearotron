// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A RESET OFF A TERMINAL CHANGES NOTHING, AND SAYS SO.
//
// `clearotron passphrase --reset` removes the credential, mints a new passphrase and prints it. Sent
// anywhere but a terminal — `> f`, a service manager, an assistant capturing command output — the new
// value lands in that file or transcript. That is the leak closed for `start` and `demo`, arriving
// through the one verb the fixed path NAMES as the way back in.
//
// So off a terminal the verb stops before it touches anything: nothing removed, nothing minted, nothing
// printed to standard output, and a non-zero exit. The operator types it in a terminal, where the value
// is seen once and not stored.
//
// THE ORDER IS THE WHOLE POINT, not a detail of the implementation. The refusal sits above the `rmSync`,
// so the acceptance — the credential is byte-identical afterwards — cannot be met by luck or by a later
// branch. This arm hashes the file either side to hold that.
//
// HOME IS A TEMP DIRECTORY HERE, deliberately. The credential resolves to `~/.cordillera/` when the
// install has none of its own, so an arm that only passed `--base` would mint into the runner's real
// home. It did, once, while this was being written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const VERB = join(ROOT, "bin", "passphrase.mjs");

/** Run the verb with standard output PIPED — which is what everything but a terminal looks like. */
function pipedReset(home) {
  return spawnSync(process.execPath, [VERB, "--reset"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, PORTAL_LOCAL_USER: "arm@example.invalid" },
  });
}
const credentialsUnder = (home) => {
  const dir = join(home, ".cordillera");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.includes("credential")) : [];
};
const digest = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

test("off a terminal the verb refuses, mints nothing, and prints no value", () => {
  const home = mkdtempSync(join(tmpdir(), "pp-reset-"));
  try {
    const r = pipedReset(home);
    assert.notEqual(r.status, 0, "a reset sent somewhere that keeps its output exited as though it had worked");
    assert.equal(r.stdout.trim(), "", `the verb wrote to standard output off a terminal: ${JSON.stringify(r.stdout)}`);
    // NOTHING WAS MINTED. The credential is the thing a captured passphrase would unlock, and the
    // acceptance is that the verb did not reach it at all.
    assert.deepEqual(credentialsUnder(home), [], "the verb minted a credential on an output it refused to print to");
    // It says why, in the sentence the product already ships for this, plus what to do instead.
    assert.match(r.stderr, /The passphrase is NOT printed here: stdout is not a terminal/,
      "the refusal does not give the shipped reason");
    assert.match(r.stderr, /Nothing was changed\./, "the refusal does not say the credential is intact");
    assert.match(r.stderr, /in a terminal/, "the refusal does not say how to get a passphrase");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an existing credential is byte-identical after a refused reset", async () => {
  const home = mkdtempSync(join(tmpdir(), "pp-keep-"));
  try {
    // A credential that already exists is the case with something to lose: the verb removes before it
    // mints, so a refusal that arrived one line later would leave the install with no sign-in at all.
    const dir = join(home, ".cordillera");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "portal-local-credential.json");
    const { establishCredential } = await import("../portal-local-auth.mjs");
    establishCredential({ path, email: "arm@example.invalid" });   // mints; the value is never read here
    const before = digest(path);

    const r = pipedReset(home);
    assert.notEqual(r.status, 0);
    assert.equal(digest(path), before, "the refused reset changed the credential on disk");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the refusal reads the shipped sentence rather than a copy of it", () => {
  // TWO PLACES WITHHOLD A PASSPHRASE and they must not drift into two reasons for it. The verb takes the
  // first line from the composer instead of repeating the words, so a change to that sentence reaches
  // both. If this file ever holds the sentence as a literal, that guarantee is gone.
  const src = readFileSync(VERB, "utf8");
  assert.match(src, /passphraseWithheldLines\(\{ stream: "stdout" \}\)\[0\]/,
    "the verb no longer takes the withheld sentence from its one composer");
  assert.doesNotMatch(src, /would outlive the moment/, "the verb now carries its own copy of the shipped sentence");
});
