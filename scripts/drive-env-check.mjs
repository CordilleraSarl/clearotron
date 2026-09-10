#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// drive-env-check.mjs — a test that drives a real command must decide what environment it drives it in.
//
// ── THE FAILURE THIS IS ABOUT ────────────────────────────────────────────────────────────────────────
//
// A test that drives a real command and expects that command's `.env` to configure it gets the BUILT-IN
// DEFAULTS instead, silently, including default PORTS. Two independent mechanisms produce it and a drive
// has to defeat both:
//
//   1. `scripts/test-run.mjs` sets `CLEAROTRON_NO_ENV_FILE=1` for every child of the suite. Correct on
//      its own terms — no test should be configured by a file on the developer's box.
//   2. `INVOCATION_ID` is INHERITED by every descendant of a systemd unit, and `shared/env-local.mjs`
//      reads it as "started as a service, configured by the EnvironmentFile". A hosted CI runner's job
//      is a descendant of the runner agent's unit, so it is set there and unset on a developer box.
//
// The failure is not that such a test fails. It is that it PASSES ON THE WRONG SUBJECT, and the number
// it lands on is a real address: an arm written to drive a port collision held a free high port, wrote
// it to the drive's `.env`, and measured a collision with whatever holds the BUILT-IN default on the
// machine running the suite — on a shared development box, another live install's portal. Green
// locally for the wrong reason, red on CI for a third reason again.
//
// ── WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────────────
//
// It checks that a file in the class NAMES BOTH VARIABLES, or takes its environment from the one helper
// that handles them. That is a prompt to decide, not a proof of correctness: a file could name both and
// still get a drive wrong, and this cannot see it. What it CAN see is the state that produced the
// defect — a drive that never considered the question at all — and that state is unreachable once a
// file has had to write both names down.
//
// ✕ IT DOES NOT DEMAND THEY BE DELETED. An arm ABOUT the service-managed path must set INVOCATION_ID
// back, and an arm about the opt-out must set CLEAROTRON_NO_ENV_FILE back. A guard that demanded
// deletion would refuse the two arms most worth having.
//
// ✕ AND IT DOES NOT TRY TO WORK OUT WHETHER A DRIVE INHERITS. A version of this did — a file that
// composes its child environment from scratch cannot carry either variable, and flagging it would
// manufacture work — and reading that off source text meant deciding where one call's options end. It
// produced three classes of false answer in one run: `git` calls counted as product drives, the words
// `spawn(` inside a string counted as calls, and a real drive whose `env:` sat past the window counted
// as inheriting. A heuristic that needs a character count to be right is not evidence, and it argued
// against the sentence above it. So the question stayed the simple one, and a file that is safe by
// construction says so in a line naming both — which is a decision recorded, not a guard worked around.
//
// ── THE CLASS IS BOUNDED, AND MEASURED RATHER THAN ASSUMED ───────────────────────────────────────────
//
// A file is in it when it BOTH writes a file the driven process would read as its own configuration —
// `envLocalPath()`'s two locations, `<repo>/.env` and `~/.config/clearotron/.env`, and NOT `~/.env`,
// which is the units' EnvironmentFile and is not read by env-local at all — AND spawns something under
// `bin/`. Neither half alone is the hazard: 72 files in this suite spawn something, and a blanket rule
// over them would red about 62 that have no `.env` in the question and manufacture the work of
// exempting them.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = join(ROOT, "driver", "test");

/** The two variables, and the helper that is allowed to stand in for naming them. */
export const BOTH = ["CLEAROTRON_NO_ENV_FILE", "INVOCATION_ID"];
export const HELPER = "handRunEnv";

/** The two spellings of a path `envLocalPath()` resolves to, as a test writes them. */
const ENV_LOCAL_EXPR = /(?:["']\.config["']\s*,\s*["']clearotron["']\s*,\s*["']\.env["']|\.config\/clearotron\/\.env|\b(?:REPO|ROOT|repoRoot|repoDir)\s*,\s*["']\.env["'])/;

/**
 * Does this source WRITE a file the driven process would read as its own configuration?
 *
 * A WRITE, not a mention — and that distinction is the whole precision of this check. `start-command`
 * names `join(REPO, ".env")` three times to SNAPSHOT it, precisely so it can assert that a refusal wrote
 * nothing; a rule that matched the path anywhere pulled that file into the class and would have had its
 * author neutralise variables for a drive that has no `.env` in the question at all.
 *
 * `~/.env` is deliberately not here either: that is the units' EnvironmentFile, `shared/env-local.mjs`
 * never reads it, and a test writing it is exposed to neither mechanism.
 *
 * Two shapes, because tests use both: the path inline in the call, and the common
 * `const envPath = join(REPO, ".env")` followed by `writeFileSync(envPath, …)`.
 *
 * THE FIRST ARGUMENT IS READ WITH THE PARENTHESES COUNTED, not split on the first comma. Splitting
 * gave `join(home` for `writeFileSync(join(home, ".config", "clearotron", ".env"), …)` — so the one
 * shape most of this class is written in read as no write at all, and three files silently left the
 * class. A guard is at its most dangerous when its subject shrinks quietly.
 */
export function firstArg(src, openParen) {
  let depth = 0, quote = null;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return src.slice(openParen + 1, i); }
    else if (c === "," && depth === 1) return src.slice(openParen + 1, i);
  }
  return "";
}

