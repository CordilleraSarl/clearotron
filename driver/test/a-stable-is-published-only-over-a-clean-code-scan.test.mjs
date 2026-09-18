// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A stable is published only over a clean code scan.
//
// An integration merge landed with the code-scanning check red, because nothing stopped on it. The owner
// ruled that a stable waits for a completed analysis of the commit it publishes, with no alert open, and
// has no override. The verdict is pure and read first; then the command is driven through a stub `gh`,
// once per way the API can answer.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict } from "../../scripts/release-code-scanning-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(ROOT, "scripts", "release-code-scanning-check.mjs");
const SHA = "a".repeat(40), OTHER = "b".repeat(40);
const JS = "/language:javascript-typescript", ACTIONS = "/language:actions";
const DIR = mkdtempSync(join(tmpdir(), "codescan-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const an = (commit_sha, category, extra = {}) => ({ commit_sha, category, ...extra });
const alert = (number, id, path, start_line) => ({ number, rule: { id }, most_recent_instance: { location: { path, start_line } } });

test("PURE: every category analysed at this commit and nothing open is clean", () => {
  assert.equal(verdict({ sha: SHA, analyses: [an(SHA, JS), an(SHA, ACTIONS)], open: [] }).state, "clean");
});

test("PURE: an open alert refuses, and a category not yet analysed at this commit waits", () => {
  assert.equal(verdict({ sha: SHA, analyses: [an(SHA, JS), an(SHA, ACTIONS)], open: [alert(1, "js/x", "a.mjs", 3)] }).state, "open");
  assert.equal(verdict({ sha: SHA, analyses: [an(SHA, ACTIONS), an(OTHER, JS)], open: [] }).state, "waiting",
    "the code's own language not yet read at this commit is a verdict nobody reached");
  assert.equal(verdict({ sha: SHA, analyses: [], open: [] }).state, "waiting");
});

test("PURE: a branch that moved past the commit, or an analysis that errored, refuses", () => {
  assert.equal(verdict({ sha: SHA, analyses: [an(OTHER, JS), an(SHA, JS)], open: [] }).state, "moved",
    "the open list describes the newer tree, not the one being published");
  assert.equal(verdict({ sha: SHA, analyses: [an(SHA, JS, { error: "extraction failed" })], open: [] }).state, "failed");
});

/**
 * A stub `gh` that answers the analyses call from a list of pages — the Nth call gets the Nth page, the
 * last repeating — and the alerts call with `open`, one element per line as `--jq '.[]'` prints it.
 */
function drive({ analysesPages, open = [], refuse = false, timeout = "2", interval = "0.2", sha = SHA }) {
  const dir = mkdtempSync(join(DIR, "run-"));
  const bin = join(dir, "bin"); mkdirSync(bin);
  writeFileSync(join(dir, "pages.json"), JSON.stringify(analysesPages));
  writeFileSync(join(dir, "open.json"), JSON.stringify(open));
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs"); const path = require("path"); const d = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
if (${refuse}) { process.stderr.write("HTTP 403: Resource not accessible by integration\\n"); process.exit(1); }
const url = args[args.length - 1];
if (url.includes("/code-scanning/analyses")) {
  const pages = JSON.parse(fs.readFileSync(path.join(d, "pages.json"), "utf8"));
  const n = fs.existsSync(path.join(d, "n")) ? Number(fs.readFileSync(path.join(d, "n"), "utf8")) : 0;
  fs.writeFileSync(path.join(d, "n"), String(n + 1));
  process.stdout.write(JSON.stringify(pages[Math.min(n, pages.length - 1)]));
} else if (url.includes("/code-scanning/alerts")) {
  for (const a of JSON.parse(fs.readFileSync(path.join(d, "open.json"), "utf8"))) process.stdout.write(JSON.stringify(a) + "\\n");
}
`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [CHECK, "--sha", sha, "--repo", "Owner/name", "--timeout", timeout, "--interval", interval],
    { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("a commit analysed in every category with nothing open passes", () => {
  const r = drive({ analysesPages: [[an(SHA, JS), an(SHA, ACTIONS)]] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no alert open/);
});

test("open alerts refuse the stable, and each is named by number, rule and place", () => {
  const r = drive({ analysesPages: [[an(SHA, JS)]], open: [alert(70, "js/incomplete-sanitization", "driver/x.mjs", 182)] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /#70\s+js\/incomplete-sanitization\s+driver\/x\.mjs:182/);
  assert.match(r.out, /dismiss it on the alert with a written reason/, "the refusal does not say how it is lifted");
});

test("an analysis that arrives late is waited for, not refused", () => {
  const r = drive({ analysesPages: [[an(OTHER, JS)], [an(OTHER, JS)], [an(SHA, JS)]] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no analysis of aaaaaaaa yet/, "the looks that found no analysis are not reported");
});

test("an analysis that never arrives within the bound refuses — a verdict nobody reached is not clean", () => {
  const r = drive({ analysesPages: [[an(OTHER, JS)]], timeout: "1" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /not published/);
});

test("a branch that moved past the commit refuses rather than answer about another tree", () => {
  const r = drive({ analysesPages: [[an(OTHER, JS), an(SHA, JS)]] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /another commit/);
});

test("an API that refuses, or arguments that are incomplete, is could-not-look — never clean", () => {
  assert.equal(drive({ analysesPages: [[an(SHA, JS)]], refuse: true }).code, 2);
  assert.equal(drive({ analysesPages: [[an(SHA, JS)]], sha: "abc123" }).code, 2, "an abbreviated commit is refused");
});
