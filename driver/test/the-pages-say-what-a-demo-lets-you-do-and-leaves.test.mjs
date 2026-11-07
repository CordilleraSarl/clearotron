// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PAGES SAY WHAT A DEMO LETS YOU DO, AND WHAT IT LEAVES.
//
// A newcomer on a beta found three things the pages had wrong (measured 2026-11-04). The install guide's
// table said a demo lets you "read"; a visitor signs in, and an order opens a finished example. The README
// said "nothing of it is left on the machine" and the demo's last line agreed; npm keeps its own copy of the
// package in its cache. And a demo started over a folder `--once` or `--keep` left keeps that folder, which
// the README's "starts clean" did not allow for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const flat = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\s+/g, " ");

test("the guide's table says a demo can be signed in to and ordered from", () => {
  const row = flat("INSTALL.md").match(/\| what you can do \|([^|]+)\|/)?.[1] ?? "";
  assert.match(row, /sign in and read/, `the table does not say a visitor signs in: ${row}`);
  assert.match(row, /an order opens the finished example/, `the table does not say what an order does: ${row}`);
});

test("the README and the demo's last line claim only what the demo removes", () => {
  const readme = flat("README.md");
  assert.doesNotMatch(readme, /nothing of it is left on the machine/, "npm's cache keeps a copy of the package");
  assert.match(readme, /only npm's own copy of the package stays, in its cache/);
  assert.match(readme, /A demo started over a folder either of those left keeps it too/, "the README does not say a later demo keeps a kept folder");
  assert.doesNotMatch(flat("bin/start.mjs"), /nothing of it is left on this machine/, "the demo's last line still claims more than it removed");
});
