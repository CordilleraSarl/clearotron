// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 159 — a fresh install could not start, because the write and the move went in separately.
//
// `.env` moved to `~/.config/clearotron/.env`, and three places in this product wrote that file: the
// wizard and the launcher twice, each with its own copy of the same tmp-write, chmod, rename dance. The
// wizard's copy learned to create the directory. The launcher's did not, so on a machine that had never
// run this product:
//
//   start: could not write /home/<user>/.config/clearotron/.env
//          (ENOENT: no such file or directory, open '.../.env.tmp-3485750')     exit 1
//
// The error names the temporary file, so it reads as a permissions problem rather than a missing
// folder, and a headless operator had no way round it: `doctor` sends them to the wizard, and the
// wizard refuses without a terminal. Found by the test lane driving a global install on a wiped box.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { writeSecretFile, SECRET_MODE, SECRET_DIR_MODE } from "../../shared/secret-file.mjs";
import { passphraseResetCommand, credentialPathFor } from "../portal-local-auth.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

test("159 a credential file is written into a directory that does not exist yet", () => {
  const root = mkdtempSync(join(tmpdir(), "secret-write-"));
  try {
    // The shape of a machine that has never run this product: a home with no config directory in it.
    const path = join(root, ".config", "clearotron", ".env");
    assert.ok(!existsSync(dirname(path)), "the arm must start with the directory absent, or it proves nothing");

    writeSecretFile(path, "PERPLEXITY_API_KEY=x\n");

    assert.equal(readFileSync(path, "utf8"), "PERPLEXITY_API_KEY=x\n");
    assert.equal(statSync(path).mode & 0o777, SECRET_MODE, "the file holds credentials and is not at 600");
    assert.equal(statSync(dirname(path)).mode & 0o777, SECRET_DIR_MODE,
      "the directory around a 600 file is world-readable, which advertises that it is there");
    // No temporary file survives. A stray `.env.tmp-1234` at mode 600 is a second copy of somebody's
    // credentials that nothing knows about.
    assert.deepEqual(readdirSync(dirname(path)), [".env"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("159 a failed write leaves no half-file and no copy of the secret", () => {
  const root = mkdtempSync(join(tmpdir(), "secret-write-fail-"));
  try {
    // A path whose parent cannot be created: an ordinary FILE stands where the directory would go.
    writeFileSync(join(root, "blocked"), "");
    const path = join(root, "blocked", "clearotron", ".env");
    assert.throws(() => writeSecretFile(path, "SECRET=value\n"), /ENOTDIR|EEXIST|ENOENT/);
    const stray = readdirSync(root).filter((f) => f !== "blocked");
    assert.deepEqual(stray, [], `a failed write left something behind: ${stray.join(", ")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("159 nothing composes its own atomic write for a file holding credentials", () => {
  // THE ARM FOR THE CLASS, not the instance. Three copies of this existed and the one that shipped a
  // blocker was the copy that did not learn what the others had. A fourth would fail the same way, and
  // the failure only shows on a machine that has never run this product.
  const readers = ["bin/start.mjs", "bin/onboard.mjs"];
  nonEmpty(readers, "the commands that write a credential file");
  for (const rel of readers) {
    const src = readFileSync(join(REPO, rel), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.ok(!/\.tmp-\$\{process\.pid\}/.test(src),
      `${rel} composes its own temporary-file write for a secret — that is the copy that will not learn `
      + "the next thing the others learn. `writeSecretFile` is the one writer.");
    assert.match(src, /writeSecretFile\(/, `${rel} no longer writes its credential file through the one writer`);
  }
});

test("159 the printed recovery command runs as printed", () => {
  // The demo keeps its credential inside its own base. `clearotron passphrase --reset`, run exactly as
  // the demo printed it, resolved the SHARED default, found nothing and exited 1 saying no credential
  // exists — while the credential sat in the demo's directory being read by the portal. Measured by the
  // test lane, running the line as printed.
  const home = "/srv/somebody";
  const theDefault = credentialPathFor({}, home);

  assert.equal(passphraseResetCommand({ prefix: "npx ", credentialPath: theDefault, home }),
    "npx clearotron passphrase --reset",
    "an ordinary install got a qualified command it does not need");

  const inTheDemo = "/srv/somebody/trademark-demo/portal-local-credential.json";
  const qualified = passphraseResetCommand({ prefix: "npx ", credentialPath: inTheDemo, home });
  assert.match(qualified, /^PORTAL_LOCAL_CREDENTIAL=\/srv\/somebody\/trademark-demo\/portal-local-credential\.json npx clearotron passphrase --reset$/,
    `a credential outside the default was not named in the recovery line: ${qualified}`);
  assert.notEqual(qualified, "npx clearotron passphrase --reset");

  // An operator who set the variable themselves had the same broken line, and gets the same fix.
  assert.match(passphraseResetCommand({ prefix: "", env: { PORTAL_LOCAL_CREDENTIAL: "/srv/ops/creds.json" }, home }),
    /^PORTAL_LOCAL_CREDENTIAL=\/srv\/ops\/creds\.json clearotron passphrase --reset$/);
});