export function writesAnEnvLocalFile(src) {
  for (const m of src.matchAll(/\bwriteFileSync\s*\(/g)) {
    const arg = firstArg(src, m.index + m[0].length - 1).trim();
    if (ENV_LOCAL_EXPR.test(arg)) return true;
    if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      const decl = new RegExp(`\\b(?:const|let|var)\\s+${arg}\\s*=\\s*([^;\n]+)`);
      const d = decl.exec(src);
      if (d && ENV_LOCAL_EXPR.test(d[1])) return true;
    }
  }
  return false;
}

/** Does it spawn a product entry point? */
export function spawnsAnEntryPoint(src) {
  if (!/\b(?:spawnSync|execFileSync|spawn)\s*\(/.test(src)) return false;
  return /["']bin["']\s*,\s*["'][A-Za-z0-9._-]+\.mjs["']/.test(src) || /\bbin\/[A-Za-z0-9._-]+\.mjs\b/.test(src);
}

/** Has this file decided the question — named both variables, or taken the helper that does? */
export function decides(src) {
  if (new RegExp(`\\b${HELPER}\\s*\\(`).test(src)) return true;
  return BOTH.every((name) => new RegExp(`\\b${name}\\b`).test(src));
}

export function scan(dir = TEST_DIR, read = (p) => readFileSync(p, "utf8"), list = readdirSync) {
  const files = list(dir).filter((f) => f.endsWith(".test.mjs")).sort();
  const inClass = [];
  for (const f of files) {
    const src = read(join(dir, f));
    if (!writesAnEnvLocalFile(src) || !spawnsAnEntryPoint(src)) continue;
    inClass.push({ file: f, decided: decides(src),
      missing: BOTH.filter((n) => !new RegExp(`\\b${n}\\b`).test(src)) });
  }
  return { scanned: files.length, inClass };
}

if (import.meta.url === `file://${process.argv[1]}` || basename(process.argv[1] ?? "") === "drive-env-check.mjs") {
  let r;
  try { r = scan(); }
  catch (e) {
    // COULD NOT LOOK — never a pass. Exit 2 is this repo's third answer, and it is the one that keeps a
    // guard that has stopped reading anything from reading as agreement.
    console.error(`drive-env-check: could not read ${TEST_DIR} (${e.code ?? e.message}). Nothing was checked.`);
    process.exit(2);
  }
  if (!r.scanned) {
    console.error(`drive-env-check: no test files under ${TEST_DIR}. Nothing was checked.`);
    process.exit(2);
  }
  const bad = r.inClass.filter((c) => !c.decided);
  console.log(`drive-env-check: ${r.scanned} test files, ${r.inClass.length} of them drive a real command `
    + `against a .env they wrote${r.inClass.length ? `: ${r.inClass.map((c) => c.file.replace(/\.test\.mjs$/, "")).join(", ")}` : ""}`);
  if (!r.inClass.length) {
    // An empty class is a finding about the detector, not a clean bill. The suite HAS such drives.
    console.error("drive-env-check: nothing matched, and this suite contains drives of this shape. The "
      + "detector has stopped seeing its subject — read it before trusting this run.");
    process.exit(2);
  }
  if (!bad.length) { console.log("drive-env-check: every one of them names both, or takes the helper that does."); process.exit(0); }
  console.error("");
  console.error("These tests write a .env, drive a real command, and never say what environment they drive it in:");
  for (const c of bad) console.error(`    ${c.file}  —  never names ${c.missing.join(" or ")}`);
  console.error("");
  console.error("The suite runner sets CLEAROTRON_NO_ENV_FILE=1 for every child, and INVOCATION_ID is inherited");
  console.error("from any systemd unit above the run — a CI job included. Either of them makes the command ignore");
  console.error("the file the test just wrote and fall back to BUILT-IN DEFAULTS, ports included, with no error.");
  console.error("");
  console.error("  import { handRunEnv } from \"./drive-env.mjs\";   //   env: handRunEnv({ HOME: home })");
  console.error("");
  console.error("Or name both yourself, if this drive wants one of them set — an arm about the service-managed");
  console.error("path is exactly that, and must set INVOCATION_ID back rather than clear it.");
  process.exit(1);
}
