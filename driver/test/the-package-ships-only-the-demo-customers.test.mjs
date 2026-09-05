// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 94, finding F13 — a stranger's roster is the two accounts meant for them.
//
// `driver/profiles/` holds the customer accounts the engine loads, and three of its files —
// `aurora`, `zephyr`, `petcary` — are the renamed identities the suite uses as fixtures. They are not
// customers, and they are not demos: the owner, driving the portal, opened the roster and found three
// company names he did not recognise offered as brand owners he could run a clearance for.
//
// The suite still needs them, so they stay in the repository and leave the PACKAGE. That is a
// `files[]` decision, and `files[]` is exactly the kind of list that is edited for one reason and
// quietly changes another: a later `!**/fixtures/` or a reordering can put them back with nothing
// saying so.
//
// SO THIS ASKS NPM, rather than reading the list and reasoning about it. `npm pack --dry-run --json`
// returns the file set npm would put in the tarball, computed by the code that packs it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

/** Account files a reader who installed this package is meant to find. */
const SHIPPED_ACCOUNTS = Object.freeze(["demo-brand-owner.json", "generic.json"]);

/** Fixture identities that must never reach a reader as accounts they could run a clearance for. */
const FIXTURES_ONLY = Object.freeze(["aurora", "zephyr", "petcary"]);

test("94/F13 the package's customer roster is the two accounts a reader is meant to see", { timeout: 120_000 }, () => {
  // `npm_config_offline` because this resolves entirely on disk: npm otherwise reaches for a registry it
  // does not need, and that reach can BLOCK rather than fail.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, npm_config_offline: "true" } });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  // AN EMPTY FILE LIST WOULD SATISFY EVERY ASSERTION BELOW. npm printing nothing, or printing its
  // manifest to stderr where this cannot see it, is a could-not-look and not a clean roster.
  nonEmpty(files, "the packed file list");

  const accounts = files
    .filter((p) => p.startsWith("driver/profiles/") && !p.includes("/projects/") && p !== "driver/profiles/README.md")
    .map((p) => p.slice("driver/profiles/".length))
    .sort();
  assert.deepEqual(accounts, [...SHIPPED_ACCOUNTS].sort(),
    "the package's customer roster is not the two accounts it is meant to carry");

  // AND NOWHERE ELSE IN THE PACKAGE, because the accounts are not the only place these names are a
  // path. `driver/recipes/aurora/` and `driver/recipes/zephyr/` ship saved searches under the same
  // identities, and the context markdown and the saved projects travel by different `files[]` patterns
  // again — three shapes, one class, and checking only the account files would have shipped two of them.
  // Path segments only: the shipped source discusses these fixtures in comments, which is prose about
  // the suite rather than something a reader is offered.
  for (const name of FIXTURES_ONLY) {
    const leaked = files.filter((p) => p.split("/").some((seg) => seg === name || seg.startsWith(`${name}.`)));
    assert.deepEqual(leaked, [], `the package still carries ${name}: ${leaked.join(", ")}`);
  }

  // The two that DO ship are proved present rather than inferred from the absence of the others.
  for (const name of SHIPPED_ACCOUNTS) {
    assert.ok(files.includes(`driver/profiles/${name}`), `the package does not carry ${name}, so a reader has no account at all`);
  }
});


test("94/F13 and the artifact itself carries none of them", { timeout: 300_000 }, () => {
  // THE ARM ABOVE ASKS NPM WHAT IT WOULD PACK. This one packs. The three exclusions are three separate
  // `files[]` patterns — the accounts, the saved projects, the saved search recipes — and nothing
  // compares them to each other; the only thing that can say whether all three held is the tarball a
  // reader downloads. A dry run and a pack agreeing is worth having as two measurements; a dry run
  // alone is a claim about the intent of a list.
  const out = mkdtempSync(join(tmpdir(), "roster-pack-"));
  try {
    execFileSync("npm", ["pack", "--pack-destination", out],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, npm_config_offline: "true" } });
    const tarballs = readdirSync(out).filter((f) => f.endsWith(".tgz"));
    assert.equal(tarballs.length, 1, `expected exactly one tarball, got: ${tarballs.join(", ") || "none"}`);
    const entries = execFileSync("tar", ["-tzf", join(out, tarballs[0])], { encoding: "utf8" })
      .split("\n").filter(Boolean).map((p) => p.replace(/^package\//, ""));
    // A TARBALL THAT LISTED NOTHING WOULD SATISFY EVERY LINE BELOW.
    nonEmpty(entries, "the entries in the packed tarball");

    for (const name of FIXTURES_ONLY) {
      const leaked = entries.filter((p) => p.split("/").some((seg) => seg === name || seg.startsWith(`${name}.`)));
      assert.deepEqual(leaked, [], `the tarball a reader downloads carries ${name}: ${leaked.join(", ")}`);
    }
    for (const name of SHIPPED_ACCOUNTS) {
      assert.ok(entries.includes(`driver/profiles/${name}`), `the tarball does not carry ${name}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
