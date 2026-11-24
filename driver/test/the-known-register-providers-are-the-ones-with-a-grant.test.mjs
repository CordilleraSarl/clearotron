// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PROVIDERS A DEPLOYMENT MAY NAME ARE THE ONES WITH A TOOL GRANT, AND NONE ELSE.
//
// Three places name the register providers: KNOWN_REGISTER_PROVIDERS (driver.config.mjs), which a deployment's
// REGISTER_PROVIDER is checked against and which the preflight refusal and the setup wizard print; the folders under
// providers/ that hold a register-grant.mjs, which say what each provider's server is granted; and REGISTER_SERVERS
// (gather-config.mjs), which mounts them. The list keeps its own order, the recommended register first, because that
// is the order a reader is shown; a folder listing would come back alphabetical. So the list stays written out, and
// this holds it to the same set as the folders and the table: a provider added in one place and not the others fails
// here by name, instead of being accepted at setup and refused at the first stage, or granted and never selectable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_REGISTER_PROVIDERS } from "../driver.config.mjs";
import { REGISTER_SERVERS } from "../engine/mcp/gather-config.mjs";

const PROVIDERS = fileURLToPath(new URL("../../providers/", import.meta.url));
const withGrant = () => readdirSync(PROVIDERS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PROVIDERS, d.name, "src", "register-grant.mjs")))
  .map((d) => d.name).sort();

test("every provider a deployment may name has a grant in its folder, and every grant is one a deployment may name", () => {
  const folders = withGrant();
  assert.ok(folders.length >= 6, `found ${folders.length} provider folders with a grant — the scan is reading the wrong place`);
  assert.deepEqual([...KNOWN_REGISTER_PROVIDERS].sort(), folders,
    "KNOWN_REGISTER_PROVIDERS and the provider folders with a register-grant.mjs name different providers");
  assert.deepEqual(Object.keys(REGISTER_SERVERS).sort(), folders, "REGISTER_SERVERS mounts a different set of providers than the folders grant");
});

test("the list keeps its declared order: the recommended register first, then the free tier", () => {
  assert.equal(new Set(KNOWN_REGISTER_PROVIDERS).size, KNOWN_REGISTER_PROVIDERS.length, "a provider is listed twice");
  assert.deepEqual(KNOWN_REGISTER_PROVIDERS.slice(0, 2), ["signa", "free-tier"], "the order a reader is shown moved");
  // Control: the folder order is NOT the declared order, so the arm above is about the list and not about the listing.
  assert.notDeepEqual(withGrant(), [...KNOWN_REGISTER_PROVIDERS]);
});
