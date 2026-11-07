// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FREE US REGISTER SAYS, WHERE THE INSTALL GUIDE OFFERS IT, THAT ITS DOWNLOAD NEEDS A USPTO ACCOUNT.
//
// The install guide's section on running without a paid register said "No vendor, no invoice, and no
// extra software" and stopped there (measured on a beta, 2026-11-04). Setup and the provider's own page
// both say the download needs a USPTO.gov account with ID.me identity verification, and the download
// refuses without its key. A reader choosing the free route met that requirement only after choosing it.
//
// THE REQUIREMENT IS READ FROM THE REFUSAL, NOT TYPED: the download is asked for its file list with no key,
// and what it says is what the guide must say. Nothing reaches the network; the refusal comes first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_KEY_ENV, listProductFiles } from "../../providers/uspto-local/src/sync.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** INSTALL.md's §3a, by its own heading, with line breaks folded so a wrapped phrase still matches. */
function freeRegisterSection() {
  const text = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
  const from = text.indexOf("## 3a. ");
  assert.notEqual(from, -1, "INSTALL.md has no §3a");
  const next = text.indexOf("\n## ", from + 1);
  return text.slice(from, next === -1 ? undefined : next).replace(/\s+/g, " ");
}

test("the download refuses without its key, and says it needs a USPTO.gov account with ID.me", async () => {
  let said = null;
  await assert.rejects(listProductFiles({ fetchImpl: () => { throw new Error("the network was reached"); } }), (e) => { said = e.message; return true; });
  assert.ok(said.includes(API_KEY_ENV), `the refusal does not name ${API_KEY_ENV}`);
  assert.match(said, /USPTO\.gov account/);
  assert.match(said, /ID\.me/);
  assert.match(said, /--from-file/, "the refusal no longer offers the keyless route");
});

test("the install guide's free-register section says the same before the reader chooses it", () => {
  const section = freeRegisterSection();
  assert.match(section, /USPTO\.gov account/, "§3a does not say the download needs a USPTO.gov account");
  assert.match(section, /ID\.me/, "§3a does not say the account needs ID.me identity verification");
  assert.ok(section.includes(`\`${API_KEY_ENV}\``), `§3a does not name ${API_KEY_ENV}`);
  assert.match(section, /clearotron sync --from-file/, "§3a does not offer the route that needs no key");
});
