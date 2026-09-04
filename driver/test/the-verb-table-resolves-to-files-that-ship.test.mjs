// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Fast tier: reads two files off disk. No pack, no install, no network.
//
// — A HARDCODED TABLE THAT NOBODY CHECKS GOES STALE IN THE DIRECTION THAT CANNOT FAIL.
//
// `bin/clearotron.mjs` maps a verb to a file and forwards argv unchanged. The dispatcher implements
// nothing, which is the point — `bin/onboard.mjs` validates each credential against the live service
// and has been hardened through, and a dispatcher that re-checked any of
// that would be a second, weaker copy. But a table that names a file has exactly one way to rot: the
// file is renamed or dropped from the package, and the only symptom is a stranger typing a command
// that does not work. There is no failing build in between.
//
// The dispatcher DOES report an absent target as a packaging defect at exit 70 rather than as a user
// error. That is the right runtime behaviour and it is not a substitute for this: it fires on the
// stranger's machine, after they have installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VERBS, SUMMARY, NOT_VERBS, ROOT } from "../../bin/clearotron.mjs";

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("#1725 every verb resolves to a file that is actually on disk", () => {
  const verbs = Object.keys(VERBS);
  assert.ok(verbs.length >= 8, `the verb table collapsed to ${verbs.length} — an empty table passes every other arm here`);
  const missing = verbs.filter((v) => !existsSync(join(ROOT, VERBS[v][0])));
  assert.deepEqual(missing, [],
    `these verbs name a file that does not exist: ${missing.map((v) => `${v} -> ${VERBS[v][0]}`).join(", ")}\n`
    + "  A renamed file is the whole failure mode: nothing breaks until a stranger types the verb.");
});

test("#1725 every verb has a one-line summary, and every summary has a verb", () => {
  // --help is derived from these two objects. A verb with no summary prints a blank line next to its
  // name; a summary with no verb advertises something that cannot be run.
  assert.deepEqual(Object.keys(VERBS).filter((v) => !SUMMARY[v]), [], "verb with no summary");
  assert.deepEqual(Object.keys(SUMMARY).filter((v) => !VERBS[v]), [], "summary with no verb");
});

test("#1725 every verb's file is inside the package's `files` allowlist", () => {
  // THE FAILURE THIS CATCHES is the one the runtime check cannot: the file exists in the repo, the
  // suite is green, and `files` simply does not carry its directory — so the verb works for everyone
  // with a checkout and for nobody who installed the package.
  //
  // This is a PREFIX check against the allowlist, not npm's own globbing, so it is deliberately the
  // weaker of the two guards. The end-to-end one is CI's pack-and-install, which types the verbs at a
  // tree with no checkout; this arm exists to fail in seconds rather than at the end of a pack.
  const allow = (manifest.files ?? []).filter((f) => !f.startsWith("!"));
  assert.ok(allow.length, "package.json has no `files` allowlist — then this arm is checking nothing");
  const uncovered = Object.entries(VERBS)
    .filter(([, [rel]]) => !allow.some((a) => rel === a || rel.startsWith(a.endsWith("/") ? a : `${a}/`)))
    .map(([v, [rel]]) => `${v} -> ${rel}`);
  assert.deepEqual(uncovered, [],
    `these verbs resolve to files the package does not ship: ${uncovered.join(", ")}\n`
    + "  Add the directory to `files` in package.json, or the verb is a promise only a checkout can keep.");
});

test("#1725 the package declares the dispatcher as its command", () => {
  assert.equal(manifest.bin?.clearotron, "bin/clearotron.mjs",
    "the `bin` field is what makes `clearotron` and `npx clearotron` resolve at all");
  assert.ok(existsSync(join(ROOT, manifest.bin.clearotron)), "the declared bin does not exist");
});

// ──: THE LIST IS DERIVED FROM DISK, EVEN THOUGH THE PROSE IS NOT ──────────────────────────────
//
// asks for the verb list to come from what is on disk rather than being hardcoded. Summaries
// cannot be derived — nobody writes a line of prose by walking a directory — so what is derived is the
// COMPLETENESS: every runnable entry point in bin/ must be reachable through the one command, or be
// named as deliberately unreachable with a reason. That closes the gap the requirement is about.
test("#1719 every runnable entry point in bin/ is a verb, or is declared as deliberately not one", () => {
  const onDisk = readdirSync(join(ROOT, "bin")).filter((f) => f.endsWith(".mjs"));
  assert.ok(onDisk.length >= 6, `bin/ produced ${onDisk.length} entry points — too few for this to be scanning anything`);

  const reached = new Set(Object.values(VERBS)
    .map(([rel]) => rel)
    .filter((rel) => rel.startsWith("bin/"))
    .map((rel) => rel.slice("bin/".length)));

  const unaccounted = onDisk.filter((f) => !reached.has(f) && !Object.hasOwn(NOT_VERBS, f));
  assert.deepEqual(unaccounted, [],
    `these are runnable and the one command cannot reach them: ${unaccounted.join(", ")}\n`
    + "  Either give it a verb, or add it to NOT_VERBS with the reason it is not one.\n"
    + "  A runnable file nobody can name is the gap #1719 exists to close.");
});

test("#1719 a NOT_VERBS entry that no longer matches a file is deleted, not carried", () => {
  // The dead-names discipline. An exemption list that outlives its subjects grows until it exempts
  // something real by accident, and nothing fails while it happens.
  const onDisk = new Set(readdirSync(join(ROOT, "bin")).filter((f) => f.endsWith(".mjs")));
  const stale = Object.keys(NOT_VERBS).filter((f) => !onDisk.has(f));
  assert.deepEqual(stale, [], `NOT_VERBS names files that are gone: ${stale.join(", ")}`);
  for (const [f, why] of Object.entries(NOT_VERBS))
    assert.ok(String(why).length > 20, `NOT_VERBS["${f}"] must say WHY, not just be present`);
});
