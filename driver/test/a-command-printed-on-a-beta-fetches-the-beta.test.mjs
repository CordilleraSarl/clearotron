// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COMMAND PRINTED ON A BETA FETCHES THE BETA.
//
// The bare package name fetches the stable: `npx clearotron …` runs `latest`, and `npm install -g clearotron`
// installs it. A beta that printed either sent its reader to the other channel, and the stable's setup then
// moves itself over the beta. Found on a fresh install of the published beta, 2026-11-07, where the portal's
// no-engine notice named `npx clearotron install`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelPackage, ownVersion } from "../../shared/permanent-install.mjs";
import { stuckInNpxCacheNote } from "../../bin/onboard.mjs";

test("the package a command names is the channel's: the beta's on a beta, the bare name on the stable", () => {
  assert.equal(channelPackage("0.5.1-beta.0"), "clearotron@beta");
  assert.equal(channelPackage("0.5.0"), "clearotron", "a stable's commands changed");
  // A version that cannot be read is not a beta, and its commands read as they always have.
  assert.equal(channelPackage(null), "clearotron");
  assert.equal(channelPackage("not a version"), "clearotron");
  // AND THIS INSTALL'S OWN, read off its version as `update` reads it.
  assert.equal(channelPackage(), channelPackage(ownVersion()));
});

test("setup, stuck in npx's cache, names the install that lasts on its own channel", () => {
  const beta = stuckInNpxCacheNote("windows", "clearotron@beta").join("");
  assert.match(beta, /`npm install -g clearotron@beta` installs it permanently\./,
    "a beta's setup sent its reader to the stable's permanent install");
  assert.match(beta, /cannot be moved out of it here \(windows\)/, "the reason it cannot move is no longer said");
  // THE CONTROL: the stable's two lines are the ones that shipped, byte for byte.
  assert.deepEqual(stuckInNpxCacheNote("no-home", "clearotron"), [
    "\n  Note: this is running from npm's temporary npx cache and cannot be moved out of it here (no-home).",
    "  It will stop working when npm cleans that cache. `npm install -g clearotron` installs it permanently.\n",
  ]);
  // AND BY DEFAULT, THIS INSTALL'S CHANNEL.
  assert.ok(stuckInNpxCacheNote("windows").join("").includes(`\`npm install -g ${channelPackage()}\``),
    "setup names a package other than this install's");
});
