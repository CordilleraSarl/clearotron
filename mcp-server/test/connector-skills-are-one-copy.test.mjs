// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE THREE CONNECTOR SKILLS ARE ONE FILE EACH, AND THE SERVER READS THAT FILE.
//
// A Claude Code plugin installs skills from a `skills/` directory; the server briefs a connecting
// principal from the same text at `initialize`. Two places, one need. Copying with a byte-identity
// guard was ruled first and refused by its own fork condition: a skill is DISCOVERED through YAML
// frontmatter, the packs carried none, so the copies could never be byte-identical and the guard would
// have been an approximation of one. So the text MOVED, and these arms hold the move honest:
//
//   · the plugin can find them          — frontmatter with a name and a description, name = directory
//   · the server still serves them      — every audience gets its own pack, not a fallback
//   · the packaging never reaches a client — the frontmatter is stripped before briefing
//   · no second copy came back          — packs/ holds no SKILL.md to drift against
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { instructionsFor, stripFrontmatter } from "../lib/instructions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(ROOT, "skills");
const DIRS = ["clearotron-client", "clearotron-account", "clearotron-ops"];

test("#766 each connector skill is discoverable: frontmatter, a name that matches its directory, a description", () => {
  for (const d of DIRS) {
    const p = join(SKILLS, d, "SKILL.md");
    assert.ok(existsSync(p), `${d}/SKILL.md is missing — the plugin installs nothing for that audience`);
    const src = readFileSync(p, "utf8");
    assert.ok(src.startsWith("---\n"), `${d} lost its frontmatter — a skill without it is not discovered at all`);
    const end = src.indexOf("\n---", 4);
    assert.notEqual(end, -1, `${d}'s frontmatter block is unterminated`);
    const front = src.slice(4, end);
    assert.match(front, new RegExp(`^name: ${d}$`, "m"), `${d}'s name must match its directory`);
    const desc = /^description: (.+)$/m.exec(front);
    assert.ok(desc, `${d} has no description — nothing tells the host when to use it`);
    assert.ok(desc[1].length > 40, `${d}'s description is too thin to route on: ${desc[1]}`);
  }
});

test("#766 the plugin manifest exists and is the thing that makes them install as one unit", () => {
  const p = join(ROOT, ".claude-plugin", "plugin.json");
  assert.ok(existsSync(p), ".claude-plugin/plugin.json is gone — the three packs go back to being copied by hand");
  const j = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(j.name, "clearotron");
  assert.ok(j.description?.length > 30, "a plugin nobody can tell apart from another is not installable in practice");
  assert.equal(j.license, "AGPL-3.0-only", "the plugin must state the licence the repository ships under");
  // The skills it ships are the directory, not a list to keep in step — but the directory must not be empty.
  assert.ok(readdirSync(SKILLS).length >= DIRS.length, "skills/ lost a member the plugin was shipping");
});

