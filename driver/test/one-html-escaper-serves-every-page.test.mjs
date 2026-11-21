// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE HTML ESCAPER SERVES EVERY PAGE. shared/html-escape.mjs holds the two forms a value takes in HTML: text between
// tags, and an attribute's value. Every page writer here once kept its own, and they had drifted to six bodies: one
// left `>` raw, and three printed "null" for an absent value. This file holds the two forms, and holds that no module
// on the server side grows its own again. The one copy kept is browser code inside the development portal's page
// script, which cannot import a module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeText, escapeAttr } from "../../shared/html-escape.mjs";
import { attrValue } from "../publish/attr.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const GUARD = "one-html-escaper";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("text encodes & < >; an attribute's value also encodes both quotes; an absent value is empty", () => {
  const s = `a & b < c > d "e" 'f'`;
  assert.equal(escapeText(s), `a &amp; b &lt; c &gt; d "e" 'f'`);
  assert.equal(escapeAttr(s), `a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;`);
  for (const absent of [null, undefined]) {
    assert.equal(escapeText(absent), "");
    assert.equal(escapeAttr(absent), "");
  }
  assert.equal(escapeText(0), "0");
  assert.equal(attrValue, escapeAttr, "the publisher's attribute helper is not the shared one");
});

test("no server-side module keeps an HTML escaper of its own", (ctx) => {
  const files = trackedFiles(GUARD, { root: ROOT, pathspec: ["*.mjs", "*.js", ":!**/test/**", ":!*.test.mjs", ":!portal-ui/**", ":!vendor/**"] });
  if (files === null) return ctx.skip(skipReason(GUARD));
  // An ampersand replaced by its entity is the one step every escaper body takes, in either spelling: a chain of
  // replace calls, or a character class with a lookup table.
  const BODY = /replace\(\/&\/g,\s*["']&amp;["']\)|\{\s*["']&["']\s*:\s*["']&amp;["']/;
  const own = nonEmpty(files, `${GUARD}: tracked source files`)
    .filter((rel) => rel !== "shared/html-escape.mjs" && BODY.test(readFileSync(join(ROOT, rel), "utf8")));
  // The development portal's page script runs in the browser, which cannot import a module.
  assert.deepEqual(own, ["driver/dev-portal.mjs"]);
});
