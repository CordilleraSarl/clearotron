// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 182 — an assertion that renders a credential-bearing file, and only when it fires.
//
// `start-command.test.mjs` proved that `start.mjs` writes nothing before its port probe refuses, by
// snapshotting the repository's `.env` and asserting the two contents equal. `assert.equal` over two
// strings renders BOTH in the failure, so the whole file reached the log.
//
// AND THE ONLY WAY IT COULD FAIL ON A RUNNER WAS THE DEFECT ITSELF. CI carries no `.env`, so the
// snapshot is null; the assertion can only fail if the command under test wrote one first, and what
// `start.mjs` writes there is a freshly minted ops token. A green run said nothing and a red one would
// have published a credential into the log of a public repository. Silent until the moment it is worst.
//
// SO THIS ARM WATCHES THE COMPARISON, NOT THE COMMAND. It drives every shape the snapshot can take and
// asserts that no value survives into the verdict — with values chosen so that a leak cannot hide in a
// coincidence, and with a control proving the search would find one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, keysIn, unchanged } from "./secret-file-compare.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Distinctive enough that a substring search for them cannot match anything else the verdict says.
const A = "zqx-value-one-zqx";
const B = "zqx-value-two-zqx";
const C = "zqx-value-three-zqx";
const BEFORE = `# a comment\nPORTAL_SECRET=${A}\nCLEAROTRON_DATABASE=corsearch\n`;
const AFTER_ADDED = `${BEFORE}TRADEMARK_MCP_TOKEN_SECRET=${C}\n`;
const AFTER_CHANGED = `# a comment\nPORTAL_SECRET=${B}\nCLEAROTRON_DATABASE=corsearch\n`;

test("tracker issue 182 no shape of this comparison puts a value in its verdict", () => {
  const shapes = [
    ["both absent", null, null],
    ["unchanged", BEFORE, BEFORE],
    ["written where there was nothing — the runner's case, and the defect's", null, AFTER_ADDED],
    ["a key appeared", BEFORE, AFTER_ADDED],
    ["a value changed under the same keys", BEFORE, AFTER_CHANGED],
    ["the file was removed", BEFORE, null],
  ];
  assert.equal(shapes.length, 6, "the shape list was narrowed — every state the snapshot can take is driven here");

  for (const [name, before, after] of shapes) {
    const { same, why } = unchanged(before, after);
    assert.equal(same, before === after, `${name}: the verdict disagrees with the two snapshots`);
    for (const secret of [A, B, C]) {
      assert.ok(!why.includes(secret),
        `${name}: a value read out of the file reached the verdict — that verdict goes into a public CI log`);
    }
  }
});

test("tracker issue 182 the search for a leaked value would actually find one — CONTROL", () => {
  // The arm above is an absence check over a string, and an absence check whose subject is empty
  // passes on everything. Both halves are driven: the verdict is not empty, and the same search finds
  // a value when one is present.
  const { why } = unchanged(BEFORE, AFTER_ADDED);
  assert.ok(why.length > 20, "the verdict came back empty, so the arm above searched nothing");
  assert.ok(`${why} ${A}`.includes(A), "the containment search does not find a value that is there");
});

test("tracker issue 182 the verdict says enough to act on: which keys moved, and how big the file is", () => {
  // Refusing to print the value is only half of it. A verdict that says nothing but "changed" sends the
  // reader to open the file, which is the same disclosure by a slower route.
  const appeared = unchanged(BEFORE, AFTER_ADDED).why;
  assert.match(appeared, /TRADEMARK_MCP_TOKEN_SECRET/, "the verdict does not name the key that appeared");
  assert.match(appeared, /\d+ bytes/, "the verdict does not say how the file's size moved");
  assert.match(appeared, /sha256:[0-9a-f]{12}/, "the verdict carries no digest, so two changes cannot be told apart");

  const vanished = unchanged(BEFORE, null).why;
  assert.match(vanished, /keys that vanished: PORTAL_SECRET, CLEAROTRON_DATABASE/);

  // Same keys, different bytes: it says so and stops, rather than naming the key whose value moved —
  // which is the next detail somebody would add, and the one that starts the leak again.
  const moved = unchanged(BEFORE, AFTER_CHANGED).why;
  assert.match(moved, /the same 2 key\(s\) are declared, so a value changed/);
  assert.ok(!/PORTAL_SECRET/.test(moved),
    "it named the key whose value moved, which is one step from naming the value");
});

test("tracker issue 182 the key reader does not mistake a comment or a blank line for a key", () => {
  assert.deepEqual(keysIn("# only a comment\n\n   \n"), []);
  assert.deepEqual(keysIn("A=1\n# B=2\nC = 3\n"), ["A", "C"]);
  assert.deepEqual(keysIn(null), []);
});

test("tracker issue 182 the arm this was built for no longer renders the file it snapshots", () => {
  // The instance, joined to the class: the call site must be reading through this module rather than
  // comparing two file contents with an assertion that prints them.
  const src = readFileSync(join(HERE, "start-command.test.mjs"), "utf8");
  const executable = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(executable, /from "\.\/secret-file-compare\.mjs"/,
    "start-command.test.mjs no longer reads the repo's .env through the comparison that keeps it out of the log");
  assert.ok(!/assert\.equal\(\s*envAfter\s*,\s*envBefore/.test(executable),
    "the assertion that renders both file contents is back — it prints the repository's .env into a public CI log");
});
