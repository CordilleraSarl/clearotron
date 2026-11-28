// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CLIENT DOOR'S GUIDE COUNTS THE TOOLS THE DOOR LISTS.
//
// docs/CLIENT-MCP.md told a deployer an account key reaches "eighteen" tools, and its API-key door check said
// `tools/list` "must be exactly the eleven `account` tools". The door listed twenty to an account key, the twenty
// marked `accountSafe` in TOOL_SCOPES (measured at the door in testing, 2026-11-27). A deployer following the check
// would read a correct door as one that "resolved a wider principal than `account`". Both counts had been wrong since
// 2026-09-04, as had the copies of the count in mcp-server/CONNECT.md and mcp-server/remote/README.md, and the table
// beside them left out `server_info`.
//
// So the guide is read against TOOL_SCOPES: the table names every account tool and no other tool, and both counts are
// the table's own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_SCOPES } from "../../shared/scope.mjs";

const GUIDE = readFileSync(new URL("../../docs/CLIENT-MCP.md", import.meta.url), "utf8");
const ACCOUNT = Object.entries(TOOL_SCOPES).filter(([, s]) => s.accountSafe).map(([name]) => name).sort();
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two",
  "twenty-three", "twenty-four", "twenty-five", "twenty-six", "twenty-seven", "twenty-eight", "twenty-nine", "thirty"];

/** The account principal's paragraph and table: from "An `account` principal reaches" to the first line after the table. */
function accountSection() {
  const at = GUIDE.indexOf("An `account` principal reaches");
  assert.ok(at >= 0, "the guide no longer says what an account principal reaches");
  const lines = GUIDE.slice(at).split("\n");
  const end = lines.findIndex((l, i) => i > 2 && lines[i - 1].startsWith("|") && !l.startsWith("|"));
  return lines.slice(0, end).join("\n");
}

test("the guide's table names every tool an account key reaches, and no other tool", () => {
  const named = new Set([...accountSection().matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => Object.hasOwn(TOOL_SCOPES, n)));
  assert.deepEqual([...named].sort(), ACCOUNT, "the guide's table and TOOL_SCOPES's accountSafe tools differ");
});

test("both of the guide's counts are the number of tools an account key reaches", () => {
  assert.ok(ACCOUNT.length < WORDS.length, `the count table stops at ${WORDS.length - 1}; extend it`);
  const word = WORDS[ACCOUNT.length];
  assert.match(accountSection(), new RegExp(`^An \`account\` principal reaches \\*\\*${word}\\*\\* tools`), `the count is not ${word}`);
  const check = GUIDE.match(/`tools\/list` must be exactly the ([a-z-]+) `account` tools/);
  assert.ok(check, "the API-key door's check no longer says how many tools tools/list must list");
  assert.equal(check[1], word, "the API-key door's check counts a different number of tools");
});

test("the two pages that point a reader to the guide give the same count", () => {
  // Both carried their own copy of the count, and both were stale with the guide.
  const word = WORDS[ACCOUNT.length];
  for (const [page, said] of [
    ["../../mcp-server/CONNECT.md", /A signed-in client reaches ([a-z-]+) tools/],
    ["../../mcp-server/remote/README.md", /\n([a-z-]+) account tools, why the rest are withheld/],
  ]) {
    const m = readFileSync(new URL(page, import.meta.url), "utf8").match(said);
    assert.ok(m, `${page} no longer says how many tools an account reaches`);
    assert.equal(m[1], word, `${page} counts a different number of tools`);
  }
});
