// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NOTE THE RELEASE REFUSES IS REFUSED ON ITS OWN PULL REQUEST. The lint reads each note on the pull request
// that adds it; the release reads the assembled changelog after the merge. They held two sets of line rules,
// and the release's refused "a yes/no question", which the lint had passed, so main's Release went red once
// the note merged (2026-09-10). They share one set now; this feeds the same notes to both and requires the
// same answer, so the two cannot drift apart again without a red here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findings as lint, notePaths, bodyOf } from "../../scripts/release-notes-lint.mjs";
import { findings as release } from "../../scripts/changelog-plain-language.mjs";

const note = (body) => `---\n"clearotron-driver": patch\n---\n\n${body}\n`;
/** What the release reads: the sentence as a changelog bullet, its group moved into the heading above it. */
const asBullet = (body) => `- ${body.replace(/^(Before you upgrade|New|Fixed|For operators):\s*/, "")}`;

const TABLE = [
  ["Fixed: A key pasted at a yes/no question in setup is never shown on screen.", false],
  ["Fixed: The demo accepts a knockout and/or a clearance without complaint.", false],
  ["Fixed: Settings now live in `~/.config/clearotron/` and survive an upgrade.", false],
  ["Fixed: A clearance now says which registers it searched.", false],
  ["New: `clearotron framework <your-framework.md>` reads a framework you wrote and says what it declares.", false],
  ["Fixed: The walk in driver/engine now covers everything.", true],
  ["Fixed: release-version.mjs writes it now.", true],
  ["Fixed: The steps are in INSTALL.md now.", true],
  ["For operators: Runs are kept in /var/lib/clearotron/pool now.", true],
  ["Fixed: Refactored the queue so that it drains.", true],
  ["Fixed: The report now calls parseVerdict() first.", true],
];

test("the lint and the release give each note the same answer", () => {
  for (const [body, refused] of TABLE) {
    assert.equal(release(asBullet(body)).length > 0, refused, `the release's answer on "${body}"`);
    assert.equal(lint(note(body)).length > 0, refused, `the lint's answer on "${body}" is not the release's`);
  }
});

test("every note in the tree that the release would refuse, the lint refuses too", (ctx) => {
  const paths = notePaths();
  if (!paths.length) return ctx.skip("no notes under .changeset/ in this tree: the version step has consumed them");
  for (const p of paths) {
    const text = readFileSync(p, "utf8");
    const bullets = bodyOf(text).split("\n").map((l) => l.replace(/^(Before you upgrade|New|Fixed|For operators):\s*/, "")).join("\n");
    if (release(bullets).length) assert.ok(lint(text).length, `${p}: the release refuses it, and the lint passes it`);
  }
});
