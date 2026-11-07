// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A BETA READER FINDS THE BETA FORM OF THE FIRST COMMANDS, AND THE STABLE READER'S PATH STAYS FIRST.
//
// A newcomer testing a beta followed the README and the quickstart (measured 2026-11-04). The README's
// `npx clearotron demo` fetched the stable, even straight after a beta install, and neither page gave the
// demo's beta form; the quickstart gave no beta line at all. The README also said npx "will ask once
// before downloading", and npx asked on two runs in a row.
//
// The channel's name is read from how an install names its own channel from its version, the same reading
// `clearotron update` follows, so a renamed channel goes red here. Not from the release configuration's
// pre-release file: cutting a stable deletes that file, and this arm would then fail on the stable's cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { channelOf } from "../../shared/permanent-install.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const TAG = channelOf("0.0.0-beta.0");

test("the beta channel the pages name is the one an install reads from a beta's version", () => {
  assert.equal(TAG, "beta", "an install reads a beta's channel under another name");
});

test("the README and the quickstart give the beta form of install and demo, after the stable form", () => {
  for (const page of ["README.md", "QUICKSTART.md"]) {
    const text = read(page);
    for (const verb of ["install", "demo"]) {
      const stable = text.indexOf(`npx clearotron ${verb}`);
      const beta = text.indexOf(`npx clearotron@${TAG} ${verb}`);
      assert.ok(beta > 0, `${page} gives no beta form of \`npx clearotron ${verb}\``);
      assert.ok(stable >= 0 && stable < beta, `${page} puts the beta form of ${verb} before the stable one`);
    }
  }
});

test("the README does not promise npx asks only once", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /ask once before downloading/, "the README says npx asks once; it asked on two runs in a row");
  assert.match(readme, /npx asks before it downloads it/);
});
