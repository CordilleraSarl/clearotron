// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tracker issues 1861 (criterion 4) and 1882 — EVERY VERB ANSWERS --help, AND ANSWERS WITH HELP.
//
// Three verbs answered `--help` with an error or with the middle of their own reasoning block. Four
// others answered with their LICENCE HEADER as the first line:
//
//     $ npx clearotron doctor --help
//     SPDX-License-Identifier: AGPL-3.0-only
//
// The first thing a first-time installer saw, from the verb the install document tells them to run
// first. Both were found by RUNNING the verbs, and neither was visible in the source: the four that
// leaked print their help from a document window at the top of the file, and the top of a file is its
// licence header.
//
// ══ THIS ARM SPAWNS. IT DOES NOT READ SOURCE. ══
//
// Reading the dispatcher would prove that a help path is wired, which is not the question — `update`
// had one and printed prose from the middle of a comment block. What an operator gets is what the
// process prints, so that is what is asserted.
//
// ══ AND THE VERB LIST IS THE DISPATCHER'S OWN ══
//
// Enumerated from the registry the dispatcher prints for a bare `clearotron --help`, never typed here.
// A verb added tomorrow arrives in this arm on the day it is added; a typed list would cover the nine
// that existed when someone last looked, which is how both of these defects survived.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { usageBlock } from "../../shared/usage-block.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO, "bin", "clearotron.mjs");

const { SUMMARY } = await import(join(REPO, "bin", "clearotron.mjs"));
const VERB_NAMES = Object.keys(SUMMARY ?? {});

// BOTH STREAMS, kept apart. What an operator SEES is stdout+stderr, and which stream carried it is
// itself a question — `grant` printed its help to stderr alone among nine, so `--help | less` was
// empty. Capturing only stdout would have read that as a verb with no help at all, which is a different
// defect with a different fix.
const help = (verb) => {
  const opts = { encoding: "utf8", timeout: 60_000,
    env: { ...process.env, CLEAROTRON_NO_ENV_FILE: "1", CLEAROTRON_NO_ENV_FILE: "1" } };
  try {
    const r = execFileSync(process.execPath, [CLI, verb, "--help"], { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: String(r ?? ""), stderr: "", out: String(r ?? "") };
  } catch (e) {
    const so = String(e.stdout ?? ""), se = String(e.stderr ?? "");
    return { code: e.status ?? -1, stdout: so, stderr: se, out: so + se };
  }
};
const firstReal = (out) => (out.split("\n").find((l) => l.trim() !== "") ?? "").trim();

test("the verb list comes from the dispatcher and is not empty", () => {
  assert.ok(VERB_NAMES.length >= 5,
    `only ${VERB_NAMES.length} verb(s) enumerated. If this list is empty every arm below passes over `
    + "nothing, which is the shape of a guard that has quietly stopped guarding.");
});

test("tracker issue 1861 every verb EXITS 0 for --help", () => {
  const bad = [];
  for (const v of VERB_NAMES) { const r = help(v); if (r.code !== 0) bad.push(`${v} → exit ${r.code}: ${firstReal(r.out).slice(0, 70)}`); }
  assert.deepEqual(bad, [],
    "a verb treated --help as an error. `--help` is the flag every other verb accepts, and the two that "
    + "failed it are the two that SPEND — the one place a reader most needs to look before running.");
});

test("tracker issue 1861 every verb's --help prints a USAGE line naming that verb", () => {
  const bad = [];
  for (const v of VERB_NAMES) {
    const { out } = help(v);
    // Its own name, in an invocation. `update` printed the middle of its reasoning block — real prose,
    // no synopsis — so "it printed something" is not the check.
    if (!new RegExp(`clearotron\\s+${v}\\b`).test(out)) bad.push(`${v} → no invocation line: ${firstReal(out).slice(0, 60)}`);
  }
  assert.deepEqual(bad, [], "a verb printed something that is not help for that verb");
});

// ── ───────────────────────────────────────────────────────────────────────────
test("no verb answers --help with its licence header", () => {
  const bad = [];
  for (const v of VERB_NAMES) {
    const first = firstReal(help(v).out);
    if (/^(SPDX-License-Identifier|Copyright)\b/i.test(first)) bad.push(`${v} → ${first.slice(0, 60)}`);
  }
  assert.deepEqual(bad, [],
    "a verb leads its help with a licence identifier. This is the class that SPREADS: any verb whose "
    + "help is printed from a window at the top of its own file inherits it, and nothing checked. Four "
    + "verbs carried it, including the one the install document tells a new user to run first.");
});

test("tracker issue 1861 --help goes to STDOUT — help you cannot pipe is help you cannot read", () => {
  // One verb of nine printed its help to stderr. `clearotron grant --help | less` showed nothing, and
  // neither did any redirect a reader would reach for. The exit code already says whether this is help
  // or a refusal, so it decides the stream.
  const bad = [];
  for (const v of VERB_NAMES) {
    const r = help(v);
    if (r.stdout.trim() === "" && r.stderr.trim() !== "") bad.push(`${v} → help only on stderr`);
  }
  assert.deepEqual(bad, [], "a verb answers --help on stderr, so piping or redirecting it yields nothing");
});

test("the synopsis reader itself skips the licence header and stops at the synopsis", () => {
  // The four that leaked all read a window out of their own source. One reader now, so the fix cannot
  // be applied to three files and missed on the fourth — and the reader is held here directly.

  const withHeader = [
    "#!/usr/bin/env node",
    "// SPDX-License-Identifier: AGPL-3.0-only",
    "// Copyright 2026 Cordillera Sàrl",
    "// thing — what it is",
    "//",
    "//   npx clearotron thing        do the thing",
    "//",
    "// DESIGN NOTES",
    "// not the synopsis",
  ].join("\n");
  const block = usageBlock(withHeader);
  assert.doesNotMatch(block, /SPDX|Copyright/, "the licence header reached the synopsis");
  assert.match(block, /npx clearotron thing/, "the command line was dropped");
  assert.doesNotMatch(block, /DESIGN NOTES/, "the reader ran past the synopsis into the file's notes");
  assert.match(block.split("\n")[0], /^thing —/, "the synopsis must START at the description");
});