test("#766 the server briefs from the SAME file, and each audience gets its OWN pack", () => {
  const client = instructionsFor({ kind: "user" });
  const account = instructionsFor({ kind: "account" });
  assert.ok(client && account, "a connecting principal is no longer briefed at all");
  const onDisk = (d) => stripFrontmatter(readFileSync(join(SKILLS, d, "SKILL.md"), "utf8")).trim();
  assert.equal(client, onDisk("clearotron-client"), "the client briefing is not the file in skills/");
  assert.equal(account, onDisk("clearotron-account"), "the account briefing is not the file in skills/");
  assert.notEqual(client, account, "both audiences got the same pack — the account one would be told "
    + "that commissioning a search is out of scope, which is the tool it holds");
  // OPS NOW GETS ITS OWN PACK (, owner ruling 7), which is this arm's own principle
  // rather than an exception to it: on a self-hosted install the customer IS ops, connects over this
  // connector, and was briefed with nothing while skills/clearotron-ops/SKILL.md shipped and SKILL_DIR
  // mapped it. Asserted the same way as the other two — against the files on disk, so "briefed" and
  // "briefed with the right file" stay one claim.
  const ops = instructionsFor({ kind: "ops" });
  assert.ok(ops, "ops is briefed with nothing while its pack ships");
  assert.notEqual(ops, client, "ops got the report-link pack — a surface it is not on");
  assert.notEqual(ops, account, "ops got the account pack — it holds engineering verbs, not a client's");

  // ── AN OPS PACK IS MORE THAN ONE FILE (tracker issue 148) ──────────────────────────────────────
  //
  // Held to COMPOSITION rather than to equality with SKILL.md. This is the same claim it always was —
  // the briefing is the files in skills/, and carries no text of its own — but the ops SKILL.md tells
  // the assistant twice to read COURIER.md, and serving SKILL.md alone pointed both references at
  // nothing. The assistant driving it reported "a suspicious reference to a nonexistent skill".
  //
  // DERIVED FROM THE DIRECTORY, NOT FROM THE SERVER'S OWN LIST. Reading `PACK_EXTRAS` here would make
  // this arm agree with the code it checks, and a file added to skills/clearotron-ops/ that the server
  // never serves — the exact shape of the defect 148 reported — would pass.
  const opsDir = join(SKILLS, "clearotron-ops");
  const opsFiles = readdirSync(opsDir).filter((f) => f.endsWith(".md")).sort();
  assert.ok(opsFiles.length > 1,
    "skills/clearotron-ops/ is down to one file, so this arm no longer checks composition at all — if "
    + "COURIER.md was removed on purpose, the two references to it in SKILL.md went with it");
  const opsTexts = opsFiles.map((f) => stripFrontmatter(readFileSync(join(opsDir, f), "utf8")).trim());

  // SKILL.md leads — it is the briefing, and the extras are appended to it.
  assert.ok(ops.startsWith(onDisk("clearotron-ops")),
    "the ops briefing does not open with skills/clearotron-ops/SKILL.md");
  for (const [i, text] of opsTexts.entries()) {
    assert.ok(ops.includes(text),
      `skills/clearotron-ops/${opsFiles[i]} ships but is not in the ops briefing — an assistant told to `
      + `read it still has no way to`);
  }
  // …AND NOTHING ELSE. `startsWith` and `includes` both pass on a pack carrying invented text between
  // the files, which is the second copy of doctrine this whole file exists to prevent. Length closes
  // it, and unlike a full equality it does not pin the order the server appends them in.
  assert.equal(ops.length, opsTexts.join("\n\n").length,
    "the ops briefing is longer or shorter than the files it is composed from, so it carries text that "
    + "is in no file in skills/clearotron-ops/ — a second copy of doctrine by another name");
});

test("#766 the frontmatter is STRIPPED before briefing — packaging must not reach a client's assistant", () => {
  for (const kind of ["user", "account"]) {
    const text = instructionsFor({ kind });
    assert.doesNotMatch(text, /^---/, `${kind}'s briefing opens with frontmatter`);
    assert.doesNotMatch(text, /^name: clearotron-/m, `${kind}'s briefing carries the skill's name: line`);
    assert.doesNotMatch(text, /^description: /m, `${kind}'s briefing carries the skill's description: line`);
    assert.match(text, /^# /, `${kind}'s briefing should now open with the pack's own heading`);
  }
  // The helper itself, on the shapes that are not frontmatter and must survive untouched.
  assert.equal(stripFrontmatter("# heading\n\nbody"), "# heading\n\nbody", "a file with no frontmatter was altered");
  assert.equal(stripFrontmatter("---\nname: x\n---\n\n# h"), "# h");
  assert.equal(stripFrontmatter("---\nunterminated\n"), "---\nunterminated\n", "an unterminated block is not frontmatter");
});

test("#766 no second copy came back — packs/ holds no SKILL.md to drift against", () => {
  // The whole reason the text moved instead of being copied. A SKILL.md reappearing under packs/ is a
  // second source of doctrine that nothing compares, which is the state this replaced.
  const packs = join(ROOT, "mcp-server", "packs");
  for (const p of readdirSync(packs, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    assert.equal(existsSync(join(packs, p.name, "SKILL.md")), false,
      `mcp-server/packs/${p.name}/SKILL.md is back — there are two copies of this pack's doctrine now, `
      + `and nothing in the build compares them`);
  }
});
