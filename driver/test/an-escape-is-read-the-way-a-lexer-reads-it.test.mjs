// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE IDENTIFIER SCAN READS AN ESCAPE AS A LEXER DOES, AND A WINDOWS PATH TO NODE IS NOT A NAME.
//
// `unescapeBoundaries` turns an escape into a space so a name hidden behind `\n` in a string is still
// found. Two misreadings made it report a three-letter mark inside Windows paths to Node's executable
// (measured 2026-09-22, six lines in two files): it replaced `\n` before `\\`, so the second backslash
// of a pair was lost to a newline, and it read `\n` as an escape inside a raw path, where a backslash is
// a separator. These arms pin both readings, and the shapes the escape rule exists for, which still fire.
import test from "node:test";
import assert from "node:assert/strict";
import { unescapeBoundaries, reportableOnLine } from "../../shared/identifier-scan.mjs";

const fires = (name, raw) => reportableOnLine(name, raw, new Set());

test("a backslash pair is one backslash, so the word after it keeps its first letter", () => {
  assert.equal(unescapeBoundaries(String.raw`"C:\\tools\\nytrex.exe"`), `"C: tools nytrex.exe"`);
  assert.equal(fires("Ytrex", String.raw`{ node: "C:\\tools\\nytrex\\nytrex.exe" }`), false,
    "the second backslash of a pair was read as the start of an escaped newline");
});

test("a Windows path written raw holds no escapes, so its backslashes stay separators", () => {
  const raw = String.raw`// a path such as ` + "`" + String.raw`C:\Program Files\nytrex\nytrex.exe` + "`" + " broke the file";
  assert.equal(unescapeBoundaries(raw), raw, "nothing in a raw path is an escape");
  assert.equal(fires("Ytrex", raw), false);
  // The same reading catches what the escape rule used to break: a lowercase name after a separator.
  assert.equal(fires("Norvale", String.raw`C:\clients\norvale\notes.txt`), true,
    "a name that starts with n after a raw separator must fire, not lose its n to a newline");
  assert.equal(fires("Quenvik", String.raw`C:\Users\Example\Quenvik\x`), true);
});

test("the escapes the rule exists for are still boundaries", () => {
  assert.equal(fires("Quenvik", String.raw`ownNames:'Harrow Holdings\nQuenvik'`), true, "an escaped newline");
  assert.equal(fires("Quenvik", String.raw`"\\\nQuenvik"`), true, "a backslash pair, then an escaped newline");
  assert.equal(fires("Quenvik", String.raw`"C:\\data\\x.json\nQuenvik"`), true,
    "an escaped path is not a raw one, so an escape beside it in the same string is still read");
  assert.equal(fires("Quenvik", "a&nbsp;Quenvik reading"), true, "an HTML entity");
  assert.equal(fires("Quenvik", "path/to%20Quenvik"), true, "a percent escape");
});
