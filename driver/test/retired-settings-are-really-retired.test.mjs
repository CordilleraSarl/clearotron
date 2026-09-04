// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a document saying "set this and nothing happens" has to be TRUE when it lands.
//
// The configuration reference carries a table of settings that were deleted, so an operator whose
// `.env` still holds one learns it is inert. That table is a claim about the code, and it was written
// on a branch where the deletions had not landed yet. If it merges FIRST, main carries documentation
// that tells an operator a live setting does nothing — worse than the stale rows it replaced, because
// it is confidently wrong rather than merely out of date.
//
// Ordering that has to be remembered is not ordering. This arm makes the document and the code agree
// or fail, in either merge order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../../shared/tracked-files.mjs";

const GUARD = "retired-settings-are-really-retired (#1745)";
const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "");
const REF = "docs/architecture/04-configuration-reference.md";

/** The names under the reference's "Retired" heading — read from the document, never restated here. */
function retiredNames() {
  const text = readFileSync(join(ROOT, REF), "utf8");
  const start = text.indexOf("### Retired — set these and nothing happens");
  assert.ok(start > 0, `${REF} no longer carries the retired-settings heading this arm reads`);
  const section = text.slice(start).split(/\n## /)[0];
  return [...section.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]);
}

test("#1745 every setting documented as retired is really gone from the product", () => {
  const names = retiredNames();
  // A table nobody reads asserts nothing, and an empty one would make every assertion below vacuous.
  assert.ok(names.length >= 5, `only ${names.length} retired settings parsed out of ${REF} — the table `
    + "shape changed and this arm is now reading nothing");

  const files = (trackedFiles(GUARD, { root: ROOT, pathspec: ["*.mjs"] }) ?? [])
    .filter((f) => !/(^|\/)test\/|\.test\.mjs$/.test(f) && !f.startsWith("driver/skills/"));
  assert.ok(files.length > 0, "no product files were collected — a SKIP dressed as a pass");
  const corpus = files.map((f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return ""; } }).join("\n");

  // A READ, not a mention. The comment that records a deletion has to name the thing it deleted.
  const stillRead = names.filter((n) =>
    new RegExp(`(?:process\\.)?env\\s*(?:\\?\\.)?(?:\\[\\s*["'\`]${n}["'\`]\\s*\\]|\\.${n}\\b)`).test(corpus));
  assert.deepEqual(stillRead, [],
    `${REF} tells an operator these settings do nothing, and the product still reads them. Either the `
    + "deletion has not landed yet — in which case this document must not land before it — or the "
    + "setting came back and the table is now a lie an operator will act on.");
});
