#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron install / clearotron doctor — one install from a fresh clone to a first real run.
//
//   npx clearotron install                    the wizard: one decision at a time, Enter takes the default
//   npx clearotron doctor                     report what this machine is configured for. Writes NOTHING.
//   npx clearotron doctor --probe-engine      …and spend one cheap turn proving the engine can run
//   npx clearotron doctor --probe-providers   …and spend one cheap paired call proving each register lane
//
// DESIGN RULES THIS FILE IS HELD TO
//
// One decision at a time, never a form. A form asks for six values before telling you whether the first
// one was right, and the person filling it in has no way to find out except to run the engine and read a
// stack trace. Each answer here is taken, checked, and reported before the next question is asked.
//
// Validate BEFORE persisting, through the doors the engine itself uses. A wizard that writes a `.env`
// and wishes you luck has moved the failure from setup — where a person is sitting there, willing to fix
// it — to the first run, where it costs model spend and reads as a provider fault. The EUIPO credential
// is checked by asking EUIPO for a token (providers/euipo `resolveConfig` + `getAccessToken`), the
// Perplexity key by one minimal call, the ENGINE by one cheap turn through the adapter's own spawn path
// (driver/engine/probe.mjs), and the whole candidate environment by the driver's own
// `preflightCredentials`. Nothing is written until they pass.
//
// The engine is CHOSEN, and it is chosen from the driver's own registry. This file used to resolve
// `claude` and write `CLEAROTRON_AI=anthropic-agent` unconditionally while the driver shipped a second
// adapter, so a reader who runs codex had no supported path through setup. The menu is built from
// `ENGINE_BINARIES`, which is also what the run-door preflight reads, so the two cannot disagree. An
// executable file is not a working engine: setup will not write a `CLEAROTRON_AI` it could not exercise,
// and the menu carries an explicit row for configuring no engine at all — `npm run example` needs none.
//
// Never print a secret. Ambient credentials are offered BY NAME. A masked prefix is not a compromise:
// on several of these the prefix is the discriminating part.
//
// Explicit data-plane paths, and NOTHING here quotes a default. What an unset variable does is asked of
// driver/driver.config.mjs's getters at the moment it is printed (`defaultWith` below). is what the
// other way costs: removed `CLEAROTRON_REPORTS_DIR`'s default outright and moved `CLEAROTRON_WORK_DIR`'s
// off the integrator platform's folder, and this file went on describing both of the old ones — so
// `--check` told a first-time reader to expect a pool default that no longer exists, in the exact wording
// was raised to delete. Nothing failed, because a quoted default cannot disagree with anything.
// The wizard still writes every path explicitly under $HOME/trademark/, so a laptop install cannot end up
// pointed at somebody's production pool whatever the getters say.
//
// It does not touch billing modes. Which auth an engine turn runs under is a spend decision, not a
// setup decision, and this file has no business making it.
//
// ONE KNOWN SHARP EDGE, worked around here rather than patched
// `preflightCredentials(env)` takes a candidate env, but the PROVIDER it checks against comes from
// `activeProvider()` → `REGISTER_PROVIDER`, a module-level const frozen at driver.config.mjs's first
// import from the REAL process.env (REGISTER_PROVIDER declared in driver.config.mjs). Pass a candidate
// naming euipo while
// the operator's shell has corsearch set, and it checks CORSEARCH_SESSION_KEY and passes for the wrong
// reason. So the candidate provider is written into process.env, driver.config.mjs is imported through a
// CACHE-BUSTED specifier so its module-level const is evaluated afresh, and process.env is restored
// afterwards. Without the cache-bust it works exactly once per process and is wrong every time after —
// which is worse than not working, because the wrong answer is a pass. The signature is misleading;
// fixing it is a change to a file this lane does not own.

import { spawnSync, execFileSync } from "node:child_process";   // — the wizard installs the engine when asked, and only when asked;
                                                                // execFileSync is doctor's read-only `systemctl show`
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";   // read the process table here; moved that to shared/process-table.mjs
import { homedir, userInfo } from "node:os";
import { invocationPrefix } from "../shared/invocation.mjs";   // — one rule for how the reader invokes us
import { invocationForm } from "../shared/invocation.mjs";   // — and WHY that form
import { standFrom } from "../shared/invocation.mjs";   // is this tree one npm replaces?
import { installShim } from "../shared/verb-shim.mjs";   // — the verb goes on PATH
import { styleFor, banner } from "../shared/tty-style.mjs";   // — weight where the meaning is
import { bracketAsciiCells } from "../shared/brand.mjs";      // F18 — the mark, from the geometry the SVG already uses
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { delimiter } from "node:path";
import { Writable } from "node:stream";

import { envLocalPath, loadEnvLocal } from "../shared/env-local.mjs";
import { bundleFreshness, newestMtimeUnder, distGateInTree, gitStanding } from "../shared/bundle-freshness.mjs";
import {
  USPTO_ARCHIVE_GB, USPTO_INDEX_GB, USPTO_INGEST_GB_PER_HOUR, USPTO_DAILY_TOPUP_MB,
  usptoBuildHours, usptoProvisionGB,
} from "../shared/uspto-index-size.mjs";
// The engine registry, read rather than duplicated. driver.config.mjs imports node builtins only and
// does nothing at import time, so this is inert — the ONE sharp edge it carries (a module-level
// REGISTER_PROVIDER frozen at first import) is the one `preflightCandidate` below already cache-busts
// around, and it is cache-busted whether or not this static import happened first.
import { config, ENGINE_BINARIES, DEFAULT_ENGINE_ID, RESEARCH_PROVIDERS, SERP_PROVIDERS } from "../driver/driver.config.mjs";
import { resolveAuthMode } from "../driver/engine/auth.mjs";
import { isInsideCheckout } from "../shared/inside-checkout.mjs";   // — one copy of the rule, and it is testable
import { packagedBuild as sharedPackagedBuild } from "../shared/packaged-build.mjs";   // — one reader of build-info.json, reachable from the driver
import { processTable } from "../shared/process-table.mjs";   // — /proc is not the only box
import { overlayReport, renderOverlayReport } from "../shared/doctrine-overlay.mjs";   // — the doctor reports the overlay
import { engineInventory, engineMode, ENGINE_MODES } from "../driver/config-inventory.mjs";   //
import { probeEngineTurn, probeFailureText, PROBE_MODEL, PROBE_TIMEOUT_SEC } from "../driver/engine/probe.mjs";
import { pinEnv, envFrom } from "../shared/env-aliases.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
// tracker issues 1861/1882 — one synopsis reader for every verb that prints one.
import { usageBlock } from "../shared/usage-block.mjs";
import { invoke } from "../shared/invocation.mjs";   // — name a command the reader can actually type
import { parseEnvFile } from "../driver/systemd/render-units.mjs";   // — ONE KEY=value reader; a second copy would drift from what systemd actually reads
import { unitEnvironment, unitValue, couldNotDetermine } from "../driver/unit-environment.mjs";   // — F34: claim about the UNITS only from the units' own environment

/**
 * A file's text, or null when it is not there or cannot be read.
 *
 * null is "could not look", and every caller here must keep it distinct from "" — an unreadable unit
 * file that reads as an empty one is precisely how doctor came to report two faults that did not exist.
 */
function readIfPresent(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = envLocalPath({ repoRoot: REPO });   // resolved, never composed: one resolver, so moving this file later is one line
const NODE_FLOOR = 22;

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const CHECK_ONLY = has("--check");
// Opt-in, and off by default on purpose — see runCheck's header. A flag rather than an environment
// variable: a variable read by shipping code owes a governance row, and this is a per-invocation
// intention, not a property of the machine. Same reasoning as `bin/uspto-sync.mjs --force-disk`.
const PROBE_ENGINE = has("--probe-engine");
// issue 1871 — the same opt-in shape, for the credentials that had no proof at all. Never implied by
// a plain --check: this SPENDS, and on two of the register adapters the count IS a billable search.
const PROBE_PROVIDERS = has("--probe-providers");

// ── output ───────────────────────────────────────────────────────────────────────────────────────────
// WEIGHT WHERE THE MEANING IS (, owner ruling 2026-08-31). Every line here used to
// be the same weight, which is why the passphrase and the coverage reason both disappeared into their
// surroundings — two defects on that issue that are formatting defects wearing other clothes.
//
// APPLIED AT THE FOUR HELPERS, not at their call sites. Several hundred lines already say `ok(...)` and
// `warn(...)`, and each one has ALREADY made the judgement this needs — that it is a completed step, or
// a refusal, or an aside. Re-deciding that per call site would be several hundred chances to disagree
// with the marker already printed beside it; here the tick and its colour cannot come apart.
//
// `styleFor` is identity off a terminal, so none of this reaches a log or CI — see shared/tty-style.mjs
// for why that is the default rather than a special case.
const style = styleFor({ stream: process.stdout });
const say = (s = "") => console.log(s);
const ok = (s) => say(`  ${style.ok("✓")} ${s}`);
const info = (s) => say(`  ${style.dim("·")} ${style.dim(s)}`);
const warn = (s) => say(`  ${style.warn("!")} ${s}`);
const problems = [];
const problem = (s) => { problems.push(s); say(`  ${style.err("✗")} ${style.err(s)}`); };
// A THIRD STATE, because there were only two and the install that cannot run fell between them.
// `--check` separates an ABSENCE (a fresh machine: reported, exit 0) from a MISCONFIGURATION (something
// set wrongly: exit 1), and onboard-wizard.test.mjs holds that contract. But an absence that stops every
// search was reported with `warn` and then summarised as "Nothing wrong with what is configured" — the
// body honest, the verdict contradicting it. `blocking` prints as a warning and is counted by the
// VERDICT only: the exit status keeps the contract, and the closing line stops claiming nothing is
// wrong while something that stops the product stands above it.
const blockers = [];
const blocking = (s) => { blockers.push(s); say(`  ${style.warn("!")} ${s}`); };
// EXPLANATORY PROSE, WRAPPED AT THE INDENT IT IS PRINTED AT ( — F17). Owner:
// "the formatting is still quite bad — line after line". The specific bug is the wrap: paragraphs were
// hand-broken at a fixed width and handed to the terminal, so on anything narrower than the author's
// window a sentence wraps to COLUMN 0 and loses the indent that was carrying the structure. The
// ✓/·/! lines never had this problem because they are one line each; the long paragraphs — the ones a
// reader most needs to follow — are exactly the ones that lost their shape.
//
// Takes the text as words, not as pre-broken lines, because a helper that re-wraps someone else's line
// breaks inherits their width. Callers pass sentences; this decides where they end.
const PROSE_INDENT = "  ";
/** The width to wrap to: the terminal's, capped so a very wide window does not produce unreadable
 *  measure, and floored so a very narrow one degrades rather than breaking every word. */
export const proseWidth = (columns = process.stdout.columns) =>
  Math.max(40, Math.min(96, Number(columns) || 80)) - PROSE_INDENT.length;

/** Pure, and exported for that reason: the wrapping is the thing under test, and driving it through a
 *  pty to read it back would test the terminal as much as the code. Returns lines WITHOUT the indent so
 *  the caller owns placement — a helper that both wraps and indents cannot be asked "how wide is this". */
export function wrapProse(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const w = Math.max(1, Number(width) || proseWidth());
  const out = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > w) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}
const prose = (...parts) => { for (const l of wrapProse(parts.join(" "), proseWidth())) say(`${PROSE_INDENT}${l}`); };

/**
 * The .env body: what setup collected, plus every key already in the file that setup does not manage.
 *
 * — F12. This composed the file from `candidate` alone and renamed over the
 * target, so running `install` AFTER `start` DELETED the three values start had written —
 * PORTAL_SECRET, PORTAL_LOCAL_USER and TRADEMARK_MCP_TOKEN_SECRET. The next start re-minted
 * PORTAL_SECRET to a different value, and every signed-in session was invalidated with nothing said
 * anywhere: no error, no warning, just everyone logged out and no reason on the screen.
 *
 * INSTALL.md states the rule for the other direction already — start "appends, never rewrites: that
 * file also holds the credentials `npx clearotron install` collected". It binds both writers or it
 * binds neither, and only one of them was obeying it.
 *
 * A .env.bak was taken, which is why nothing was lost forever — but a backup is a thing a reader has to
 * know to look for, and the failure gives them no reason to look.
 *
 * Pure and exported so the carry can be asserted directly: the defect is what the FILE ends up holding,
 * and driving a wizard through a pty to read a file back tests the pty as much as the rule.
 *
 * @param {Record<string,string>} candidate what setup collected — always wins
 * @param {Record<string,string>} existing  the file as it stands
 */
/**
 * ── IS THE PORTAL BUNDLE THE ONE ITS SOURCES WOULD BUILD? — ─────────────────
 *
 * `git pull` CANNOT UPDATE `portal-ui/dist` ON THE PUBLIC TREE, because the cut withholds it: the
 * bundle is untracked there and must be built by hand. So a pull that changes `portal-ui/src` leaves
 * the built bundle behind, the portal serves the old UI, and every surface says it is fine —
 * `/portal/health` has exactly two states for `ui`, present and absent, and there is no third for
 * present-and-older-than-its-sources. The operator ran the documented upgrade, it exited 0, nothing
 * warned, and the screen they serve is from before it.
 *
 * ✕ mtimes ARE NOT SAFE EVERYWHERE, WHICH IS WHY THIS DISCRIMINATES THE ROUTE FIRST. The issue proposes
 * "two mtimes and the product already knows both paths", and that is right on exactly one of the three
 * routes. Measured on this tree, all three states are distinguishable and only one of them is
 * comparable:
 *
 *   src ABSENT              the tarball. `package.json`'s `files` ships `portal-ui/dist/` and NOT
 *                           `portal-ui/src`, so there is nothing to compare against — and npm normalises
 *                           mtimes when it extracts, so comparing anyway would report a false stale on a
 *                           correct install. Nothing is claimed here on purpose.
 *   dist TRACKED, AND THE GATE IS IN THIS TREE   `portal-ui/dist` is committed and CI
 *                           rebuilds it and fails on any byte of difference, so freshness is already
 *                           enforced by a stronger check than a timestamp. And git does not preserve
 *                           mtimes: a checkout stamps whatever it wrote with the time it wrote it, so a
 *                           branch switch that touches one src file makes it "newer" than a dist that is
 *                           byte-perfect. Comparing here would be noise over a guarantee.
 *   dist TRACKED, NO GATE   ✕ AND THIS ROW IS WHY TRACKED-NESS IS NOT THE TEST. An earlier cut of this
 *                           read "tracked" as "guaranteed" and said so to the reader. Measured on the
 *                           exported tree: `.gitignore` ships a comment saying dist is committed on
 *                           purpose and does NOT ignore it, the cut withholds dist itself, and there is
 *                           no `.github/workflows` at all. So a public reader who builds the bundle and
 *                           runs `git add -A` — the ordinary thing — makes it tracked, and this cell
 *                           would have told them CI was checking it against its sources when nothing
 *                           was. That is worse than the silence this issue was opened about: it is the
 *                           same staleness, now with a tick over it. The guarantee comes from THE GATE,
 *                           so the gate is what is measured, by its own refusal text rather than by the
 *                           presence of a file that might be somebody else's workflow.
 *   NOT A GIT CHECKOUT      an extracted archive or a copied tree. `git pull` is the whole mechanism of
 *                           this defect and there is none here, so nothing can have gone stale by it —
 *                           and with no git there is no way to tell a copied dist from a built one.
 *                           Found by building the fixture: a hermetic root symlinks the real tree's
 *                           portal-ui and has no `.git`, so the comparison ran against a checkout whose
 *                           mtimes are all its checkout time in arbitrary order, and the arm would have
 *                           flipped verdict between runs. The flake was the measurement telling us the
 *                           comparison did not belong there.
 *   dist UNTRACKED IN A CHECKOUT, src present   the public source route, and the one this issue is
 *                           about. git never writes an untracked file, so dist's mtime really is when
 *                           it was built, and src's really is when the pull wrote it. Both are local
 *                           wall-clock events and the comparison means what it says.
 *
 * ✕ AND THE FIX IS NOT A HASH BAKED INTO THE BUNDLE. `shared/product-identity.mjs` states why in its own
 * words — a build-time define is circular against a committed dist, "and the tempting fix at that point
 * is to weaken the freshness check, which is worse than having no About page." Everything below is
 * outside the bundle.
 *
 * PURE. The three routes are drivable without building a portal.
 *
 * @returns {"no-sources"|"unbuilt"|"unversioned"|"guarded"|"tracked-unguarded"|"unmeasured"|"current"|"stale"}
 */
// `bundleFreshness` and its three readers moved to `shared/bundle-freshness.mjs` when `/portal/health`
// became a second caller (tracker issue 160): health answered `ui: "built", ok: true` over a tree this
// command refuses at rc 1, because the two surfaces each had their own idea of what a usable bundle is.
// One definition, both readers, so they cannot disagree again.

/**
 * The five directories the wizard creates for the data plane, relative to the base it asks for.
 * One list, so the check below and step 7 that creates them cannot drift about what a wizard run leaves.
 */
export const DATA_DIRS = Object.freeze({
  CLEAROTRON_REPORTS_DIR: "pool", CLEAROTRON_WORK_DIR: "workspace", CLEAROTRON_QUEUE_DIR: "queue",
  CLEAROTRON_OUTBOX_DIR: "outbox", CLEAROTRON_RUN_LOCK_DIR: "locks",
});

/**
 * ── DID AN UPGRADE EAT THE CONFIGURATION? — ─────────────────────────────────
 *
 * A MISSING `.env` USED TO BE ONE STATE AND IT IS TWO. On a fresh machine it means "not set up yet",
 * which is a fine thing to be and doctor says so at rc 0. On a PACKAGED install it also means something
 * else entirely: the wizard ran, wrote `.env` into `<project>/node_modules/clearotron`, and a later
 * `npm install` replaced that tree the way npm is entitled to — so a working install became an
 * unconfigured one during a documented upgrade that exited 0 and warned about nothing. The operator's
 * reports, workspaces and queues are all still there. Only the file naming them is gone, and the two
 * states print the same line.
 *
 * THE EXIT CONTRACT IS WHY THIS NEEDED A DISCRIMINATOR RATHER THAN A LOUDER MESSAGE. `--check`
 * separates an ABSENCE (reported, rc 0) from a MISCONFIGURATION (rc 1) — see the arm of that name in
 * driver/test/onboard-wizard.test.mjs. Making every missing `.env` rc 1 would fail a fresh machine for
 * being fresh, which is the contract's whole subject. What is reported here is not an absence: the
 * install is HALF present, and half an install is a misconfiguration by any reading. So this is
 * `problem()` and rc 1, deliberately, and the neighbouring stale-shim branch is the precedent.
 *
 * THE EVIDENCE IS THE DATA DIRECTORIES, and all five of them. The wizard creates them together in one
 * loop, so the full set is the signature of a completed run; any one of them alone could be somebody's
 * unrelated `~/trademark/pool`. A developer's checkout is excluded twice over — by the packaged test,
 * and because a source tree is not what `npm install` replaces.
 *
 * KNOWN LIMIT, STATED RATHER THAN HIDDEN: an operator who gave the wizard a base directory that is not
 * the default is not detected, because with `.env` gone there is nothing left that names their choice.
 * They get the old absence line. That is a miss, never a false alarm, and closing it means reading the
 * rendered systemd units — a bigger change than this issue asked for.
 *
 * PURE, every input injected, so both halves of the discriminator are drivable without a global install.
 */
export function configurationLostToUpgrade({
  envPath, installDir, env = process.env, home = homedir(), exists = existsSync,
} = {}) {
  if (exists(envPath)) return null;
  // Not packaged — a git checkout is not a tree npm replaces, and `standFrom` returns it unchanged.
  if (standFrom(installDir) === installDir) return null;
  // The ENVIRONMENT STILL CARRYING THE CONFIGURATION IS NOT THIS FAULT. A shell or a service file that
  // sets these is a configured install with no `.env`, which is a supported shape and says nothing about
  // an upgrade. Only when nothing else supplies them is the missing file the reason the install is down.
  if (Object.keys(DATA_DIRS).some((k) => String(env?.[k] ?? "").trim())) return null;
  const base = join(home, "trademark");
  const dirs = Object.values(DATA_DIRS).map((sub) => join(base, sub));
  return dirs.every((d) => exists(d)) ? { base, dirs, installDir } : null;
}

export function composeEnvBody(candidate, existing = {}) {
  // Setup's own answers win: the reader just typed them, and this run is the newer statement.
  const carried = Object.entries(existing).filter(([k]) => !(k in candidate));
  return [
    "# Written by `npm run setup`. Environment variables always win over this file.",
    "# It holds credentials: keep it at mode 600, and out of git (.gitignore already covers it).",
    "",
    // — VALIDATE under the names the engine reads, WRITE the names an installer should now see.
    // Without this a fresh `npm run setup` emits a .env full of deprecated spellings and the very next
    // run warns about the file the wizard just wrote. Safe as a straight key map because `candidate`
    // never holds both halves of a collapsed pair: the engine section probes ONE engine and records
    // only that engine's binary variable.
    ...Object.entries(candidate).map(([k, v]) => `${k}=${v}`),
    ...(carried.length ? [
      "",
      "# Kept from the existing file. Setup did not collect these and does not manage them —",
      "# `clearotron start` writes its own secrets here, and rewriting the file without them",
      "# signs every logged-in user out with no error anywhere.",
      ...carried.map(([k, v]) => `${k}=${v}`),
    ] : []),
    "",
  ].join("\n");
}

/** A stage of setup, so a reader knows where they are and how much is left. */
const section = (title) => say(`\n${style.head(title)}`);

// ── credential registry ──────────────────────────────────────────────────────────────────────────────
// The register providers, in the order the wizard offers them: free first, because that is the tier the
// reader can actually reach today. `credentials` is what preflightCredentials will demand.
// item 11 — Signa had NO signup array while EUIPO had a five-step walkthrough, so a reader who
// picked the recommended provider was asked for a key with no hint where to get one. Two steps is the
// whole of it, and that it is self-serve is the reason ADR-0001 recommends it.
// — F16. This said "the vendor's site" and never named it, for the register the
// product RECOMMENDS. The owner picked it and had to go looking: "I should not have to google for signa
// and find it (and they are hard to find)." The product knew the domain the whole time — it is in the
// architecture docs and in the adapter's own source — just not in either place the person being asked
// for a key would look. EUIPO's array opens with its URL and is the shape this now matches.
const SIGNA_SIGNUP = [
  "1. Create an account at https://signa.so/ and open the API section — it is self-serve: no sales",
  "   call, no contract, no waiting.",
  "2. Issue an API key and paste it here. See providers/README.md for the base-URL override.",
];
const EUIPO_SIGNUP = [
  "1. Sign in at https://euipo.europa.eu/ (create an account if you have none).",
  "2. Open the API portal and register an application for the trademark-search API.",
  "3. It issues a client id and a client secret. The secret is shown once.",
  "4. Ask for PRODUCTION access. The sandbox is a SEPARATE DEPLOYMENT holding a different corpus —",
  "   a sandbox credential searches marks that do not exist.",
];
// — WHAT THE FREE US REGISTER ACTUALLY COSTS, in the place a newcomer meets it.
//
// This said "on the order of a gigabyte, and it takes a while". Telling an adopter the steady-state
// size and calling the rest "a while" is the number that makes the decision look small: the one-off
// cost lands on their hardware and their bandwidth, and it is the thing they need before they start,
// not after.
//
// — the figures moved, because a build was finally run to the end and read. The download is what
// it always was; the ingest is slower than the early sample suggested and the finished index is far
// LARGER than the "gigabyte" this file was written to correct. Every one of them now comes from
// shared/uspto-index-size.mjs, which is also what INSTALL.md is tested against, so this list cannot
// drift from the document again.
//
// The EU half needs none of it, and that is said first — the free tier is reachable today without this.
const USPTO_WARNINGS = [
  "USPTO_LOCAL_DB is not an API key: it is a path to a database you build first.",
  "THE ONE-OFF COST, in full:",
  `  · ~${USPTO_ARCHIVE_GB} GB downloaded from the USPTO bulk products`,
  `  · ~${usptoBuildHours()} hours of ingest (measured ${USPTO_INGEST_GB_PER_HOUR} GB/h; yours scales with disk and CPU)`,
  `  · it settles to a ~${USPTO_INDEX_GB} GB index, then ~${USPTO_DAILY_TOPUP_MB} MB of nightly top-ups`,
  `  · provision ~${usptoProvisionGB()} GB free — the archives are deleted as they are ingested, so they never all exist at once`,
  "The EU register needs NONE of this and works as soon as your EUIPO credentials are in.",
  "A USPTO API key needs an ID.me identity verification, which is a real-world identity check.",
  "Build it with:  npm run sync:uspto      (resumable — an interrupted build picks up where it stopped)",
];

// item 1 — THE DOWNLOAD IS NOW SOMETHING THE WIZARD CAN START, SO CONSENT IS NOW REAL.
//
// Item 2 put the honest numbers in front of the reader. It did not create a gate, because the wizard
// had nothing to gate: it printed `npm run sync:uspto` and walked away, and a consent prompt in front of
// a command someone runs later is theatre. This is the missing half — the wizard offers to start the
// build, in the background, and therefore has to ask properly.
//
// "Properly" is doing the work here, and it is the whole of the requirement: *never start the download
// without an explicit yes that names the download size.* The ordinary `confirm()` takes Enter as the
// default, which is right for every other question in this file and wrong for this one — an adopter
// tapping through the wizard would start a 41.5 GB pull and a nine-hour build having read nothing. So
// this path has its own affirmative, it defaults to NO, and Enter is not an answer to it.
//
// moved the figures out of this file. They are one measured build's, they are what INSTALL.md is
// tested against, and the size the prompt names is now the same object as the size the document
// promises rather than a copy of it.

/**
 * What the wizard should do about a USPTO index path that is not there yet.
 *
 * Pure, so the decision can be driven without a terminal. `freeBytes: null` means the check could not
 * run — which is NOT a pass. An unmeasurable disk is reported and the offer still stands, because the
 * sync script runs the same check for real before it downloads a byte; what must never happen is this
 * function reporting "room is fine" over a number nobody read.
 */
export function usptoSyncPlan({ dbPath, exists, freeBytes }) {
  if (!dbPath) return { offer: false, reason: "no index path was given, so there is nothing to build" };
  if (exists) return { offer: false, reason: "the index already exists" };
  //: this charged the whole download again (`+ 4`), on the assumption that a byte of archive
  // becomes a byte of index. A finished build says it becomes 0.24 of one, so the wizard was quoting
  // 46 GB at a reader whose build needs 17 — and the sync script, which owns the real refusal, now
  // computes from the same place this does rather than from a second guess that drifted.
  const needGB = usptoProvisionGB();
  const freeGB = typeof freeBytes === "number" ? freeBytes / 1e9 : null;
  return {
    offer: true,
    reason: "the index does not exist yet",
    downloadGB: USPTO_ARCHIVE_GB,
    hours: usptoBuildHours(),
    needGB,
    freeGB,
    // Short of room is not a refusal here — the sync script owns that call and measures it against the
    // real pending file list. This is a warning the reader gets BEFORE committing six hours to it.
    roomWarning: freeGB === null
      ? "free space could not be measured here — the build checks it properly before downloading anything"
      : (freeGB < needGB
        ? `only ${freeGB.toFixed(1)} GB free where the index would live; this wants about ${needGB} GB `
          + `while the archives and the index coexist. The build refuses rather than leaving a partial index.`
        : null),
  };
}

/** The exact consent question. Split out so a test can assert the number is IN it — a prompt that has
 *  drifted away from naming the download is the failure this whole item exists to prevent. */
export function usptoConsentPrompt(plan) {
  return `Start it now? This downloads about ${plan.downloadGB} GB and builds for roughly `
    + `${plan.hours} hours in the background. Type "yes" to start`;
}

/** Only an explicit affirmative. Empty input is NOT consent, and neither is "y". */
export const isExplicitYes = (answer) => String(answer ?? "").trim().toLowerCase() === "yes";

/**
 * The argv and spawn options for the background build. Returned rather than executed so the shape can
 * be asserted: detached, its own session, output to a log, and the parent not waiting on it.
 */
export function backgroundSyncSpec({ repo, dbPath, logFd }) {
  return {
    command: process.execPath,
    args: [join(repo, "bin", "uspto-sync.mjs"), "--db", dbPath],
    options: { cwd: repo, detached: true, stdio: ["ignore", logFd, logFd] },
  };
}

/**
 * Offer to build the US index now, in the background, and take a real yes for it.
 *
 * The wizard's own printers and prompt are passed IN rather than closed over. That is not ceremony: the
 * decision half above is pure and testable, and without this seam the half that actually spawns a
 * six-hour job would be reachable only through a terminal — so the branch that matters (a reader who
 * pressed Enter, and a build that must therefore NOT be running) would be asserted nowhere.
 *
 * `deps.spawn` and `deps.statfs` are injectable for the same reason. Defaults are the real ones.
 */
export async function offerUsptoSync(dbPath, io, deps = {}) {
  const { ask, say = () => {}, ok = () => {}, info = () => {}, warn = () => {}, problem = () => {} } = io;
  let freeBytes = null;
  try {
    const statfs = deps.statfs ?? (await import("node:fs/promises")).statfs;
    const fsInfo = await statfs(dirname(resolve(dbPath)));
    freeBytes = fsInfo.bavail * fsInfo.bsize;
  } catch { /* an unmeasurable disk is reported by the plan, never read as room */ }

  const plan = usptoSyncPlan({ dbPath, exists: existsSync(dbPath), freeBytes });
  if (!plan.offer) return { started: false, reason: plan.reason };

  say("");
  info("The EU register works as soon as setup finishes — none of this blocks it.");
  info(`The US half needs the index built first: about ${plan.downloadGB} GB downloaded and roughly `
    + `${plan.hours} hours of ingest, once.`);
  if (plan.roomWarning) warn(plan.roomWarning);
  info("It is resumable — an interrupted build picks up where it stopped.");

  const answer = await ask(`  ${usptoConsentPrompt(plan)}: `);
  if (!isExplicitYes(answer)) {
    info(`Not started. Build it whenever you like with:  ${invocationPrefix()}clearotron sync --db ${dbPath}`);
    return { started: false, reason: "declined" };
  }

  const logPath = join(dirname(resolve(dbPath)), "uspto-sync.log");
  try {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    const openFile = deps.openSync ?? (await import("node:fs")).openSync;
    const spawnFn = deps.spawn ?? (await import("node:child_process")).spawn;
    const fd = openFile(logPath, "a");
    const spec = backgroundSyncSpec({ repo: REPO, dbPath, logFd: fd });
    const child = spawnFn(spec.command, spec.args, spec.options);
    // Detach for real: without unref() the wizard's own exit waits on a six-hour build.
    child.unref();
    ok(`Building in the background (pid ${child.pid}).`);
    info(`Progress:  tail -f ${logPath}`);
    info("It reports each file as it downloads and ingests, and prints the disk it needs before it starts.");
    info("If it refuses on disk, nothing has been downloaded — point --db somewhere with room and re-run.");
    info("Until it finishes, US coverage is DISCLOSED as a deferred gap. The EU half is unaffected.");
    return { started: true, pid: child.pid, logPath };
  } catch (e) {
    // A failed spawn is a finding, not a silent skip: the reader has just said yes to a six-hour build
    // and must not be left believing one is running.
    problem(`could not start the build: ${e.message}`);
    info(`Start it by hand with:  ${invocationPrefix()}clearotron sync --db ${dbPath}`);
    return { started: false, reason: "spawn-failed", error: e.message };
  }
}

// item 11 — ADR-0001's ladder, in the order that decision rules: recommended, then free, then
// sales-gated. It used to open with the free tier, and a test asserted that it must — an assertion that
// argued a case the ADR had already answered. The reasoning is in ADR-0001 and in providers/README.md,
// which is the canonical statement; this list carries no competing recommendation of its own.
export const PROVIDERS = [
  {
    id: "signa", label: "Signa — recommended: US + EU + WIPO and eight more offices", cost: "subscription",
    covers: "the US and EU registers together, plus WIPO/Madrid, the UK, Switzerland, Canada, Australia, "
      + "France, Singapore, Norway and Sweden — eleven offices — with native sound-alike search, exact "
      + "result counts and opposition state. One self-serve key, no sales call.",
    credentials: ["SIGNA_API_KEY"],
    signup: SIGNA_SIGNUP,
  },
  {
    id: "free-tier", label: "Free tier — EU + US, no subscription", cost: "free",
    covers: "the EU register and the US register together, from two free sources composed into one. "
      + "Everywhere else is a disclosed gap.",
    credentials: ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"],
    // OPTIONAL, and that is the whole point of the free tier being reachable. Requiring the US
    // index here told a newcomer to build a 41.5 GB index over two bulk products before anything could
    // run — the first thing an open-source reader hits, on the configuration that exists precisely so a
    // clearance needs no subscription. Without it the US office is split off at plan compile and
    // disclosed as a deferred coverage row; the EU half runs.
    optionalCredentials: ["USPTO_LOCAL_DB"],
    extra: { EUIPO_ENVIRONMENT: "production" },
    signup: EUIPO_SIGNUP,
    warnings: USPTO_WARNINGS,
    validateEuipo: true,
    uspToLocalKey: "USPTO_LOCAL_DB",
  },
  {
    id: "euipo", label: "EUIPO — the EU register only", cost: "free",
    covers: "the EU register, and nothing else. Every other territory becomes a disclosed gap in the report.",
    credentials: ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"],
    extra: { EUIPO_ENVIRONMENT: "production" },
    signup: EUIPO_SIGNUP,
    validateEuipo: true,
  },
  {
    id: "uspto-local", label: "USPTO (local index) — the US register only", cost: "free",
    covers: "the US register, and nothing else, from an index you build and hold locally.",
    credentials: ["USPTO_LOCAL_DB"],
    warnings: USPTO_WARNINGS,
    uspToLocalKey: "USPTO_LOCAL_DB",
  },
  { id: "corsearch", label: "Corsearch — global", cost: "subscription", covers: "a global sweep.", credentials: ["CORSEARCH_SESSION_KEY"] },
  { id: "clarivate", label: "Clarivate — global", cost: "subscription", covers: "a global sweep.", credentials: ["CLARIVATE_API_KEY"] },
];

// Every credential this wizard may find lying around, so ambient detection knows what it is looking at.
// EXPORTED since: it is also the answer to "which credential names does this product
// own", which a gatherer filtering a production name list has to know. Derived from the provider specs
// rather than typed, so a new provider joins both answers at once.
export const AMBIENT_KEYS = [
  ...PROVIDERS.flatMap((p) => [...p.credentials, ...(p.optionalCredentials ?? [])]),
  // No case-law entry: ADR-0003 rules that setup is an OAuth flow, not a variable, so there is no token
  // for the wizard to find lying around. Offering to adopt one taught a new install to set something
  // that configures nothing.
  "PERPLEXITY_API_KEY", "SERPAPI_API_KEY",
];

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────
const present = (v) => typeof v === "string" && v.trim() !== "";

/**
 * An engine binary, resolved the way the engine resolves it — and the trap that resolution carries.
 *
 * Was `resolveClaudeBin`. The body never had anything claude-specific in it; the NAME was the last place
 * this file still assumed one engine, and a name that lies is how the second adapter stayed invisible.
 */
export function resolveEngineBin(bin) {
  // driver/engine/anthropic-agent.mjs — `CLEAROTRON_CLAUDE_PATH || "claude"`; openai-agent.mjs — the same
  // shape on `CLEAROTRON_CODEX_PATH || "codex"`. A RELATIVE path is the trap for BOTH: stage subprocesses are
  // spawned with cwd set to the RUN DIRECTORY (driver/engine/common.mjs resolveSpawnCwd, shared by the
  // two adapters), so a relative binary resolves against a directory that did not exist at setup time.
  if (bin.includes("/")) {
    const abs = resolve(bin);
    if (!isAbsolute(bin)) return { path: abs, executable: isExec(abs), relative: true };
    return { path: abs, executable: isExec(abs), relative: false };
  }
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const p = join(dir, bin);
    if (isExec(p)) return { path: p, executable: true, relative: false };
  }
  return { path: null, executable: false, relative: false };
}
const isExec = (p) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };

/**
 * The engine menu, built from the driver's registry so the wizard cannot offer an adapter that does not
 * exist — or hide one that does. Same guarantee the register-provider list has.
 *
 * The last row is deliberately NOT an engine, and that is what makes the refusal above workable: a
 * reader whose CLI is signed out, or who only wants `npm run example`, has a stated route through setup
 * that does not end in a `.env` naming an engine nobody proved. `id: null` is that row; anything
 * asserting this list against the adapter registry must drop it first.
 */
export function engineOptions() {
  return [
    // The VENDOR and plain words, not `label` — the labels are mechanism sentences (`claude -p`,
    // `codex exec`) and the menu is the first question a lawyer reads. The
    // mechanism still appears in the confirmation lines after a choice, where it belongs.
    ...Object.entries(ENGINE_BINARIES).map(([id, s]) => ({ id, label: `${s.vendor} — uses its \`${s.fallback}\` program on this machine` })),
    { id: null, label: "Neither yet — configure no engine (`npm run example` needs none; a real run will refuse)" },
  ];
}

/**
 * What `<repo>/.env` would give a run, read THROUGH THE ENGINE'S OWN LOADER.
 *
 * Not a second parser. `shared/env-local.mjs` is what actually applies the file at every CLI
 * entry, using `node:util` parseEnv; a hand-rolled regex here would disagree with it on quoting and
 * escapes, and `--check` would then report a value the engine does not read — an answer that is wrong
 * and confident, which is the whole class of defect this command exists to catch.
 *
 * Called with a THROWAWAY env object and a silent note, so it reports without applying anything and
 * without printing the loader's own stderr line. Importing the module is inert here: its side-effect
 * load is gated on `process.argv[1]` being one of CLI_ENTRIES, and bin/onboard.mjs is not one — it
 * WRITES the file, and a wizard that had already loaded the .env it is about to replace would be
 * reporting the old file's values as the new ones.
 */
export function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  loadEnvLocal({ env, repoRoot: dirname(path), note: () => {} });
  return env;
}

/** preflightCredentials, made to actually check the provider the candidate names. See the header. */
export async function preflightCandidate(candidate) {
  // step 4 — SAVE AND RESTORE MUST SPEAK THE SAME LANGUAGE. Converting the reads in this pair
  // and leaving the writes saved one spelling and restored another, which is a leak of the candidate's
  // provider into the caller's environment. `pinEnv` writes every spelling and deletes every spelling
  // when handed `undefined`, so the pair cannot come apart again. Both names stay literal here so the
  // injected-read scanner still sees them.
  // One reader for every spelling, rather than this pair by hand — the pair was right about the problem
  // and could only ever cover the spellings whoever wrote it happened to remember.
  const saved = envFrom(process.env, "CLEAROTRON_DATABASE");
  pinEnv(process.env, "CLEAROTRON_DATABASE", candidate.CLEAROTRON_DATABASE);
  try {
    // Cache-busted, and that is not a nicety. `REGISTER_PROVIDER` is frozen at the module's FIRST
    // evaluation, so a cached copy answers with whatever provider the first import saw — which makes a
    // second call in the same process, or any process that already imported driver.config, check the
    // wrong provider and pass for the wrong reason. Same trick driver/test/pipeline.mock.test.mjs uses
    // on pipeline.mjs, for the same frozen-at-import reason.
    const bust = `${Date.now()}-${process.hrtime.bigint()}`;
    const { preflightCredentials } = await import(`${pathToFileURL(join(REPO, "driver", "driver.config.mjs")).href}?bust=${bust}`);
    return { ok: true, result: preflightCredentials(candidate) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  } finally {
    pinEnv(process.env, "CLEAROTRON_DATABASE", saved);   // undefined means UNSET, and deletes the key
  }
}

/** Ask EUIPO for a token. This is the check that makes "refuses to persist a bad secret" true. */
export async function validateEuipo({ clientId, clientSecret, environment }) {
  try {
    const { resolveConfig } = await import(join(REPO, "providers", "euipo", "src", "core.js"));
    const { getAccessToken } = await import(join(REPO, "providers", "euipo", "src", "euipo-client.js"));
    await getAccessToken(resolveConfig({ clientId, clientSecret, environment }), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** One minimal Perplexity call. Costs a request, so it is never made without being asked for. */
export async function validatePerplexity(apiKey) {
  try {
    const { buildRequestBody, callAgentAPI } = await import(join(REPO, "providers", "perplexity", "src", "core.js"));
    await callAgentAPI(apiKey, buildRequestBody({ task: "Reply with the single word: ok.", preset: "fast-search" }), { retries: 0 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// ── what an UNSET variable actually does, asked rather than quoted ────────────────────────────
//
// Every sentence this file prints about a default is derived through here. `config`'s data-plane entries
// are GETTERS evaluated at access time, so the answer is whatever driver/driver.config.mjs does today —
// including refusing, which is `CLEAROTRON_REPORTS_DIR`'s answer since and is returned as `refusal` rather
// than thrown. The ambient value is removed for the duration and put straight back, because the question
// is what happens with the variable UNSET and the operator's own shell may well have it set; reading the
// getter as-is would report their configured path as though it were the built-in default.
//
// Returns exactly one of `{ value }` or `{ refusal }`.
function defaultWith(name, read) {
  const had = Object.hasOwn(process.env, name);
  const saved = process.env[name];
  delete process.env[name];
  try { return { value: read() }; }
  catch (e) { return { refusal: String(e?.message ?? e) }; }
  finally { if (had) process.env[name] = saved; }
}

// ── --check ──────────────────────────────────────────────────────────────────────────────────────────
// Reports. Writes nothing and creates nothing, ever.
//
// It calls nobody EITHER, with exactly one opt-in exception: `--probe-engine` spends one cheap engine
// turn. Off by default, and the default is off for the original reason — a check that dials a provider
// is a check that can fail for reasons that are not about this machine. Named as a flag so the reader
// who asked for it is the one who pays for it, and so `--check` stays the thing you can run anywhere.
//
// Exit 0 when everything PRESENT is coherent, 1 when something present is WRONG, 2 when it could not
// look. An absence is reported loudly and is not, on its own, a failure — a fresh clone has configured
// nothing yet, and that is what `npm run setup` is for.
/**
 * — HOW FAR BEHIND IS THIS DEPLOYMENT? One `git rev-list --count`, reported beside the rest.
 *
 * A test box sat on a day-old commit for a full day while main advanced more than a dozen merges, and
 * four rounds re-measured a build nobody had asked them to measure. Nothing was wrong with any of them:
 * every round stamped its own commit honestly. What did not exist was any surface that said "this
 * deployment is N commits behind" — `doctor` reported what the machine is CONFIGURED for and never
 * whether it is CURRENT.
 *
 * THE THREE ANSWERS ARE THREE ANSWERS, and that is the whole point. "Up to date", "N behind" and "I
 * could not look" are different facts, and a check that prints the first for the third is the failure
 * this repository keeps finding in other clothes. No upstream, no git, a fetch that never ran — each
 * says so in its own words.
 *
 * It does NOT fetch. A doctor that reaches the network is a doctor that hangs on a box with no route
 * out, and the count is against the last fetch either way — which is stated rather than implied.
 */
/**
 * The values that decide WHICH DOOR is served and WHO it admits.
 *
 * Deliberately small. A report listing every difference between two env files would be noise on a box
 * where they differ BY DESIGN — the checkout's file is the hand-run configuration, the units' file is
 * the server's, and they are supposed to disagree about paths, ports and secrets.
 */
export const DOOR_KEYS = Object.freeze([
  "PORTAL_AUTH_MODE", "CLEAROTRON_OIDC_AUDIENCE", "CF_ACCESS_TEAM",
  "TRADEMARK_MCP_AUTH_MODE", "TRADEMARK_MCP_AUTH_DISABLED",
]);

/**
 * Door values that DISAGREE between the checkout's `.env` and the units' `%h/.env`.
 *
 * NOT "a second file exists" — that is the ordinary case on a server box and was what an earlier reading
 * of this issue asked for. The finding is that the two files name a DIFFERENT DOOR.
 *
 * A KEY IN ONE AND ABSENT FROM THE OTHER IS NOT A DIVERGENCE. Absence means "this file does not decide
 * that", and systemd's EnvironmentFile only overrides keys it actually sets — so reporting those would
 * flag every correctly-split pair of files on every box.
 */
export function doorDivergence({ repoText = null, homeText = null, keys = DOOR_KEYS } = {}) {
  if (repoText == null || homeText == null) return [];
  const a = parseEnvFile(repoText), b = parseEnvFile(homeText);
  return keys.filter((k) => a[k] != null && b[k] != null && a[k] !== b[k])
    .map((k) => ({ key: k, checkout: a[k], units: b[k] }));
}

/**
 * The commit a packaged install was built from, or null in a checkout (where git is the answer).
 *
 * Read from `build-info.json`, which `prepack` writes and the archive carries. It is NEVER committed —
 * a stale committed copy would name the wrong code with total confidence, which is worse than the
 * silence it replaces.
 *
 * THE READER ITSELF LIVES IN `shared/packaged-build.mjs`. `driver/engine-build.mjs`
 * needs the same answer and cannot import this file — the wizard's graph (readline, the engine probe,
 * driver.config) has no business in the closure of a module that runs on every publish. This stays as
 * the wrapper that supplies THIS install's repo root, so every existing caller and its arms are
 * unchanged.
 */
export function packagedBuild(repo = REPO, read = null) { return sharedPackagedBuild(repo, read); }

export function deploymentCurrency({ repo = REPO, run = null, env = process.env } = {}) {
  // ── — A PINNED CHECKOUT HAS NOTHING TO BE BEHIND ─────────────────────────────
  //
  // A CI workspace is not a deployment. `actions/checkout` puts a branch tracking `origin/main` at the
  // sha under test, so the moment another merge lands while the job queues, this reports "1 commit(s)
  // behind" — correctly — and every `--check` arm asserting exit 0 fails together. Measured
  // 2026-08-26: main read RED twice, eight arms each time, and both failures reported exactly 1, with
  // exactly one commit landing between the run starting and the arm executing. The green one between
  // them had none. The verdict was decided by queue position, and it fires hardest when the queue is
  // longest — which is when a red main blocks the most people.
  //
  // WHAT THIS IS NOT: a way to make the check quiet. It answers a different question in its own words,
  // exactly as `no-upstream` does — "you pinned this, so currency is not a question here" — and it must
  // be asked for explicitly. Without it a checkout behind its upstream still reports behind and still
  // fails, which is the guard was raised for and there is an arm holding it.
  if (String(env.CLEAROTRON_DOCTOR_ASSUME_PINNED ?? "").trim())
    return { state: "pinned", detail: "this checkout is pinned, so currency is not a question here" };
  const git = run ?? ((args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" }));
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0) return { state: "not-a-checkout", detail: "this install is not a git checkout" };
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.status !== 0) return { state: "no-upstream", detail: "this branch tracks no remote" };
  const counted = git(["rev-list", "--count", "HEAD..@{u}"]);
  if (counted.status !== 0) return { state: "unknown", detail: (counted.stderr || "").trim().split("\n")[0] || "git could not count" };
  const behind = Number(String(counted.stdout ?? "").trim());
  if (!Number.isFinite(behind)) return { state: "unknown", detail: "git returned no number" };
  return { state: behind === 0 ? "current" : "behind", behind, upstream: upstream.stdout.trim() };
}

/**
 * — CHECKOUT CURRENT, PROCESSES ON AN OLDER TREE. Its own named state, because it is its own fact.
 *
 * `git pull` + `npm ci` moves the FILES. A long-lived service keeps executing the tree it started with
 * until something restarts it, so a box can be honestly "up to date" and still be answering from code
 * that no longer exists on disk. That is this issue's invisibility in a third form: nothing is broken,
 * nothing is stale on paper, and the running answer comes from somewhere nobody can see.
 *
 * IT REPORTS, IT DOES NOT RESTART. Which services a deployment runs, and which supervisor owns them, is
 * an open question elsewhere; a verb that restarts what it guesses is a verb that decides it. So this
 * NAMES the processes and the command, and leaves the act to whoever owns the box — the difference
 * between an operator who has not been told and one who has.
 *
 * The comparison is deliberately crude and therefore hard to break: a process whose command line runs
 * something inside this checkout, started BEFORE the branch ref last moved. No systemd, no unit list,
 * no assumption about who supervises what.
 */
export function programsOnAnOlderTree({ repo = REPO, pulledAt = null, readProcs = null } = {}) {
  let movedAt = pulledAt;
  if (movedAt === null) {
    const gitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo, encoding: "utf8" });
    if (gitDir.status !== 0) return { state: "unknown", detail: "not a git checkout", programs: [] };
    const head = spawnSync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: repo, encoding: "utf8" });
    const refPath = head.status === 0
      ? join(gitDir.stdout.trim(), head.stdout.trim())
      : join(gitDir.stdout.trim(), "HEAD");
    try { movedAt = statSync(existsSync(refPath) ? refPath : join(gitDir.stdout.trim(), "HEAD")).mtimeMs; }
    catch (e) { return { state: "unknown", detail: `could not read when the branch last moved: ${e.code ?? e.message}`, programs: [] }; }
  }
  // A FUNCTION, not a list, and that is not a style choice. Taking a list made `null` mean two things —
  // "caller supplied nothing" and "the scan could not look" — and the second silently became the first,
  // reporting a clean tree from an instrument that had not run. Injecting the READER keeps the two
  // apart: not supplied uses the real scan, and a scan that fails returns null and is reported as such.
  const found = (readProcs ?? readOwnProcesses)(repo);
  if (found === null) return { state: "unknown", detail: "could not read the process table", programs: [] };
  const older = found.filter((p) => Number.isFinite(p.startedAt) && p.startedAt < movedAt);
  return { state: older.length ? "older-tree" : "current", programs: older, movedAt };
}

/**
 * Processes whose command line runs something inside `repo`, with their start times. `null` = could not look.
 *
 *. This read `/proc` directly, so on macOS it returned `null` every time and
 * doctor's deployment section said "the process table could not be read" to every reader on the
 * platform README.md names first. The listing now comes from `shared/process-table.mjs`, which has a
 * `ps` implementation behind the same contract — including the part that matters here, that `null`
 * means the instrument did not run and is never an empty machine.
 *
 * Exported, and the listing is a seam, because that `null` propagation is the whole safety property and
 * was unfalsifiable while both were private: `programsOnAnOlderTree`'s `readProcs` injection replaces
 * this function wholesale, so an arm could not reach the branch inside it. A guard nothing can fail is
 * not a guard.
 */
export function readOwnProcesses(repo, { table = processTable() } = {}) {
  if (table === null) return null;
  return table
    .filter((p) => p.cmd.includes(repo) && p.pid !== process.pid)     // the doctor is not an older tree
    .map((p) => ({ pid: p.pid, startedAt: p.startedAt, cmd: p.cmd.slice(0, 120) }));
}

export async function runCheck() {
  say("\n  Trademark clearance engine — configuration check\n");
  say(`  repo: ${REPO}`);

  // — CURRENT, not just configured. Printed before anything else because a stale deployment
  // makes every line below it a report about the wrong build.
  say("\n  Deployment");
  const cur = deploymentCurrency();
  if (cur.state === "current") ok(`up to date with ${cur.upstream} as of the last fetch`);
  else if (cur.state === "behind") {
    problem(`${cur.behind} commit(s) behind ${cur.upstream} as of the last fetch — run \`${invoke("update")}\``);
  } else if (cur.state === "no-upstream") info("this branch tracks no remote, so there is nothing to be behind");
  // SAYS IT WAS TOLD. A reader must be able to see the assumption in the output rather than infer it
  // from a silence — a doctor that quietly answers a question it was handed is the shape this whole
  // surface exists to refuse.
  else if (cur.state === "pinned") info("pinned checkout (CLEAROTRON_DOCTOR_ASSUME_PINNED), so there is nothing to be behind");
  else if (cur.state === "not-a-checkout") {
    // A PACKAGED INSTALL CAN STILL NAME ITS CODE. `not-a-checkout` is the permanent
    // state of every registry install, and "this run's code cannot be named" is not something a customer
    // install should say forever. `prepack` stamps the commit into `build-info.json` and it ships, so the
    // commit is readable here — but it is read from a FILE THE ARCHIVE CARRIES, not from a live checkout,
    // and those are not the same evidence. The line says which one it had, because a reader who cannot
    // tell them apart cannot tell a stamped archive from a verified tree.
    const packed = packagedBuild();
    if (packed) info(`packaged install of ${packed.commit.slice(0, 8)} (v${packed.version}), named from the `
      + "archive's own build-info.json rather than from a checkout — currency is not a question this can answer");
    else info("not a git checkout, so currency is not a question this can answer");
  }
  else warn(`could not tell whether this deployment is current: ${cur.detail}`);
  if (cur.state !== "not-a-checkout" && cur.state !== "no-upstream" && cur.state !== "pinned") {
    info("this does not fetch — the count is against the last fetch, not against the remote right now");
  }

  // ── THE TWO FILES MAY DISAGREE ABOUT THE DOOR ────────────────────────────────
  //
  // They are disjoint by design and are SUPPOSED to differ about paths, ports and secrets. What must
  // never differ is the door: a box whose two files name different auth modes, or different audiences,
  // has a sign-in pointing at the wrong tenant depending on which process answered — and that fails as a
  // SUCCESSFUL LOGIN rather than as an error, which is why it is said here rather than left to whoever
  // compares the files by eye.
  const diverged = (() => {
    try {
      return doorDivergence({
        repoText: readFileSync(ENV_PATH, "utf8"),
        homeText: readFileSync(join(homedir(), ".env"), "utf8"),
      });
    } catch { return []; }   // one file absent is the ordinary case and says nothing
  })();
  for (const d of diverged)
    warn(`${d.key} differs between ${ENV_PATH} (${d.checkout}) and ${join(homedir(), ".env")} `
      + `(${d.units}). Those two files configure different processes, and the second is what the `
      + "services run with — so the door a caller meets depends on which one answered.");
  // — a current checkout is not a current deployment. Reported separately because it is a
  // separate fact, and because "up to date" beside a service running last week's code is a lie of
  // omission rather than a wrong number.
  const running = programsOnAnOlderTree();
  if (running.state === "older-tree") {
    warn(`${running.programs.length} running program(s) started before this checkout last moved — they are `
      + "executing the previous tree until restarted:");
    for (const pr of running.programs.slice(0, 6)) say(`      pid ${pr.pid}  ${pr.cmd}`);
    if (running.programs.length > 6) say(`      … and ${running.programs.length - 6} more`);
    say("      Restart whatever supervises them; this command does not, because which supervisor owns");
    say("      them is a property of your deployment and not of this checkout.");
  } else if (running.state === "unknown") {
    warn(`could not tell whether running programs are on the current tree: ${running.detail}`);
  }

  say("\n  Node");
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= NODE_FLOOR) ok(`node ${process.versions.node}`);
  else problem(`node ${process.versions.node} — this engine needs >= ${NODE_FLOOR} (node:sqlite and TS type-stripping are load-bearing)`);

  // Read the file up here rather than at the `.env` heading below: the engine section is the first that
  // needs `effective()`, and which ENGINE is configured decides which binary variable to check. Reading
  // is not applying — see readEnvFile's header.
  const fileEnv = readEnvFile(ENV_PATH);
  // Environment wins over the file (the loader contract), so report the effective value and say which
  // source it came from — a value read from the wrong place is the whole class of bug here.
  // ── CHECK 1 — THE CHECKER READS EVERY SPELLING THE ENGINE ACCEPTS ─────────────────────────
  //
  // This read `process.env[k]` and `fileEnv[k]` for the LITERAL key, while the writer below maps every
  // key and writes the CLEAROTRON_* name. So on an install THIS WIZARD had
  // just configured correctly, `--check` reported every renamed variable as NOT SET, and told the
  // operator to go and set the old name — the one the engine is moving away from.
  //
  // Batch 1 recorded this trap in the opposite direction ("validating under names the engine reads while
  // writing names that would warn"). It survived its own fix in mirror image, which is why carries
  // the write-point check forward as a standing requirement rather than a one-off.
  //
  // CURRENT SPELLING FIRST, then the retired ones — the same order `applyEnvAliases` resolves in, so the
  // checker cannot disagree with the engine about which value wins when an operator has both set during
  // the migration. `from` names the spelling that answered, so an operator running on an old name can
  // see that they are, instead of being told everything is fine.
  //
  // `from` NAMES THE SOURCE, NOT THE SPELLING, and the first cut of this got that wrong. It appended
  // the answering spelling so "an operator on an old name can see that they are" — but `applyEnvAliases`
  // runs ungated at load and populates the CURRENT name from the old one, so the current spelling always
  // answers first and the label always named it. On a box configured entirely under retired names it
  // therefore reported the new spelling as the one that had answered: not merely uninformative, but the
  // opposite of what happened. The evidence it wanted is destroyed before this function can see it.
  //
  // THAT OPERATOR IS NO LONGER TOLD ANYTHING, and this note used to claim otherwise. It described a
  // deprecation notice `applyEnvAliases` printed at load, from the translation itself. There is no
  // translation and no notice: the owner ruled both out on 2026-08-26 (no migration, no legacy support,
  // and — asked directly — no check for the old names either), because a box reaches this code through
  // the install and the boxes that predated the rename are rebuilt rather than upgraded. The 2026-09-04
  // global rename extended that to the whole namespace. An old name is a line in a file nothing reads,
  // and the paragraph above describes a configuration that no longer occurs.
  const effective = (k, names = [k]) => {
    for (const name of names) {
      if (present(process.env[name])) return { v: process.env[name], from: "environment", name };
      if (present(fileEnv[name])) return { v: fileEnv[name], from: ".env", name };
    }
    return null;
  };


  say("\n  Engine");
  // This block used to read CLEAROTRON_CLAUDE_PATH unconditionally, under the heading "Engine binary", on a
  // box that may be running codex — so it reported the wrong variable and could pass for the wrong
  // reason. Which engine is configured comes first now, and the binary is checked through THAT engine's
  // variable.
  const engSel = effective("CLEAROTRON_AI");
  const engineId = String(engSel?.v ?? DEFAULT_ENGINE_ID).trim().toLowerCase();
  const engSpec = ENGINE_BINARIES[engineId];
  if (engSel && !engSpec) {
    problem(`CLEAROTRON_AI="${engSel.v}" (${engSel.from}) is not an engine this driver ships — one of: `
      + `${Object.keys(ENGINE_BINARIES).join(", ")}. The run refuses on this by itself (gateway.selectEngine); `
      + "nothing can be checked here until it names an adapter.");
  } else {
    if (engSel) ok(`${engineId} (${engSel.from}) — ${engSpec.label}`);
    else info(`CLEAROTRON_AI is not set — the code default is ${DEFAULT_ENGINE_ID}, and one engine serves every stage of every run on this box`);

    // The line between an ABSENCE and a MISCONFIGURATION. Nothing set and no binary on PATH is a fresh
    // machine — reported, not failed. A variable that names something wrong is a configuration that
    // will fail at run time, and this is the cheap place to learn it.
    // — through `effective`, so the engine binary is found under whichever spelling is set. Read
    // literally, this reported a configured binary as missing on any install the wizard had written.
    const binEff = effective(engSpec.env, [engSpec.env]);
    const binSet = !!binEff;
    const binSetting = binEff?.v || engSpec.fallback;
    const bin = resolveEngineBin(binSetting);
    if (bin.executable && !bin.relative) ok(`${bin.path}`);
    // The FACT only. It used to carry "install it for a real run (`npm run example` needs no engine)",
    // which is the absence framing was filed about — and it now says half of what the MODE line
    // below says, in worse words. One statement of a state, in the place that states states.
    else if (!binSet) info(`no \`${engSpec.fallback}\` on PATH`);
    // Relative is reported BEFORE not-executable. A relative path that also does not resolve from the
    // current directory would otherwise be reported as a missing file, sending the reader to check the
    // file — and the file is usually fine. The relativity is the defect.
    else if (bin.relative) problem(`${engSpec.env}="${binSetting}" is RELATIVE — stage subprocesses run with cwd set to the run directory, so it will not resolve there. Use an absolute path (${bin.path} from here)`);
    else if (!bin.path) problem(`${engSpec.env}="${binSetting}" resolves to nothing on PATH`);
    else problem(`${engSpec.env}="${binSetting}" → ${bin.path} is not an executable file`);

    // ── — WHICH MODE THIS INSTALL IS IN, said as a mode rather than as a list of absences ──────
    //
    // Everything above reports what is or is not resolvable. A first-time reader cannot tell a
    // DELIBERATE limited mode from a botched install by reading that, and the lines they meet on a
    // clean box — "install it for a real run", "a real run will refuse" — describe only what they do
    // not have. `npm start` seeds an example report into the pool, so the no-engine state is a product
    // someone can use: a portal with a finished clearance in it, its audit trail, and MCP. Everything
    // works except starting a NEW run.
    //
    // ASKED OF engineInventory, WHICH IS THE ONE COMPUTATION. This block used to be the only place the
    // state was worked out, and flag-snapshot.mjs worked it out again from the same table — two copies
    // of one answer, which is the shape was filed about, one level up from where it landed. The
    // diagnostics above stay: the inventory collapses absent / not-executable / relative / win32 into a
    // single bit on purpose, and which one it is is exactly what a reader needs from THIS command.
    //
    // THE ENV IS NORMALISED FIRST, and that is not a formality. `preflightEngineBinary` reads
    // `env[spec.env]` — the CURRENT spelling only — and this file is deliberately not a CLI entry, so
    // the alias layer has not run here. Handed raw process.env it would miss a binary configured
    // under the legacy name and report DEMO on a box that has an engine.
    const invEnv = { ...process.env };
    for (const k of ["CLEAROTRON_AI", ...Object.values(ENGINE_BINARIES).flatMap((x) => [x.env, x.authEnv, x.apiKeyEnv])]) {
      if (!k) continue;
      const e = effective(k, [k]);
      if (e) invEnv[k] = e.v;
    }
    const installMode = engineMode(engineInventory(invEnv));
    if (installMode === ENGINE_MODES.DEMO) {
      info("MODE: demo — everything works except starting a NEW search. The example report, its audit trail "
        + "and the MCP connection are live right now; `npm run example` needs no engine.");
      info(`To leave demo: install ${engSpec.vendor}'s CLI (\`${engSpec.fallback}\`), then ${engSpec.signIn}.`);
    } else {
      info("MODE: engine attached, sign-in UNPROVEN — a binary resolves, and whether it can complete a turn "
        + "is not knowable from the filesystem. --probe-engine is what settles it.");
    }

    // item 5 — WHICH BILLING LANE, reported rather than left to be inferred from a variable's
    // absence. `--check` named the engine and its binary and never said how the box pays, so the two
    // states that matter — metered per token, or drawn against a subscription — were indistinguishable
    // in the one command a reader runs to find out what they have configured.
    //
    // Asked of `resolveAuthMode`, not of the raw variable, because the default is the answer for most
    // boxes and a reader needs the RESOLVED lane. Its refusal (api-key mode with no key) is reported
    // here as the problem it is: that .env cannot run a stage, and finding out at `--check` is the
    // entire point of the command.
    try {
      // Same construction as the probe env below: the environment as a RUN would see it, with the .env's
      // values overlaid for exactly the keys this answer depends on and no others.
      const envForResolve = { ...process.env };
      for (const k of [engSpec.authEnv, engSpec.apiKeyEnv]) {
        const e = k ? effective(k) : null;
        if (e) envForResolve[k] = e.v;
      }
      const auth = resolveAuthMode({ engineName: engineId, env: envForResolve });
      if (auth.mode === "unknown") info(`billing lane: not policied for ${engineId} — this engine declares no auth modes`);
      else ok(`billing lane: ${auth.mode}${auth.apiBilled ? ` — metered per token against ${engSpec.apiKeyEnv}` : " — drawn against the signed-in subscription, not metered per token"}`);
    } catch (e) {
      problem(String(e?.message ?? e));
    }

    // An executable file is not a working engine, and this command says so rather than implying
    // otherwise by staying silent.
    if (!PROBE_ENGINE && installMode === ENGINE_MODES.DEMO) {
      // — DEMO DOES NOT ADVERTISE THE PROBE. The generic line below sends the reader to spend a
      // turn; with nothing to spawn, --probe-engine answers "there is no usable binary to probe" and the
      // round trip taught them nothing they were not just told. Advice that cannot pay off is noise in
      // the one command a first-time reader runs to find out what they have.
      info("nothing to probe in demo mode — the sign-in question arrives once a binary does.");
    } else if (!PROBE_ENGINE) {
      info("whether it is SIGNED IN is not checked here — add --probe-engine to spend one cheap turn proving it");
    } else if (!bin.executable || bin.relative) {
      info("not probed — there is no usable binary to probe. Fix the line above first.");
    } else {
      say(`\n  Probing ${engineId} with one ${PROBE_MODEL}-tier turn (this SPENDS; ${PROBE_TIMEOUT_SEC}s ceiling)…`);
      // The engine as a RUN would see it: environment first, .env behind it. Only the engine-selection
      // keys — the probe must bill exactly the way this box bills and moves no other variable.
      const probeEnv = { ...process.env };
      // The auth variables ride this list for the same reason CLEAROTRON_AI does: without them the
      // probe bills the way the AMBIENT environment says rather than the way this .env says, and
      // "proven" would name a lane no run takes.
      for (const k of ["CLEAROTRON_AI", ...Object.values(ENGINE_BINARIES).flatMap((s) => [s.env, s.authEnv])]) {
        const e = effective(k);
        if (e) probeEnv[k] = e.v;
      }
      const v = await probeEngineTurn({ env: probeEnv });
      if (v.ok) {
        ok(`${engineId} completed a turn — binary, credential and model access all work`);
        // The ONLY route to READY. Everything else in this block reads the filesystem, and a signed-out
        // CLI passes every filesystem test there is — which is why this line is here and not above.
        ok("MODE: engine ready — proven by the turn just spent, not inferred from a file being executable.");
      }
      else {
        problem(probeFailureText(v));
        if (v.detail) info(`engine said: ${v.detail}`);
      }
    }
  }

  // ── HOW THIS READER REACHES US, before anything below tells them to type something (issue 1916) ──
  //
  // Every advice line in this report composes through invocationPrefix(), and until this issue that
  // helper could only choose between two spellings, both of which resolve only from inside the install
  // directory. Doctor is the surface where that bites hardest: it is what somebody runs when something
  // is already wrong, from wherever they happen to be.
  //
  // An absent shim is reported, not passed over. It is the state in which every command below names a
  // directory, and a reader who does not know that reads the `cd …` as clutter rather than as the
  // instruction it is.
  say("\n  How to run this");
  {
    const form = invocationForm();
    if (form.staleInterpreter) {
      // A TICK OVER AN UNCHECKED CLAIM IS THE FAILURE. The shim records the interpreter it was written
      // with; an nvm upgrade removes that path and the shim then dies in /bin/sh, which is exactly the
      // not-our-error this issue exists to stop. Doctor is the surface that must not say "works from
      // anywhere" over it.
      problem(`${form.shim} names an interpreter that is gone: ${form.staleInterpreter}`);
      info(`it will fail with a shell error, not ours — re-run \`${invoke("install")}\` to rewrite it`);
    } else if (form.form === "bare") ok(`\`clearotron\` is on your PATH (${form.shim}) — every command below works from anywhere`);
    else if (form.form === "shim-path" && form.shadowedBy) {
      warn(`a different \`clearotron\` is earlier on your PATH: ${form.shadowedBy}`);
      info(`this install's own is ${form.shim} — the commands below name it in full, so they reach THIS install`);
    } else if (form.form === "shim-path") {
      warn(`${form.dir} is not on this shell's PATH, so the bare \`clearotron\` will not resolve here`);
      info(`add it with: export PATH="${form.dir}:$PATH"  — or open a new login shell`);
    } else if (form.shimKind === "ours-other-install") {
      warn(`${form.shim} is a shim for a DIFFERENT install (${form.otherInstall})`);
      info(`re-run \`${invoke("install")}\` to point the bare name at this one`);
    } else if (form.shimKind === "foreign") {
      warn(`${form.shim} exists and was not written by this product — the bare name is not ours here`);
    } else {
      info(`no \`clearotron\` on your PATH — re-run \`${invoke("install")}\` to put one there`);
    }
  }

  say("\n  .env");
  if (!existsSync(ENV_PATH)) {
    const lost = configurationLostToUpgrade({ envPath: ENV_PATH, installDir: resolve(REPO) });
    if (lost) {
      problem(`no .env at ${ENV_PATH}, and this install's data directories are all present under ${lost.base}`);
      info("an `npm install` in this project replaced the package tree and took the configuration with it — "
        + "npm owns that directory and makes no promise about files written into it. Nothing in "
        + `${lost.base} was touched: the reports, workspaces and queues are all still there.`);
      info(`re-run \`${invoke("install")}\` to write a new .env — it will ask the same questions, and the `
        + "answers that name those directories are the paths above");
    } else info(`none at ${ENV_PATH} — run: ${invoke("install")}`);
  } else {
    ok(`${ENV_PATH}`);
    const mode = statSync(ENV_PATH).mode & 0o777;
    if (mode & 0o077) warn(`mode ${mode.toString(8)} — it holds credentials; 600 is the mode for that`);
  }

  // — WHERE CONFIGURATION RESOLVES FROM, and whether that is inside the checkout.
  //
  // Unset is a REPORTABLE STATE, not silence: unset means this install is running our bundled demo
  // customers and our doctrine, which is a fine way to start and a bad thing to discover later from a
  // clearance that used a framework the reader did not choose. Inside-the-checkout is worse than unset
  // and is called a problem, because it is the state whose cost only arrives at the next `git pull`.
  say("\n  Configuration store");
  {
    const inCheckout = (p) => isInsideCheckout(p, REPO);
    for (const [name, what] of [
      ["CLEAROTRON_CUSTOMERS_DIR", "customers resolve to the bundled demo roster IN this checkout"],
      ["CLEAROTRON_INSTRUCTIONS_DIR", "doctrine resolves to the bundled files IN this checkout"],
      ["PROFILE_REPO_ROOT", "the portal's profile editor commits INTO this checkout"],
    ]) {
      // — WHICH NAME THE READER IS TOLD IS NOT ONE QUESTION, IT IS TWO.
      //
      // "not set" is advice: it tells someone what to go and write, so it must name the CURRENT
      // spelling — the one §3 rules wins. Telling them to set a retired name is how a fresh install
      // ends up configured in a vocabulary that is on its way out.
      //
      // Every other line here reports what they ALREADY set, so it must name the spelling THEY used —
      // `e.name`, the one `effective` actually found. A reader who set the retired name and is told
      // about the current one cannot find the line they wrote; a reader who set the current name and is
      // told about the retired one goes looking for a variable they never touched. That second case is
      // the one measured, and it is why this is not a blanket rename.
      const e = effective(name);
      if (!e) { info(`${name} is not set — ${what}`); continue; }
      if (!existsSync(e.v)) problem(`${e.name}=${e.v} (${e.from}) does not exist — this is a hard error at run time, not a fallback`);
      else if (inCheckout(e.v)) problem(`${e.name}=${e.v} (${e.from}) is INSIDE the checkout — edits here become local modifications to our files, and \`git pull\` will conflict`);
      else ok(`${e.name}=${e.v} (${e.from})`);
    }

    // ── AND WHAT THAT ACTUALLY RESOLVES TO, from the resolver the RUN uses ────
    //
    // The lines above report the VARIABLES. This reports the RESOLUTION, and it comes from
    // `profileStoreResolution()` in profiles.mjs — the same function that stamps every run's
    // `profile-store` journal line — so doctor and a run cannot disagree about where profiles come
    // from. Two readers, one derivation; a second implementation here would be a report that agrees
    // with itself.
    //
    // WHAT THIS CANNOT TELL YOU, said plainly because the incident turned on exactly this: doctor
    // reports THIS process's environment, and the process that executes runs is the supervisor. Those
    // were different for a day — the enqueue side had the store directories and the drain side had
    // none, every customer silently resolved to the bundled demo roster, and no operator running this
    // command by hand would have seen it. The authority for what a RUN used is that run's own
    // `profile-store` line, not this one.
    try {
      const mod = await import(`../driver/profiles.mjs?doctor=${Date.now()}`);
      const r = mod.profileStoreResolution();
      const where = `profiles resolve from ${r.store}`;
      if (r.situation === "overlay" && !r.findings.length) ok(`${where} — the configured store`);
      else if (r.situation === "bundled-fallback") info(`${where} — THE BUNDLED DEMO ROSTER, because CLEAROTRON_CUSTOMERS_DIR is unset. Legitimate on a generic-defaults install; a fallback either way, and it is what a misconfigured deployment also looks like`);
      else if (r.situation === "env-arrived-late") problem(`CLEAROTRON_CUSTOMERS_DIR is set in this environment but was not set when the profile module loaded, so it is NOT in force — ${where}. Export it before the process starts`);
      else problem(`${where} — ${r.detail}`);
      info("what a RUN used is its own `profile-store` journal line — this command reports the environment you are typing in, not the supervisor's");
      // ── AND WHO IS ACTUALLY IN IT ─────────────────────────────────────────
      //
      // The line above names the STORE. An operator who has just configured one wants to know their
      // overlay took effect, and a path does not answer that — `brandowner add` even ends by telling
      // them "doctor will now resolve <key>", which until now doctor could not confirm.
      //
      // FROM THE SAME MODULE INSTANCE as the resolution above, deliberately: a second import would be a
      // second answer to "which store", and the whole point of this block is that there is one.
      //
      // A ROSTER THAT WILL NOT LOAD IS A FINDING, NOT A BLANK. loadProfiles throws for the WHOLE roster
      // on a cross-profile conflict — two brand owners claiming one domain — so the failure that most
      // needs reporting is exactly the one that produces no list. Reported by name; never as "none".
      try {
        const roster = mod.loadProfiles({ force: true });
        const keys = [...roster.keys()].sort();
        const demo = keys.filter((k) => roster.get(k)?.demoData === true);
        // `generic` is the universal fallback the module requires by name, not a brand owner somebody
        // onboarded — counting it would tell an operator with an empty store that they have one.
        const owners = keys.filter((k) => k !== "generic");
        if (!owners.length) {
          info(`no brand owners resolve here — only the \`generic\` fallback. An empty store is a working `
            + `install on Generic defaults; it is also what a store pointed at the wrong directory looks like`);
        } else {
          const marked = owners.map((k) => (demo.includes(k) ? `${k} (DEMO DATA)` : k)).join(", ");
          const line = `${owners.length} brand owner(s) resolve here: ${marked}`;
          // The demo marker is the member-level half: naming the store is not the
          // same as saying the accounts in it are fiction, and a real clearance under one is refused at
          // the admission wall — which an operator should learn here rather than from that refusal.
          if (demo.length) info(`${line} — accounts marked DEMO DATA cannot start a real clearance`);
          else ok(line);
        }
        try {
          const projects = mod.loadProjects({ force: true, profiles: roster });
          // `projectKey`, with no fallback. A `?? o.key` here is dead — the loader has no `key` on a
          // project — and a dead fallback that prints "undefined" hides the defect it pretends to cover.
          const names = [...projects.values()].map((o) => `${o.customerKey}/${o.projectKey}`).sort();
          if (names.length) ok(`${names.length} project(s): ${names.join(", ")}`);
          else info("no projects resolve here — the store has no `projects/` tree, which is a complete install unless you added one");
        } catch (e) {
          problem(`the project overlays did not load (${String(e?.message ?? e).slice(0, 160)}) — a project `
            + `under an unknown brand owner stops the whole tree, so this is not "no projects"`);
        }
      } catch (e) {
        problem(`the roster did not load (${String(e?.message ?? e).slice(0, 160)}) — this is a refusal to `
          + `load, not an empty store, and every customer resolution fails until it is fixed`);
      }
      // ── CRITERION 3 OF — DO THE TWO SURFACES SERVE ONE STORE? ────────────────
      //
      // The block above reports where the RUN roster resolves from. This asks the same question of the
      // SETTINGS surface — Brand profile, Projects, Custom searches — and reports a disagreement rather
      // than leaving it to be discovered by a client. It was discovered by a client: every brand owner
      // added the documented way met "These settings are not available to you" while their clearance ran
      // fine under the same framework, because the surface read a second directory nothing configured.
      //
      // AFTER 1923 THESE AGREE BY CONSTRUCTION, which is exactly why the check is worth keeping: it is
      // the regression arm for the whole class. Anything that reintroduces a second source — a resurrected
      // PROFILE_DIR, a bundled directory that moves under one caller and not the other — shows up here as
      // a named disagreement instead of as a tenancy refusal a reader will read as a permissions problem.
      try {
        const cs = await import(`../shared/customer-store.mjs?doctor=${Date.now()}`);
        const surface = cs.customerStoreDir({ bundledDir: mod.profilesStoreDir });
        const split = cs.customerStoreDivergence({ surfaceDir: surface.dir, rosterDir: r.store });
        if (split) {
          problem(`the settings surface and the run roster serve DIFFERENT customer stores — settings: `
            + `${split.surface}, runs: ${split.roster}. A brand owner in one and not the other is refused `
            + `by the surface with a tenancy message, which reads as a permissions problem and is not one.`);
        } else {
          ok(`the settings surface serves the same store as the runs (${surface.dir})`);
        }
      } catch (e) {
        info(`could not compare the settings surface's store with the roster's (${String(e?.message ?? e).slice(0, 80)}) — a failure to look, not a finding`);
      }
    } catch (e) {
      info(`could not resolve the profile store from here (${String(e?.message ?? e).slice(0, 80)}) — read a run's \`profile-store\` line instead`);
    }
  }

  // — WHICH DOCTRINE FILES THIS INSTALL OVERRIDES, AND WHETHER OURS HAVE MOVED UNDER THEM.
  //
  // The report itself shipped in and worked, reachable only as `npm run doctrine-report` — a name
  // a self-hoster has no reason to type, in no documented flow. So the mechanism existed and the thing
  // the issue asked for did not: `clearotron doctor` had zero references to doctrine or overlay, and
  // the criterion names `doctor`. A component that is built and never wired passes every existence
  // check and delivers nothing.
  //
  // Doctrine files are prompt payload — driver/skills/README.md is explicit that an edit for brevity
  // changes what a clearance concludes. A user running silently stale doctrine is getting different
  // answers than they think, and an overridden file that is merely out of date fails no test. This is
  // the only thing that tells them.
  //
  // REPORTS, NEVER JUDGES: nothing here sets `problem()`. Drift is information for the reader, not a
  // fault in their install, and a doctor that called their own overrides broken would be wrong.
  say("\n  Doctrine overlay");
  try {
    const report = overlayReport({ baseRoot: config.skillsBaseDir, overlayRoot: config.skillsOverlayDir });
    for (const line of renderOverlayReport(report, { indent: "" })) say(`  ${line}`);
    if (report.ok && report.overlayConfigured) say("\n  Full detail: npm run doctrine-report");
  } catch (e) {
    // An unreadable overlay THROWS by design (config.resolveSkillPath refuses rather than falling back
    // to the product's copy). Surfaced here rather than allowed to abort the whole check: the doctor's
    // job is to report every section, and a section that kills the run tells the reader least.
    problem(`the doctrine overlay could not be read — ${e.message}`);
  }

  say("\n  Register provider");
  const prov = effective("CLEAROTRON_DATABASE");
  // `blocking`, not `warn` and not `problem`. The exit status is a CONTRACT — an absence reports and
  // exits 0, a misconfiguration exits 1, and onboard-wizard.test.mjs holds it — so this cannot become a
  // `problem` however much it stops the reader: an install that has not chosen a register yet is
  // unfinished, not broken, and `install` is allowed to end that way. But plain `warn` was how the
  // closing line came to say "Nothing wrong with what is configured" above a sentence reading "every
  // search refuses until one is". `blocking` prints the same `!` and is named in the verdict, so the
  // reader who reads only the last line is told what the reader who read every line was told.
  if (!prov) {
    blocking(`no register is selected — CLEAROTRON_DATABASE is not set and there is NO default, so every search refuses until one is`);
    info(`  set it to one of: ${PROVIDERS.map((p) => p.id).join(", ")} — any one of them is enough, and none needs another`);
    info(`  re-run \`${invoke("install")}\`, or set it on the Global config page`);
  }
  else {
    const spec = PROVIDERS.find((p) => p.id === prov.v);
    if (!spec) problem(`CLEAROTRON_DATABASE="${prov.v}" (${prov.from}) names no adapter — one of: ${PROVIDERS.map((p) => p.id).join(", ")}`);
    else {
      ok(`${spec.id} — ${spec.label} (${prov.from})`);
      for (const k of spec.credentials) {
        const c = effective(k);
        // issue 1871 — SET, not WORKING, and the line now says which. An operator reads a tick as "this
        // works"; this one is equally true of a valid key, an expired key, a key scoped to the wrong
        // account and forty characters of nonsense. --probe-providers is what settles it.
        if (c) ok(`${k} present (${c.from}) — presence only; add --probe-providers to prove it retrieves`);
        else problem(`${k} is required by ${spec.id} and is not set — a run cannot verify a registry citation without it`);
      }
      // An absent OPTIONAL credential narrows the search; it does not stop it. Reported as information
      // and never as a problem, but never silently either: the reader has to know which offices this
      // box will not reach before they read a report that says nothing was found there.
      for (const k of spec.optionalCredentials ?? []) {
        const c = effective(k);
        if (c) ok(`${k} present (${c.from}) — presence only; add --probe-providers to prove it retrieves`);
        else info(`${k} is NOT set — ${spec.id} will run without it and DISCLOSE the offices it cannot reach as deferred coverage. Set it to search them.`);
      }
    }
  }

  say("\n  Research provider");
  const px = effective("PERPLEXITY_API_KEY");
  if (px) ok(`PERPLEXITY_API_KEY present (${px.from}) — presence only; add --probe-providers to prove it answers`);
  else info("PERPLEXITY_API_KEY is not set — the three clearance searches carry the common-law grid and cannot switch it off, so a clearance refuses at preflight; a Knockout search still runs and discloses the half it skipped");

  // ── — THE LANES A PRODUCT DECLARES IT NEEDS, BEFORE A REPORT NAMES THEM ──
  //
  // The owner ran a Full country search on his own install and the finished report told him, after two
  // and a half hours and real spend, that case law had not been reached. He looked for the source
  // afterwards: "Legal data hunter MCP was NOWHERE in setup - and it was NOWHERE in the global config
  // (showing connection) neither was it flagged when selecting the report in the new clearance screen."
  //
  // This is the screen a reader checks BEFORE spending, so this is where it belongs. The rows come from
  // `caseLawInventory`, derived from the list that actually decides what the engine spawns, so a source
  // added to the build reaches this screen the same day rather than the day somebody remembers it.
  //
  // A FILE READ, NEVER A PROBE. The doctor does not reach the network — a doctor that fetches is a
  // doctor that hangs on a box with no route — so this reports ENROLMENT, and says plainly that a
  // source which is enrolled can still fail at run time. The owner's own report says `CONNECTION_CLOSED`
  // on exactly that case.
  say("\n  Case law and other capabilities");
  {
    const { caseLawInventory } = await import("../driver/config-inventory.mjs");
    const rows = caseLawInventory(process.env);
    const caseLaw = rows.filter((r) => r.key === "caselaw");
    const { PRODUCTS } = await import("../driver/products.mjs");
    // NAMED FROM THE DECLARATION, not typed: the product that needs this is whichever one says so.
    const needs = PRODUCTS.filter((pr) => pr.caseLaw).map((pr) => pr.name);
    for (const r of caseLaw) {
      // ── AN ABSENCE IS NOT A MISCONFIGURATION, and `--check` must exit 0 on one ──────────────────
      //
      // The doctor's own contract: a fresh machine with nothing set up is REPORTED and exits 0; a
      // configuration that will fail at run time is what exits non-zero. A case-law source nobody has
      // signed in to yet is the first of those — it is the normal state of a new install, and every
      // other search is unaffected — so it is a `warn`, which says it out loud and leaves the exit code
      // alone. Nothing here can be misconfigured: there is no variable to get wrong.
      if (r.configured && !r.remedy) ok(`${r.providerLabel} — ${r.enrolment === "oauth" ? "enrolled" : "part of this build, nothing to set up"}`);
      else if (r.configured || !r.known) info(`${r.providerLabel} — ${r.remedy}`);
      else warn(`${r.providerLabel} — ${r.remedy}`);
    }
    // KEYED ON THE ROWS THAT CAN BE ENROLLED. EUR-Lex is part of the build and always reads as
    // configured, so "any configured case-law row" would report every box as ready — including the one
    // this section was written for.
    if (caseLaw.some((r) => r.enrolment === "oauth" && r.configured)) {
      info("enrolled is not reachable: a source that is set up can still fail during a run, and the report "
        + "discloses that rather than reporting no adverse case law");
    } else if (needs.length) {
      warn(`No case-law source is enrolled, so ${needs.join(" and ")} — the ${needs.length === 1 ? "one product" : "products"} `
        + "that declares it needs case law — will run and disclose the gap instead of reasoning against precedent");
    }
    for (const r of rows.filter((r) => r.key !== "caselaw")) {
      info(`${r.providerLabel} — ${r.remedy ?? (r.configured ? "configured" : "not set up")}`);
    }
  }

  // ── issue 1891 — WHICH DOOR GUARDS THE PORTAL, AND IS IT CONFIGURED ────────────────────────────
  //
  // Neither screen said anything about the portal's front door. A stranger install lands in `local` and
  // stops, so a deployment MEANT to sit behind an identity proxy looks exactly like one that is not —
  // and the way that failure presents is a client reaching a passphrase box the operator never expected
  // to be there. The door is not a credential, so it sat in the gap between the credential rows and the
  // config rows and neither claimed it.
  //
  // `authView` is the one describer, shared with the portal's own config page: it normalises the mode
  // the way the SERVICE does (an unset mode is the fronted default, `cf-access` resolves to
  // `auth-proxy`), so this screen cannot disagree with the door it reports on.
  //
  // NAMES ONLY, NEVER VALUES. `proxyValues` carries presence, and the issuer's value — which this page
  // could print, and the portal's own config view does — is deliberately not printed here: `doctor` goes
  // to a terminal, into a paste, into an issue.
  // THE ONE CONDITION THAT STOPS THE PORTAL RENDERING, and `doctor` said nothing about it at all
  // (bb8, F2). `portal-ui/dist` is committed, so an absent bundle means a bad checkout on
  // a deployment and an unbuilt tree on a source clone; the service already answers 503 and says so in
  // its boot log, but a reader who runs `doctor` BEFORE `start` — which is the order every document
  // gives — had no way to learn it. The product's OWN predicate decides rather than a second existence
  // check written here: `makeStaticHandler(...).present()` is the question the service asks, so the two
  // cannot drift into disagreeing about what "present" means.
  say("\n  Portal bundle");
  try {
    const { makeStaticHandler } = await import("../driver/portal-static.mjs");
    const distDir = join(REPO, "portal-ui", "dist");
    const srcDir = join(REPO, "portal-ui", "src");
    const distPresent = makeStaticHandler({ distDir }).present();
    // PRESENT WAS NEVER THE WHOLE QUESTION. See bundleFreshness for why the
    // route is decided before any timestamp is read, and why only one of the three routes may be judged
    // on one. The presence half still comes from the service's own predicate rather than a second
    // existence check written here, so the two cannot drift about what "present" means.
    const standing = gitStanding("portal-ui/dist", REPO);
    const verdict = bundleFreshness({
      srcPresent: existsSync(srcDir),
      distPresent,
      isGitCheckout: standing.isGitCheckout,
      distTracked: standing.tracked,
      distGated: distGateInTree(REPO),
      distMtime: distPresent ? newestMtimeUnder(distDir) : 0,
      newestSrcMtime: newestMtimeUnder(srcDir),
    });
    if (verdict === "stale") {
      // A MISCONFIGURATION, NOT AN ABSENCE, and rc 1 for the same reason the .env branch above gives:
      // nothing is missing here. What is present is WRONG, the product will serve it without complaint,
      // and the reader has no other surface that would tell them — /portal/health reads "built".
      problem(`the bundle at ${distDir} is OLDER than the sources it was built from (${srcDir})`);
      info("`git pull` cannot update it — the bundle is not tracked here, so an upgrade moves the sources "
        + "and leaves the build behind, and /portal serves the previous screen and reports itself healthy");
      info("rebuild it: `npm run build:ui`");
    } else if (verdict === "unbuilt") {
      blocking(`no UI bundle at ${distDir} — /portal answers 503 until one is built. Build it: \`npm run build:ui\``);
    } else if (verdict === "no-sources") {
      // The tarball. The bundle ships inside it and portal-ui/src does not, so there is nothing to be
      // stale against and an upgrade replaces both together. Said, rather than left as a silent pass.
      ok(`portal-ui/dist is present — this is a packaged install, so the bundle ships with the sources it was built from`);
    } else if (verdict === "tracked-unguarded") {
      // Reported, rc 0: nothing is misconfigured and nothing is known to be stale. What is missing is the
      // check, and a reader who committed the bundle has every reason to believe committing was enough.
      blocking(`portal-ui/dist is committed here, but nothing in this tree rebuilds it to check it still matches ${srcDir}`);
      info("a pull that changes the sources will not show up here — rebuild after one: `npm run build:ui`");
    } else if (verdict === "unmeasured") {
      blocking(`portal-ui/dist is present, but its age could not be read against ${srcDir} — whether it is current is unknown`);
      info("if /portal is serving a screen you do not recognise, rebuild before looking further: `npm run build:ui`");
    } else if (verdict === "unversioned") {
      ok(`portal-ui/dist is present — this tree is not a git checkout, so no pull can have left it behind`);
    } else if (verdict === "guarded") {
      ok(`portal-ui/dist is present and tracked here — CI rebuilds it and fails on any difference, so it matches ${srcDir}`);
    } else {
      ok(`portal-ui/dist is present and newer than ${srcDir} — /portal has the current screen to serve`);
    }
  } catch (e) {
    // A could-not-look, and it is NOT a pass: the reader learns nothing about whether the portal can
    // render, which is the same position they were in before this section existed.
    blocking(`the portal bundle could not be read — ${e.message} — so whether /portal can render is unknown`);
  }

  // ── THE TRIGGER KEY, AND THE DEADLINE NOBODY WAS COUNTING (tracker issue 161) ────────────────────
  //
  // A `--background` install stores the portal's trigger key in `~/.env`, the file the units load, and
  // it is minted with a thirty-day life. Nothing counted it down. Thirty days after an install, on a
  // server nobody has touched, every Start stops — and the portal reports the refusal as an upstream
  // fault, which reads like a broken engine rather than an expired key card. `doctor` printed nothing
  // about it at all: no line, no expiry, rc 0.
  //
  // READ FROM `~/.env` BY NAME, because that file is deliberately not the one this command loads. The
  // CLI reads its own `.env`; the units read theirs; the two are disjoint, so `process.env` here would
  // answer about the wrong file and, on a foreground install, about nothing at all.
  //
  // NAMES AND DATES, NEVER THE TOKEN. This output goes to a terminal, into a paste, into an issue.
  say("\n  Portal trigger key");
  {
    const homeEnvPath = join(homedir(), ".env");
    const stored = existsSync(homeEnvPath) ? (readEnvFile(homeEnvPath).PORTAL_OPS_TOKEN ?? "") : "";
    if (!stored) {
      // NOT A PROBLEM, and not a tick either. A foreground install has no stored key by design — the
      // launcher hands it to the children in memory. Saying which case this is beats silence, which is
      // what the reader used to get whether or not they had one.
      info(`none in ${homeEnvPath} — this install runs in the foreground, where the key is minted per start and never stored`);
    } else {
      const { opsTokenPosture } = await import("../driver/portal-service.mjs");
      const posture = opsTokenPosture(stored);
      if (!posture.readable) {
        problem(`the trigger key in ${homeEnvPath} cannot be read as one — the portal will refuse every Start with "invalid access key: malformed token"`);
        info(`re-mint it by running the launcher again: ${invoke("start --background")}`);
      } else if (posture.expired) {
        problem(`the trigger key expired ${posture.expiresAt} — every Start is refused, and the portal reports it as an upstream fault`);
        info(`re-mint it by running the launcher again: ${invoke("start --background")}`);
      } else if (posture.expiresAt === null) {
        // An unreadable deadline is not a good one. `implausibleExp` separates a broken claim from none.
        blocking(`the trigger key in ${homeEnvPath} carries ${posture.implausibleExp ? "an expiry that makes no sense" : "no expiry"}, so how long it has cannot be read`);
      } else if (posture.daysLeft <= 7) {
        // REFUSED NEAR IT, not only after. A key with days left is a booked outage: the reader who runs
        // `doctor` this week can re-mint it in one command; the one who finds out at expiry is reading
        // an engine fault that is not one.
        problem(`the trigger key expires in ${posture.daysLeft} day(s), on ${posture.expiresAt}`);
        info(`re-mint it now, before it lapses: ${invoke("start --background")}`);
      } else {
        ok(`the trigger key is good for ${posture.daysLeft} more day(s), until ${posture.expiresAt}`);
      }
    }
  }

  say("\n  Portal door");
  {
    const { authView } = await import("../driver/portal-config-view.mjs");
    const door = authView({
      mode: effective("PORTAL_AUTH_MODE")?.v ?? "",
      oidcIssuer: effective("PORTAL_OIDC_ISSUER")?.v ?? "",
      team: effective("CF_ACCESS_TEAM")?.v ?? "",
      jwksUrl: effective("PORTAL_JWKS_URL")?.v ?? "",
      emailClaim: effective("PORTAL_EMAIL_CLAIM")?.v ?? "",
      authHeader: effective("PORTAL_AUTH_HEADER")?.v ?? "",
    });
    const typed = door.declared ? `PORTAL_AUTH_MODE=${door.declared}` : "PORTAL_AUTH_MODE is unset";
    // NOT A TICK, AND THAT IS THE POINT. This reads the environment THIS command is
    // typed in. `bin/start.mjs` INJECTS `PORTAL_AUTH_MODE: "local"` into the portal's own environment,
    // and a systemd unit's EnvironmentFile can name a third thing — so a green tick here was a
    // confident claim about a door the running service may not be serving. Measured on the test box:
    // doctor said `auth-proxy door (PORTAL_AUTH_MODE is unset)` with a tick while the box served
    // cf-access, and said `local passphrase door` with a tick while it still served cf-access. Both
    // green, neither the door a caller meets.
    //
    // The reading is still worth printing — it is what a hand-run process here would use, and it is
    // what `clearotron start` would launch from. It is stated as that, and the sentence below says
    // where the running answer lives.
    info(`what THIS environment implies, not what the running service serves — a portal started by `
      + `\`${invocationPrefix()}clearotron start\` is launched with PORTAL_AUTH_MODE injected, and a systemd unit's `
      + `EnvironmentFile can differ again. The running door is in the service's own boot log.`);
    if (door.shape === "local") {
      say(`  · local passphrase door (${typed}) — one operator, one passphrase, no identity provider`);
      info(`a lost passphrase is recoverable: ${invocationPrefix()}clearotron passphrase --reset`);
    } else if (door.shape === "fronted") {
      say(`  · auth-proxy door (${typed}) — identity is proved by whatever sits in front, and this process trusts it`);
      for (const v of door.proxyValues) {
        if (v.present) ok(`  ${v.name} present`);
        else info(`  ${v.name} not set`);
      }
      if (door.missing.length) {
        info(`the service REFUSES to start on a fronted mode with neither ${door.missing.join(" nor ")} — set one`);
      }
    } else {
      info(`PORTAL_AUTH_MODE=${door.declared} is not a mode this product knows (local, auth-proxy) — the portal will not start`);
    }
    info("what each door proves, and what an unset guest list means: docs/SECURITY.md");

    // ── CAN ANYBODY ACTUALLY USE IT? ────────────────────────────────────────
    //
    // The door is only half the question. The owner signed into the test portal and every action
    // refused — submitting a search, saving a custom search, loading the Generic defaults — because his
    // identity was on no staff domain and in no grants row, so it held no accounts. Three symptoms,
    // one cause, and the product KNEW: portal-service logs a warning at boot naming the identity, both
    // conditions, both variables and the remedy. It was invisible to everyone who needed it, because
    // the operator was in a browser and whoever restarted the service checked ports, not the log.
    //
    // ASKED OF `makePrincipal`, the function the door itself uses, so this cannot drift from the
    // refusal it predicts. A second opinion about who holds access is how a report comes to disagree
    // with the thing it reports on.
    //
    // OFFLINE, and that is what makes it worth having here: if no staff domain is set AND the grants
    // file holds no rows, then NO identity can hold access — whoever signs in, whatever the door. That
    // is knowable from the filesystem, so `--check` can answer it without calling anybody, which is
    // this command's whole contract.
    try {
      const { makePrincipal } = await import("../driver/portal-access.mjs");
      const staffDomains = String(effective("PORTAL_STAFF_DOMAINS")?.v ?? "")
        .split(",").map((d) => d.trim()).filter(Boolean);
      const grantsFile = effective("CLEAROTRON_ACCESS_FILE")?.v ?? "";
      let grants = null, unreadable = null;
      if (grantsFile) {
        try { grants = JSON.parse(readFileSync(grantsFile, "utf8")); }
        catch (e) { unreadable = String(e?.message ?? e).slice(0, 120); }
      }
      const rows = Object.values(grants?.tenants ?? {})
        .reduce((n, t) => n + Object.keys(t?.users ?? {}).length, 0);

      if (unreadable) {
        problem(`the guest list at ${grantsFile} could not be read (${unreadable}) — the portal refuses `
          + `every request while that is true, and this is a failure to look rather than an empty list`);
      } else if (!staffDomains.length && !rows) {
        // PRESENT-AND-WRONG vs ABSENT. A configured portal that grants nobody is wrong: every page
        // refuses and the symptom reads as a broken login. A box that has configured neither is a
        // fresh install, which is loud but not a failure — the same rule the rest of this command uses.
        const configured = Boolean(grantsFile) || Boolean(effective("PORTAL_AUTH_MODE")?.v);
        const sentence = "NOBODY can use this portal: no staff domain is set (PORTAL_STAFF_DOMAINS) and "
          + `the guest list holds no rows${grantsFile ? ` (${grantsFile})` : " (CLEAROTRON_ACCESS_FILE is unset)"}. `
          + "Any identity that signs in is refused at the door on every page, which reads as a broken "
          + `login rather than as missing access. Fix with \`${invocationPrefix()}clearotron grant add\`, `
          + "or by setting a staff domain.";
        if (configured) problem(sentence); else info(sentence);
      } else {
        const who = [];
        if (staffDomains.length) who.push(`${staffDomains.length} staff domain(s): ${staffDomains.join(", ")}`);
        if (rows) who.push(`${rows} guest-list row(s)`);
        ok(`somebody can use this portal — ${who.join(", ")}`);
        // AND THE ONE IDENTITY THIS BOX SIGNS IN, when the local door is what this environment implies.
        // NAMES the address because it is this operator's own, on their own box, in a report they asked
        // for — the same address `clearotron start` prints back at them.
        const localUser = effective("PORTAL_LOCAL_USER")?.v ?? "";
        if (door.shape === "local" && localUser) {
          if (makePrincipal({ email: localUser, grants, staffDomains })) ok(`  and ${localUser} is one of them`);
          else problem(`  but ${localUser} — the identity this box's local sign-in produces — is on no staff `
            + `domain and in no guest-list row, so it signs in and is then refused on every page`);
        }
      }
    } catch (e) {
      info(`could not judge who may use the portal (${String(e?.message ?? e).slice(0, 80)}) — a failure to look, not a finding`);
    }
  }

  // ── issue 1871 — PROVE THE REGISTER LANE, or say plainly that presence is all this knows ────────
  //
  // Everything above about a credential is a fact about a FILE. `✓ CLARIVATE_API_KEY present` is equally
  // true of a valid key, an expired key, a key scoped to the wrong account and forty characters of
  // nonsense. The engine has had a real proof since issue 772 and its line says so out loud — "proven by
  // the turn just spent". This is that sentence applied to the other credentials a clearance depends on.
  //
  // OPT-IN, ALWAYS. It SPENDS, and on the `cheap` adapters the count IS an ordinary billable search, so
  // a paired control is two metered calls. What it will spend is printed BEFORE it spends it, read from
  // the provider's own capability rather than a number typed here.
  if (PROBE_PROVIDERS) {
    say("\n  Register lane — proven, not inferred");
    try {
      const [{ activeProvider }, { makeLaneProbe, probeSpend, DEFAULT_CONTROLS, loadProviderCapabilities }] = await Promise.all([
        import(join(REPO, "driver", "driver.config.mjs")),
        import(join(REPO, "providers", "_shared", "lane-probe.mjs")),
      ]);
      const adapter = activeProvider();
      // NOT `adapter.capabilities` — that is null on every adapter, and reading it announced a LOCAL
      // index as a billable search. The declaration lives in the provider's own module. (issue 1871)
      const caps = await loadProviderCapabilities(REPO, adapter?.id);
      const spend = probeSpend(caps);
      say(`  Probing ${adapter?.id ?? "the register lane"} with a paired control `
        + `(${spend.calls} call(s); ${spend.metered === null ? "cost UNKNOWN — capability unreadable"
            : spend.metered ? "BILLABLE — the count rides a real search here" : "not billable"})…`);
      if (typeof adapter?.countHits !== "function") {
        info(`${adapter?.id ?? "this provider"} exposes no countHits — nothing here can prove it. `
           + "That is an absent capability, not a bad credential.");
      } else {
        const r = await makeLaneProbe({ countHits: (q, ctx) => adapter.countHits(q, ctx), capabilities: caps })(
          {}, { agentId: "doctor", sessionKey: "doctor-probe", recordLog: null });
        if (r.state === "proven") {
          ok(`${adapter.id} RETRIEVES — ${r.reason}`);
          if (r.caveat) warn(r.caveat);
        } else if (r.state === "cannot-prove") {
          // NEVER a problem(): nothing was asked and refused. Reporting it as a failure sends an
          // operator to rotate a credential that is fine — the defect issues 1864 and 1874 both closed.
          info(`${adapter.id} CANNOT be proven this way — ${r.reason}`);
        } else {
          problem(`${adapter.id} did NOT retrieve — ${r.reason}`);
          info(`the control mark is ${DEFAULT_CONTROLS.positive.mark}: ${DEFAULT_CONTROLS.positive.why}`);
        }
      }
    } catch (e) {
      // A probe that could not run says so. It is not evidence about the credential either way.
      info(`the register lane could not be probed: ${String(e?.message ?? e)}`);
    }

    const pxKey = effective("PERPLEXITY_API_KEY");
    if (pxKey) {
      say("\n  Research provider — proven, not inferred");
      say("  Spending one cheap search…");
      const v = await validatePerplexity(pxKey.v);
      if (v.ok) ok("PERPLEXITY_API_KEY ANSWERED a real request — the credential works");
      else problem(`PERPLEXITY_API_KEY did not answer: ${v.error}`);
    }
  }

  say("\n  Data-plane paths");
  // Each entry is a FUNCTION, called only on the branch that prints it, so a getter is read at access
  // time and never captured as a constant here. The reader of this command is deciding what to
  // provision; a default quoted from memory is the one thing that can send them to the wrong path and
  // then meet them with a refusal that contradicts what setup just said.
  for (const [k, describeUnset] of [
    // The pool REFUSES when unset, and that refusal is the exact text the reader meets on their first
    // run — it names the variable, says there is no default, and says what the old one cost. Printed
    // whole rather than summarised: a summary is a second copy, and a second copy is what drifted.
    ["CLEAROTRON_REPORTS_DIR", (name) => {
      const d = defaultWith(name, () => config.poolRoot);
      return d.refusal ?? `${name} is not set — the published-report pool falls back to ${d.value}`;
    }],
    ["CLEAROTRON_WORK_DIR", (name) => {
      const d = defaultWith(name, () => config.workspaceRoot);
      return d.refusal ?? `${name} is not set — run directories go to ${d.value}`;
    }],
    ["CLEAROTRON_QUEUE_DIR", (name) => `${name} is not set — the intake queue`],
  ]) {
    const e = effective(k);
    // — the name in every one of these lines is the spelling that ANSWERED, or the current one
    // when nothing did. Naming `k` regardless would tell an operator to set a retired variable, and
    // would report a value found under the new name as though it had been found under the old.
    if (!e) { info(describeUnset(k)); continue; }
    if (!existsSync(e.v)) warn(`${e.name}=${e.v} (${e.from}) does not exist yet`);
    else ok(`${e.name}=${e.v} (${e.from})`);
  }

  // ── THE CLIENT CONNECTOR, AND WHETHER ISSUED KEYS ARE STILL GOOD ──────────
  //
  // The status surface the ruling names: "status should say whether a key is still valid". Stopping
  // the door revokes nothing — a key outlives every teardown until it expires or its id is denylisted —
  // so a doctor that reported the unit and stayed silent about the keys would bless exactly the state
  // the issue was filed about. Judged by the verifier's own pieces (`connectKeyReport` takes the real
  // `isRevoked`), never by a second opinion written here.
  // ── THE PROFILE STORE RESOLVES, OR THE PORTAL 500s ────────────────────────
  //
  // Asked by RUNNING the engine's own resolution, not by re-deriving it: loadProfiles() layers the
  // configured store over the bundled base with generic falling through by name, and its refusal text
  // is the exact line the portal prints on every screen when this is broken. A doctor that stayed
  // green over that state would bless the owner's fresh-install 500.
  say("\n  Profile store");
  try {
    const { loadProfiles } = await import(join(REPO, "driver", "profiles.mjs"));
    const resolved = loadProfiles({ force: true });
    const named = [...resolved.keys()];
    ok(`resolves: ${named.length} profile(s) (${named.slice(0, 6).join(", ")}${named.length > 6 ? ", …" : ""}) — the universal fallback is present`);
  } catch (e) {
    problem(`the profile store does NOT resolve — every portal profile screen and every run refuses on this: ${e.message}`);
  }

  // ── THE SUBMIT LANE, WALKED (the owner's 502, 2026-09-02) ────────────────────────────────────────
  //
  // Every surface on that box was green while the portal's Start button had no engine to call. This is
  // the only check that asks the question the client's own path asks, so it goes before the connector
  // section: a dead submit lane matters more than a connector nobody has configured yet.
  // ── ONE READING OF THE UNITS' ENVIRONMENT, FOR EVERY SECTION THAT CLAIMS ANYTHING ABOUT THEM ─────
  //
  // F34: two sections asserted facts about the units while reading the operator's shell, and both of
  // their reported problems were false on a correctly-running install. Resolving this once, here, is
  // deliberate — a second reader would drift from this one exactly as the composer and the checker did
  // in F41, and the drift is invisible because both sides keep passing their own arms.
  const unitDir = join(homedir(), ".config", "systemd", "user");
  const { BACKGROUND_UNITS } = await import(join(REPO, "bin", "start.mjs"));
  const hosted = BACKGROUND_UNITS.some((u) => existsSync(join(unitDir, u)));
  const unitEnv = hosted
    ? unitEnvironment({
        units: BACKGROUND_UNITS.map((u) => ({ name: u, text: readIfPresent(join(unitDir, u)) })),
        readEnvFile: readIfPresent,
        // These are USER units under ~/.config/systemd/user, so systemd's %h is this home.
        home: homedir() })
    : null;

  // LINGERING, WHICH NOTHING ELSE CHECKS ( — F9). `--background` installs USER units,
  // and a user manager without lingering is torn down at logout: the units stop with the session and
  // NOTHING is written anywhere — no unit failure, no journal line, no port. The box reads healthy right
  // up until nobody is logged in. `start --background` refuses when the manager is unreachable, but a
  // manager reachable in THIS session says nothing about whether it survives the session, which is
  // exactly the gap. Only asked when the units exist: on a foreground install there is nothing to
  // outlive a logout, and the line would be noise on every fresh box.
  if (hosted) {
    const who = userInfo().username;
    say("\n  Background units");
    let linger = null, lingerWhy = null;
    try {
      // stderr captured, for the reason the client-door probe below carries in full.
      const out = execFileSync("loginctl", ["show-user", who, "-p", "Linger"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      linger = /Linger=yes/i.test(out);
    } catch (e) {
      lingerWhy = String(e?.stderr ?? "").trim().split("\n")[0] || e?.message || "loginctl could not be run";
    }
    if (linger === true) ok(`lingering is on for ${who} — the units survive logout`);
    else if (linger === false)
      blocking(`the background units are installed but lingering is OFF for ${who}. systemd tears this `
        + "account's user manager down at logout, so the units stop with nothing written anywhere — no "
        + `unit failure and no journal line. As root:  loginctl enable-linger ${who}`);
    else warn(`could not tell whether lingering is on for ${who} — ${lingerWhy}. That is this command `
      + "failing to look, not a report that it is off.");
  }

  say("\n  Submit lane");
  try {
    const { triggerLaneVerdict, HOSTED, SUPERVISED } = await import(join(REPO, "shared", "trigger-lane.mjs"));
    // POSTURE FROM THE BOX, NOT FROM A FLAG. Units installed means the units serve, and the units read
    // %h/.env — so an absent value there is the incident. No units means `start` supervises and derives
    // the value at runtime, where reading this process's environment says nothing either way.
    // WHAT THE UNITS HOLD, NOT WHAT THIS SHELL HOLDS (F34). On a hosted box these are different sets by
    // construction — the units read %h/.env with CLEAROTRON_NO_ENV_FILE=1, which severs inheritance on
    // purpose — so reading process.env and asserting about "the units" is not a near-miss. It is what
    // told the owner a working install returns 502 on every clearance, minutes after `--background` had
    // written the value it said was missing.
    //
    // Off the hosted path the operator's environment is the honest thing to read: `start` derives the
    // value at runtime and hands it to the portal it supervises, so there are no units to ask.
    const seen = hosted
      ? unitValue(unitEnv, "PORTAL_MCP_URL")
      : { state: String(process.env.PORTAL_MCP_URL ?? "").trim() ? "set" : "unset",
          value: String(process.env.PORTAL_MCP_URL ?? "").trim() || null };
    const url = seen.value;
    // THE SAME QUESTION AS THE LINE ABOVE, AND IT WAS ASKED OF THE WRONG PLACE.
    // `PORTAL_MCP_URL` is read from the units when they exist; `PORTAL_OPS_TOKEN` was read from
    // `process.env` unconditionally, three lines apart. On the hosted path `start --background` writes
    // the token into the file the units load and does not export it into anybody's shell, so a reader
    // running `doctor` afterwards was told the Start button fails at the door while the door answered
    // 200 — the same shape as F34, which is what this module exists for.
    //
    // Three-valued on purpose: `unknown` is not `unset`. The VALUE is never printed and never leaves
    // this scope — only its state does — because a unit Environment block carries live credentials.
    const tokenSeen = hosted
      ? unitValue(unitEnv, "PORTAL_OPS_TOKEN")
      : { state: String(process.env.PORTAL_OPS_TOKEN ?? "").trim() ? "set" : "unset",
          value: String(process.env.PORTAL_OPS_TOKEN ?? "").trim() || null, why: null };
    const opsToken = tokenSeen.value ?? "";
    const hasToken = tokenSeen.state === "set";
    // A could-not-look is reported as one. Without this line the verdict below renders `unknown` as an
    // absence and names a defect that may not exist.
    if (tokenSeen.state === "unknown") blocking(couldNotDetermine("PORTAL_OPS_TOKEN", unitEnv));
    // BOTH DIRECTIONS (owner, 2026-09-02). A lane that starts and cannot stop is not a working lane.
    // The posture reader is the portal's own, so this cannot drift from what the portal decides the
    // Stop control's availability on — one reader, two surfaces.
    let verbs = null;
    try {
      const { opsTokenPosture } = await import(join(REPO, "driver", "portal-service.mjs"));
      verbs = opsTokenPosture(opsToken).verbs;
    } catch { /* unreadable posture leaves verbs null, which reads as full ops — see the verdict */ }
    let probe = null;
    if (String(url ?? "").trim()) {
      try {
        const res = await fetch(new URL("/mcp", url), { method: "GET", signal: AbortSignal.timeout(2500), redirect: "manual" });
        // The door speaks MCP, not HTTP GET: a 4xx from it is a door answering. Only 5xx — or nothing
        // at all — is the state the 502 came from.
        // THE CHALLENGE FORM TRAVELS WITH THE STATUS ( — F57). `headers.get`
        // returns null when the header is absent — a looked-and-none answer, not a did-not-look — and
        // the readers separate those, so a probe that omits the field reads as never-looked rather
        // than silently as "no challenge".
        probe = { ok: res.status < 500, status: res.status, error: null,
          challenge: res.headers.get("www-authenticate") };
      } catch (e) { probe = { ok: false, status: null, error: String(e?.cause?.code ?? e?.name ?? e?.message ?? e) }; }
    }
    // THE PREFIX TRAVELS WITH THE MESSAGE. Doctor's own guard runs every command
    // doctor prints, from a directory that is not the install — so a bare `clearotron start` in a
    // warning is command-not-found in the terminal the reader is sitting in. It caught exactly that.
    // COULD NOT LOOK IS NOT A FAULT. If the units are installed but their environment could not be
    // resolved, the honest answer is that this command cannot tell — reporting "not set" here would be
    // the original defect with a different cause, and it would still send an operator chasing a fault
    // that may not exist. It is a warning, so it is visible, and it is not counted as a problem.
    if (seen.state === "unknown") {
      warn(couldNotDetermine("PORTAL_MCP_URL", unitEnv));
    } else {
      const lane = triggerLaneVerdict({ url, hasToken, verbs, posture: hosted ? HOSTED : SUPERVISED, probe,
        invoke: invocationPrefix() });
      if (lane.state === "pass") ok(lane.message);
      else if (lane.state === "fail") problem(lane.message);
      else info(lane.message);
    }
  } catch (e) { warn(`the submit lane could not be read: ${e.message}`); }

  say("\n  Client connector");
  // THE REVOCATION LIST, REPORTED ( — bb8's F14). `isRevoked` treats an unreadable
  // denylist as "not revoked", so a named-but-absent file makes every revocation silently ineffective:
  // measured on a default install, a revoked key completed a full handshake with nothing logged. Nothing
  // surfaced that state anywhere, which is why it survived to be found by hand.
  {
    const { defaultDenylistPath } = await import(join(REPO, "shared", "client-door.mjs"));
    const dl = effective("TRADEMARK_MCP_TOKEN_DENYLIST")?.v || defaultDenylistPath(homedir());
    try {
      const n = readFileSync(dl, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).length;
      ok(`revocation list readable at ${dl} — ${n} revoked key id(s)`);
    } catch (e) {
      // NOT `warn`. A revocation that cannot land is a security control that is off, and the reader has
      // no other surface that would tell them: the door answers 200 either way.
      blocking(`the revocation list at ${dl} cannot be read (${e.code ?? e.message}) — a key check treats an `
        + "unreadable list as NOT REVOKED, so revoking anything would silently do nothing. "
        + `Run \`${invoke("start")}\` — it creates the list.`);
    }
  }
  try {
    const { clientDoorState: doorState, describeDoorState, connectKeyReport, CLIENT_DOOR_UNIT: doorUnit } = await import(join(REPO, "shared", "client-door.mjs"));
    const { loadGrants: readGrantsFile, isRevoked: revokedCheck } = await import(join(REPO, "shared", "scope.mjs"));
    // ── CONFIGURED IS NOT RUNNING, AND THIS IS THE SURFACE IT WAS MEASURED ON ──
    //
    // `describeDoorState` was written for exactly this block and then never called from it: the split
    // it encodes sat in `shared/client-door.mjs` with no caller in `bin/` or `driver/`, while doctor
    // went on printing the three sentences the split replaces. The defect role-e2e measured is one of
    // them — a `connect` that died at `daemon-reload` had already written the fence and placed both
    // units, and doctor said "the client door is on" over a unit that was inactive with nothing on its
    // port. Every angle read as configured, because configured is all anything asked.
    //
    // `active` IS MEASURED HERE, and null when it could not be. `systemctl --user show` writes nothing,
    // which is doctor's contract, and a box with no session bus — the very shell that produced the
    // measured defect — throws and leaves the answer null. NULL IS NOT FALSE: reporting a door as down
    // because systemd could not be reached is the same lie in the other direction, and the four-state
    // description exists to say "nobody asked" out loud rather than pick a colour.
    let doorActive = null, doorActiveState = null, doorSubState = null, doorRestarts = 0;
    let doorAskFailed = null;
    try {
      // STDERR IS CAPTURED, NOT INHERITED. On a box with no user session bus — a fresh install, before
      // anyone has logged in properly — systemctl writes "Failed to connect to bus: No medium found"
      // to its own stderr, and with stderr inherited that sentence landed in the middle of this report
      // in systemd's voice, under a heading, explaining nothing to the reader it reached. The null
      // below was already the right answer; the leak was the whole defect.
      const out = execFileSync("systemctl", ["--user", "show", doorUnit, "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const f = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
      // BOTH FIELDS, the same pair `clearotron status` and `connect`'s health probe read. `ActiveState`
      // alone calls a Type=simple unit active the instant it forks, so a door that exits on its first
      // line answers "active" for about a second.
      doorActive = f.ActiveState === "active" && f.SubState === "running";
      // THE PAIR TRAVELS TOO. Collapsed to a boolean, a crash loop and a
      // never-started unit print the same sentence, and they have different next steps.
      doorActiveState = f.ActiveState ?? null;
      doorSubState = f.SubState ?? null;
      doorRestarts = Number.isFinite(Number(f.NRestarts)) ? Number(f.NRestarts) : 0;
    } catch (e) {
      // Stays null — nobody could ask, which is the third answer. The reason is kept so it can be said
      // in this command's voice where it matters, rather than printed raw where it does not.
      doorAskFailed = String(e?.stderr ?? "").trim().split("\n")[0] || e?.message || "systemctl could not be run";
    }
    // ONLY WHEN THE ANSWER WOULD HAVE MATTERED. If the unit is not installed, its activity is not a
    // question the reader has, and a could-not-look line about it would be noise on every fresh box.
    if (doorAskFailed && existsSync(join(unitDir, doorUnit)))
      warn(`could not ask systemd whether ${doorUnit} is running — ${doorAskFailed}. That is this command `
        + "failing to look, not a report that the door is down.");
    // THE RESTART COUNT IS HISTORY, AND THIS IS WHERE IT IS WORTH READING. It
    // used to be printed by `start --background`, where it can only ever be zero: that path either
    // installs the units fresh or refreshes them, and an explicit `systemctl restart` sets the counter
    // to 0. MEASURED ON systemd 255.4-1ubuntu8.17, and the version travels with the claim on purpose:
    // that reset is not documented contract, and the note which lived here first — "only `reset-failed`
    // clears it" — was an unmeasured premise repeated until it was believed. Doctor is the command a
    // reader runs on a box they did NOT just restart, so a
    // count above zero here is real: the door has died at least once and systemd brought it back.
    //
    // `info`, NOT a problem and not a blocker. It decides nothing — a door failing NOW reads
    // `activating/auto-restart` and is reported by the state description below. This is the line that
    // stops a reader concluding "it is fine" from a green door that has been quietly restarting, and
    // it names the command that clears the count WITHOUT touching the running process.
    if (doorRestarts > 0 && doorActive)
      info(`${doorUnit} has restarted ${doorRestarts} time(s) since it was loaded — history, not a fault: `
        + `it is running now. \`journalctl --user -u ${doorUnit} -n 50\` shows why it went down; `
        + `\`systemctl --user reset-failed ${doorUnit}\` clears the count without restarting it.`);
    // THE UNITS' ENVIRONMENT, NOT THIS SHELL'S (F34) — the second of the two false problems. On a
    // hosted box the door's fence flag lives in the file the units load; reading it here from
    // process.env reported a fully-configured door as half-configured, while the running service's own
    // log said account access was ON.
    const doorEnvKnown = !hosted || unitEnv?.known === true;
    const doorEnv = hosted && unitEnv?.known === true ? unitEnv.env : process.env;
    if (!doorEnvKnown) warn(couldNotDetermine("CLIENT_MCP_ACCOUNT_ACCESS", unitEnv));
    // THE PORT AND ITS ALLOW-LIST ARE ONE SETTING, AND NOTHING SAID SO (, Hera's
    // operator pass). `start` derives CLIENT_MCP_ALLOWED_HOSTS from the port it resolved, so moving the
    // port THROUGH start works. Moving it in the env file the units load does not: the door binds the
    // new port and then answers "403 Invalid Host header" on every request, because the allow-list still
    // names the old one. A door that is up, listening, and refuses everything is the worst of the three
    // states to debug, and nothing surfaced the mismatch.
    {
      const { clientDoorPort: portOf, allowedHosts: hostsFor } = await import(join(REPO, "shared", "client-door.mjs"));
      const declared = String(effective("CLIENT_MCP_ALLOWED_HOSTS")?.v ?? "").trim();
      if (declared) {
        const port = portOf(doorEnv);
        const wanted = hostsFor(port, doorEnv).split(",");
        // ONE ENTRY IS ENOUGH: the list may legitimately carry a public hostname as well, so this asks
        // whether the loopback pair for THIS port is in it, not whether the strings are equal.
        const covers = wanted.filter((h) => h.startsWith("127.0.0.1:") || h.startsWith("localhost:"))
          .some((h) => declared.split(",").map((x) => x.trim()).includes(h));
        if (!covers)
          blocking(`CLIENT_MCP_ALLOWED_HOSTS does not name port ${port}, which is where the client door binds. `
            + "The door will start and answer 403 Invalid Host header on every request. These two are one "
            + `setting: move the port and the list together — for this port it needs 127.0.0.1:${port} and localhost:${port}.`);
      }
    }

    // IS ANYTHING ANSWERING? ( — bb8's F11.) The unit file is evidence about the
    // background shape only. A foreground `clearotron start` runs the door as its own child with no unit
    // at all, and this section then told a reader whose door was listening that it "is not set up here",
    // pointing them at the command they had just run. One loopback connect settles it, and null stays
    // null — a probe that could not be made is not a door that is absent.
    let doorListening = null;
    try {
      const { clientDoorPort: portOf } = await import(join(REPO, "shared", "client-door.mjs"));
      const { createConnection } = await import("node:net");
      doorListening = await new Promise((resolve) => {
        const sock = createConnection({ host: "127.0.0.1", port: portOf(doorEnv), timeout: 700 });
        const done = (v) => { sock.destroy(); resolve(v); };
        sock.once("connect", () => done(true));
        sock.once("timeout", () => done(null));      // no answer in time is not proof of absence
        sock.once("error", (e) => done(e.code === "ECONNREFUSED" ? false : null));
      });
    } catch { /* stays null — nobody could ask */ }
    const door = doorState({ env: doorEnv, unitDir, exists: existsSync, active: doorActive,
      listening: doorListening, activeState: doorActiveState, subState: doorSubState });
    // EVERY COMMAND THROUGH `invoke`. Doctor's own guard runs every command doctor
    // prints from a directory that is not the install; a literal `clearotron start` in that text is
    // `command not found` for a reader with no shim, and the guard caught exactly that the moment this
    // function acquired its first caller.
    const said = describeDoorState(door, { unit: doorUnit, closeCmd: invoke("disconnect"),
      startCmd: invoke("start"), connectCmd: invoke("connect") });
    if (said.level === "ok") ok(said.text);
    else if (said.level === "problem") problem(said.text);
    else info(said.text);
    let grantsForKeys = null;
    try { grantsForKeys = readGrantsFile(); } catch (e) { warn(`issued-key records unreadable: ${e.message}`); }
    const report = connectKeyReport(grantsForKeys ?? {}, { revoked: (jti) => revokedCheck(jti) });
    if (!report.rows.length) info("no issued connect key is on record (keys minted before records were kept do not appear here)");
    for (const r of report.rows) {
      const line = `connect key ${r.jti} (${r.sub ?? "unknown identity"}) — ${r.state}`
        + (r.expires ? `, expires ${r.expires.slice(0, 10)}` : "");
      if (r.state === "valid") ok(line);
      else info(line);
    }
    if (report.valid && !String(process.env.TRADEMARK_MCP_TOKEN_DENYLIST ?? "").trim()) {
      problem("a valid key is on record but NO revocation list is configured (TRADEMARK_MCP_TOKEN_DENYLIST unset) "
        + `— \`${invoke("disconnect")}\` could not actually revoke it. \`${invoke("connect")}\` arms one; set the variable or reconnect.`);
    }
    // THE PUBLISHED ADDRESS, AND WHETHER IT ANSWERS (, acceptance 2). Reported here
    // rather than beside the unit, because the unit running and the address being reachable are
    // different facts and the second is the one a client depends on.
    const { clientDoorReachability } = await import(join(REPO, "shared", "client-door.mjs"));
    const published = process.env.CLEAROTRON_CLIENT_MCP_URL ?? null;
    // A SHORT, CHEAP ASK, and a failure to reach IS the finding rather than a failure to look — the
    // property under test is reachability itself. What would be dishonest is calling an address green
    // because nothing asked, which is why `probe` stays null when there is nothing to ask about.
    let probe = null;
    if (String(published ?? "").trim()) {
      try {
        const ctl = AbortSignal.timeout(2500);
        const res = await fetch(published, { method: "GET", signal: ctl, redirect: "manual" });
        // ANY ANSWER AT ALL IS REACHABILITY. This door speaks MCP, not HTTP GET, so a 405 or a 400 from
        // it is a door answering; only a 5xx says something in front of it is broken. Demanding 200
        // would red a correctly-configured deployment.
        // THE CHALLENGE FORM TRAVELS WITH THE STATUS ( — F57). `headers.get`
        // returns null when the header is absent — a looked-and-none answer, not a did-not-look — and
        // the readers separate those, so a probe that omits the field reads as never-looked rather
        // than silently as "no challenge".
        probe = { ok: res.status < 500, status: res.status, error: null,
          challenge: res.headers.get("www-authenticate") };
      } catch (e) { probe = { ok: false, status: null, error: String(e?.cause?.code ?? e?.name ?? e?.message ?? e) }; }
    }
    const reach = clientDoorReachability({ url: published, probe });
    if (reach.state === "pass") ok(reach.message);
    else if (reach.state === "fail") problem(reach.message);
    else info(reach.message);
  } catch (e) { warn(`the client-connector state could not be read: ${e.message}`); }

  say("");
  // NAMED, NOT COUNTED, AND NAMED FIRST — before the problem count and independently of it. Listing
  // blockers only when `problems` is empty would reproduce this command's original defect one level up:
  // an install with one misconfiguration AND no register would print the count, exit 1, and never
  // mention that nothing can search. Both are true at once, so both are said.
  if (blockers.length) {
    say(`  This install cannot do everything yet:`);
    for (const b of blockers) say(`    · ${b}`);
    say("");
  }
  if (problems.length) {
    say(`  ${problems.length} problem(s). Nothing was written — this command only reads.\n`);
    return 1;
  }
  // The exit status stays 0: an unfinished install is not a broken one, and `--check` separates an
  // absence from a misconfiguration. What changed is that the closing line no longer says nothing is
  // wrong while something that stops the product stands above it.
  if (blockers.length) {
    say("  Nothing is MISconfigured — fix those and nothing else here needs changing. Nothing was written.\n");
    return 0;
  }
  say("  Nothing wrong with what is configured. Nothing was written.\n");
  return 0;
}

// ── CLI gate ─────────────────────────────────────────────────────────────────────────────────────────
// Everything above is importable: the helpers are what the tests exercise directly, and importing this
// file must not start a wizard. Same gate driver/dev-portal.mjs uses.
if (!isEntrypoint(import.meta.url)) {
  // imported, not run — do nothing else
} else {
await runCli();
}

async function runCli() {
if (has("--help") || has("-h")) {
  // The usage block is lines 2..N of this file, and N is DERIVED — read to the first line that is not
  // a comment. It used to be a hand-counted slice, "widened by one when --probe-engine was added", and
  // its own comment said a slice that drifts off the block prints half a synopsis with nothing to say
  // so. Nothing pinned the number, so the next flag would have silently truncated it. (issue 1871)
  console.log(usageBlock(readFileSync(fileURLToPath(import.meta.url), "utf8")));
  process.exit(0);
}

if (CHECK_ONLY) process.exit(await runCheck());

// ── the wizard ───────────────────────────────────────────────────────────────────────────────────────
if (!input.isTTY) {
  console.error("\nsetup: this is an interactive wizard and stdin is not a terminal.\n"
    + `Run it in a terminal, or use \`${invoke("doctor")}\` to see what is configured.\n`);
  process.exit(2);
}

// A credential typed at a prompt is echoed by the terminal and then sits in scrollback, in tmux history,
// in whatever the reader pastes into a bug report. So the echo is muted while a secret is being typed:
// the output stream readline writes through drops everything while `muted` is set.
let muted = false;
const maskedOutput = new Writable({
  write(chunk, enc, cb) { if (!muted) output.write(chunk, enc); cb(); },
});
const rl = createInterface({ input, output: maskedOutput, terminal: true });
const askRaw = async (q) => (await rl.question(q)).trim();
const askSecretRaw = async (q) => {
  output.write(q);
  muted = true;
  try { return (await rl.question("")).trim(); } finally { muted = false; output.write("\n"); }
};
/** Yes/no with an explicit default. Enter takes the default; nothing else is guessed at. */
const confirm = async (q, def = true) => {
  for (;;) {
    const a = (await askRaw(`  ${q} ${def ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
    if (a === "") return def;
    if (["y", "yes"].includes(a)) return true;
    if (["n", "no"].includes(a)) return false;
    say("  Please answer y or n.");
  }
};
/**
 * — `skippable` IS THE WHOLE ANSWER TO "WHICH PROMPTS MAY BE LEFT EMPTY", DECIDED ONCE.
 *
 * The header promises "Enter takes the default in brackets". A prompt with no default and no way out
 * breaks that promise silently: empty re-prompts forever, and the reader has no screen-level reason to
 * believe anything but Ctrl-C will end it. So a prompt a reader can REACH WITHOUT HAVING CHOSEN to
 * supply that value is marked skippable, says so IN ITS BRACKETS where the header sent them looking,
 * and returns null. Every caller then has to decide what an absent value costs and say it — which is
 * the point: `skipped` is not optional decoration, it is the sentence the reader needs.
 *
 * Deliberately NOT skippable: a prompt the reader chose their way into — the binary path they asked to
 * give, the API key they picked the metered lane for, the optional credential they answered yes to.
 * Those already have an Enter-escape one question earlier, and marking them too would teach that every
 * prompt is optional when the register credential genuinely is not.
 */
const askValue = async (q, { def = "", secret = false, skippable = false, skipped = null } = {}) => {
  for (;;) {
    // — F20, mechanical fix 2. "later" reads as a deferral the product will
    // chase, and nothing does: there is no step that comes back for this. One place, so every skippable
    // prompt in the wizard changes together — which is the point, since the finding was that four
    // consecutive prompts each defensible alone taught the reader that the wording carries no signal.
    const hint = def ? ` [${def}]` : (skippable ? " [Enter to skip]" : "");
    const prompt = `  ${q}${hint} `;
    const a = secret ? await askSecretRaw(prompt) : await askRaw(prompt);
    const v = a || def;
    if (present(v)) {
      // A masked prompt CONFIRMS what it received: the reader cannot see what
      // they typed, and a paste that half-landed looks identical to one that worked. Length and the
      // last four characters are the vendor-dashboard convention for naming a key without showing it.
      if (secret) info(`received — ${v.length} characters, ending …${v.slice(-4)}`);
      return v;
    }
    if (skippable) { if (skipped) info(skipped); return null; }
    say("  A value is needed here.");
  }
};
/**
 * What "no engine" means, said in ONE place. — the menu's last row and the loop's escape both
 * land here, and two copies would drift the moment one of them was reworded.
 */
const sayNoEngine = () => {
  info("No engine configured, and nothing engine-related will be written.");
  info(`\`${invoke("demo")}\` needs none. A real run refuses at its own door until one is set — re-run setup then.`);
};
const choose = async (q, options, def = 0) => {
  say(`\n  ${q}`);
  options.forEach((o, i) => say(`    ${i + 1}) ${o.label}${i === def ? "   (default)" : ""}`));
  for (;;) {
    const a = await askRaw(`  1-${options.length} [${def + 1}] `);
    const n = a === "" ? def + 1 : Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
    say(`  Pick a number from 1 to ${options.length}.`);
  }
};

const candidate = {};
let aborted = null;
try {
  say("\n  Trademark clearance engine — setup\n");
  say("  One question at a time. Enter takes the default in brackets.");
  say("  Nothing is written until every credential you give has been checked against the real service.\n");

  // ── BEFORE YOU START, derived from what the product declares it needs ──────
  //
  // The wizard used to ask for each credential only at the moment it needed it, so a reader learned
  // what to prepare by failing the question — the owner's own first run, in his words. The list below
  // is DERIVED: the engines from ENGINE_BINARIES, the search vendors from the same adapter tables the
  // prompts loop over, each wearing its own table row's where-to-get line. A hand-kept copy here would
  // be the SERPAPI defect again, one screen earlier. Everything is skippable; the list says so.
  // THE BANNER — once, on entry, named (, owner ruling 2026-08-31). Not on every
  // command: a banner every verb prints is how a product becomes tiresome to use twice. It sits here
  // rather than at the top of main() so that `--check`, which writes nothing and is run repeatedly,
  // does not wear it either.
  say("");
  say(banner({ title: "Clearotron setup", subtitle: "one pass, and everything here is skippable", style,
               mark: bracketAsciiCells(), columns: process.stdout.columns }));
  say("");
  say(`  ${style.bold("Before you start")} — what this setup can take, so nothing here surprises you:`);
  // `vendor`, not `label`: the labels are engineer sentences carrying flag names, and a question a
  // lawyer reads may not ('s first rule).
  say(`    · Which AI runs the searches (${Object.values(ENGINE_BINARIES).map((e) => e.vendor).join(" or ")}),`);
  say("      and how it bills — the subscription you already sign in with, or an API key.");
  say("    · Your trademark register vendor's credential, if you have one (a register can be chosen later).");
  for (const table of [RESEARCH_PROVIDERS, SERP_PROVIDERS]) {
    for (const a of Object.values(table)) {
      say(`    · A ${a.label} key${a.obtain ? ` — ${a.obtain}` : ""}.`);
    }
  }
  say("  Every one can be skipped and added later; each skip states what stays off until you do.\n");

  // 1 ── Node
  say("  Node");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < NODE_FLOOR) {
    problem(`node ${process.versions.node} — this engine needs >= ${NODE_FLOOR}. Upgrade Node and run setup again.`);
    aborted = "node";
    throw new Error("node floor");
  }
  ok(`node ${process.versions.node}`);

  // 2 ── the engine: which one, which binary, and PROOF that it can run a turn
  //
  // This step used to resolve `claude` and nothing else, then write CLEAROTRON_AI=anthropic-agent five
  // steps later without ever asking. The driver has shipped a second adapter the whole time.
  say("\n  Engine");
  say("  The reasoning stages run as headless turns of a coding CLI. The choice is INSTALL-WIDE: one");
  say("  engine serves every stage of every run on this box, so it is not a per-job setting.");
  engine: for (;;) {
    // ── THE STATE FIRST, THE QUESTIONS OFF IT ──────────────────────────────
    //
    // The wizard used to ask which engine and how it bills, and only then discover the box could not
    // complete a sign-in — headless over SSH, the owner's own dead end. What is detectable is said
    // before anything is asked: the binary, and the credentials already in the environment. Sign-in
    // state itself is deliberately NOT guessed — the proof turn is the only honest answer to it, and
    // a guessed "signed in" that the turn then contradicts costs more than no claim.
    say("\n  What this box already has:");
    for (const [id, e] of Object.entries(ENGINE_BINARIES)) {
      const b = resolveEngineBin(process.env[e.env] || e.fallback);
      const creds = [e.apiKeyEnv, e.headless?.tokenEnv].filter((n) => n && present(process.env[n]));
      say(`    ${e.vendor}: ${b.executable ? `CLI found (${b.path})` : "no CLI on PATH"}${creds.length ? ` · ${creds.join(" and ")} already set` : ""}`);
    }
    say("  Choosing an engine also chooses how it bills — the subscription you sign in with, or an");
    say("  API key. That question comes right after this one.");

    const pick = await choose("Which engine runs the reasoning stages?", engineOptions(), 0);
    if (!pick.id) { sayNoEngine(); break; }
    const eng = ENGINE_BINARIES[pick.id];

    let bin = resolveEngineBin(process.env[eng.env] || eng.fallback);
    if (!(bin.executable && !bin.relative) && eng.install) {
      // ── — INSTALLING IT IS ONE COMMAND, AND WE USED TO STOP AT A SENTENCE ───────────────────
      //
      // Signing in is a browser round-trip nobody here can perform for someone. Installing the binary
      // is not, and the whole sequence — install, hand off to the vendor's own login, prove it with a
      // turn — is work this file already does either side of the gap.
      //
      // THE COMMAND IS SHOWN IN FULL AND THE DEFAULT IS NO. It runs as this user, it installs
      // PROPRIETARY THIRD-PARTY SOFTWARE governed by that vendor's terms rather than by this
      // repository's licence (README §Licence, INSTALL §1), and it is the one thing setup does that
      // reaches outside this checkout. A reader has to be able to read it before answering, which is
      // also why the command in ENGINE_BINARIES is an npm install rather than the vendor's
      // `curl … | bash` — a piped remote script cannot be read before it runs.
      warn(`no \`${eng.fallback}\` binary on PATH.`);
      say(`    ${eng.label}`);
      say("");
      say(`    ${eng.vendor}'s CLI is proprietary third-party software. Installing it accepts ${eng.vendor}'s`);
      say("    terms, not this product's licence, and this product redistributes no part of it.");
      say("");
      // ── WHICH ROUTE CAN WORK ON THIS BOX, MEASURED FIRST ─────────────────
      //
      // `npm install -g` on a root-owned prefix cannot work as this user; offering only it, then
      // mis-reporting its failure, was the owner's dead end. The prefix is probed by ACCESS, and when
      // it needs root the vendor's own no-root installer is NAMED — never run: the stance in
      // ENGINE_BINARIES holds, a piped remote script is not a command this product executes for
      // someone. The reader runs it by their own hand, and the loop below re-checks rather than
      // dead-ending at a path prompt for a file that does not exist.
      const npmPrefix = (() => {
        const q = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8" });
        return !q.error && q.status === 0 ? String(q.stdout).trim() : null;
      })();
      const prefixWritable = (() => {
        if (!npmPrefix) return null;   // could not ask npm — not a verdict either way
        try { accessSync(join(npmPrefix, "lib"), constants.W_OK); return true; } catch { /* fall through */ }
        try { accessSync(npmPrefix, constants.W_OK); return true; } catch { return false; }
      })();
      if (prefixWritable === false) {
        say(`    npm's global prefix here is ${npmPrefix}, and this user cannot write to it — the npm`);
        say("    route needs root on this box, so it is not offered first.");
        if (eng.installNoRoot) {
          say(`    ${eng.vendor}'s no-root installer lands in ${eng.installNoRoot.lands} and needs no sudo:`);
          say("");
          say(`      ${eng.installNoRoot.cmd}`);
          say("");
          say("    Run it YOURSELF in another terminal — it is the vendor's script, and this setup will");
          say("    not pipe a remote script into a shell for you. Come back and continue here.");
        } else {
          say("    The no-root way is to point npm at a prefix you own, then install:");
          say("");
          say(`      npm config set prefix ~/.local && ${eng.install}`);
          say("");
          say("    (~/.local/bin must be on PATH.) Run that yourself in another terminal, then continue.");
        }
        if (await confirm("Done (or already installed elsewhere)? Check this box again", true)) {
          bin = resolveEngineBin(process.env[eng.env] || eng.fallback);
          if (!(bin.executable && !bin.relative)) {
            const home = process.env.HOME || homedir();
            const local = join(home, ".local", "bin", eng.fallback);
            if (isExec(local)) { ok(`found it at ${local} — not on this shell's PATH yet`); bin = resolveEngineBin(local); }
            else info("still not found — the path prompt below takes the absolute location if it landed somewhere else.");
          } else ok(`installed: ${bin.path}`);
        }
      } else if (await confirm(`Run \`${eng.install}\` now?`, false)) {
        say(`  $ ${eng.install}`);
        const [cmd, ...args] = eng.install.split(" ");
        const r = spawnSync(cmd, args, { stdio: "inherit" });
        // THE EXIT CODE IS NOT THE ANSWER, and this is the issue's own rule. A package manager that
        // exits 0 having installed to a prefix outside this shell's PATH has succeeded at its job and
        // left us exactly where we started; one that exits non-zero may still have left a usable
        // binary. So what decides is the same resolution the ENGINE resolves with, and after that, a
        // turn.
        if (r.error) problem(`could not run it: ${r.error.message}`);
        else if (r.status !== 0) warn(`that command exited ${r.status ?? "on a signal"} — checking anyway, since its exit code is not what settles this.`);
        bin = resolveEngineBin(process.env[eng.env] || eng.fallback);
        if (!(bin.executable && !bin.relative)) {
          // The common ending: npm's global prefix is not on this shell's PATH. Naming the path it
          // would be at is the difference between a dead end and one more answer.
          const prefix = (() => {
            const q = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8" });
            return q.status === 0 ? String(q.stdout).trim() : null;
          })();
          const guess = prefix ? join(prefix, "bin", eng.fallback) : null;
          if (guess && isExec(guess)) {
            ok(`installed, but not on this shell's PATH — found it at ${guess}`);
            bin = resolveEngineBin(guess);
          } else {
            warn(`no \`${eng.fallback}\` on PATH after that command.`);
            if (prefix) info(`npm installs global binaries under ${join(prefix, "bin")} — add that to PATH, or give the absolute path below.`);
            // The other route, re-offered rather than a dead end: what happened is
            // reported above; what to do next must not be only a path prompt at a file that never landed.
            if (eng.installNoRoot) info(`the vendor's no-root installer is \`${eng.installNoRoot.cmd}\` — run it yourself in another terminal (lands in ${eng.installNoRoot.lands}), then give the path below or re-run setup.`);
          }
        } else {
          ok(`installed: ${bin.path}`);
        }
      }
    }
    if (!(bin.executable && !bin.relative)) {
      warn(`no usable \`${eng.fallback}\` binary.`);
      say(`    ${eng.label}. Install it, or point at one.`);
      if (!await confirm(`Give the path to a \`${eng.fallback}\` binary now?`, false)) {
        // ── — A LOOP MUST NOT RETURN TO A MENU NOTHING HAS CHANGED ────────────────────────────
        //
        // This `continue` used to be unconditional, and it is the whole defect. Both escapes above
        // default to NO, so a reader taking the header at its word — "Enter takes the default in
        // brackets" — declined the install, declined the path, and landed back on a menu whose own
        // default is the engine that just failed. Nothing differs between iterations, so it never
        // ends. Measured under a PTY on a bare surface: fourteen identical cycles in forty Enters,
        // killed at the cap, never reaching the register step.
        //
        // THE WAY OUT ALREADY EXISTED and was invisible from the screen: the menu's last row. So this
        // offers it rather than moving the menu's default onto it. Moving the default would also move
        // WHICH ENGINE Enter selects on a box that has the second binary and not the first — a vendor
        // the reader did not choose, and a proof turn spent on it, which is not this defect's to
        // decide. `onboard-wizard.test.mjs` fixes row 0 as the production default for that reason.
        if (await confirm("Continue with no engine configured?", true)) { sayNoEngine(); break engine; }
        continue;
      }
      const p = await askValue("Absolute path:");
      bin = resolveEngineBin(p);
      if (bin.relative) warn("that path is relative. Stage subprocesses run with cwd set to the run directory, so it will not resolve — using the absolute form.");
      if (!bin.executable) { problem(`${bin.path ?? resolve(p)} is not an executable file.`); continue; }
    }
    ok(`found ${bin.path}`);

    // ── item 5 — HOW THIS BOX PAYS, asked BEFORE the proof ────────────────────────────────────
    //
    // The wizard used to skip this entirely, and the shape of that miss is why the question sits HERE
    // rather than after the probe. `resolveAuthMode` defaults to `subscription`, and
    // `anthropic-agent.mjs` deletes ANTHROPIC_API_KEY from the stage subprocess under any other mode —
    // so a reader who did the natural thing, exported a key and ran setup, got a probe against a
    // signed-out CLI, a failure that named the binary, and no route to the lane they were paying for.
    //
    // ASKED BEFORE, SO "PROVEN" MEANS PROVEN FOR THIS LANE. `probeEngineTurn` calls `resolveAuthMode`
    // on purpose — it is the door the gateway opens at the top of runStage — so the mode has to be in
    // the probe's environment or the turn proves a billing lane the run will not use. On codex it also
    // reaches that adapter's own auth.json refusal, which is how the subscription half gets proven too:
    // subscription is not the free-of-preconditions option there, it needs `codex login` to have run.
    //
    // The key name comes from ENGINE_BINARIES, never from a literal here: openai's is CODEX_API_KEY and
    // adopting OPENAI_API_KEY instead would write a .env that `auth.mjs` refuses — the same defect this
    // item exists to remove, wearing the other engine.
    const ambientKeyPresent = present(process.env[eng.apiKeyEnv]);
    const authPick = await choose(`How does this box pay for ${pick.id}?`, [
      { id: "subscription", label: `Subscription — ${eng.subscriptionHow}` },
      { id: "api-key", label: `API key — metered per token, from ${eng.apiKeyEnv}` },
    ], ambientKeyPresent ? 1 : 0);
    let apiKey = null;
    if (authPick.id === "api-key") {
      if (ambientKeyPresent) {
        apiKey = process.env[eng.apiKeyEnv];
        info(`${eng.apiKeyEnv} is already in your environment — adopting it, so the .env this writes matches the lane you just proved.`);
      } else {
        apiKey = await askValue(`${eng.apiKeyEnv}:`, { secret: true });
      }
    } else if (ambientKeyPresent) {
      // Not a warning: it is the resolved behaviour, stated once, because the opposite guess is the
      // expensive one. The adapter strips the key under subscription, so the probe below really does
      // exercise the subscription and the key sitting in the environment changes nothing.
      info(`${eng.apiKeyEnv} is set in your environment and will NOT be used — subscription mode strips it from every stage.`);
    }
    const authEnv = { [eng.authEnv]: authPick.id, ...(apiKey ? { [eng.apiKeyEnv]: apiKey } : {}) };

    // THE PROOF. An executable file is not a working engine: a signed-out CLI, an expired credential, an
    // unreachable tier and a spent quota all pass every check above and surface as a stage failure after
    // the run has started. So setup will not write an engine it has not exercised — and the menu's last
    // row exists so that refusal always has somewhere to go.
    say("");
    info("An executable file is not a working engine. Setup will not write one it has not exercised:");
    info("  a .env naming a signed-out engine becomes a stage failure ninety minutes into a clearance,");
    info("  wearing the shape of a model fault, after every stage before it has spent.");
    if (!await confirm(`Prove ${pick.id} on the ${authPick.id} lane now with one ${PROBE_MODEL}-tier turn (a few tokens, ${PROBE_TIMEOUT_SEC}s ceiling)?`, true)) {
      info("Not proven, so not written. Pick again — the last row configures no engine at all.");
      continue;
    }
    for (;;) {
      say("  Running one turn…");
      const v = await probeEngineTurn({ env: { ...process.env, CLEAROTRON_AI: pick.id, [eng.env]: bin.path, ...authEnv } });
      if (v.ok) {
        ok(`${pick.id} completed a turn on the ${authPick.id} lane — binary, credential, billing mode and model access all work.`);
        candidate.CLEAROTRON_AI = pick.id;
        candidate[eng.env] = bin.path;
        candidate[eng.authEnv] = authPick.id;
        if (apiKey) candidate[eng.apiKeyEnv] = apiKey;
        info(`CLEAROTRON_AI=${pick.id}`);
        info(`${eng.authEnv}=${authPick.id} — the lane the turn above actually ran on.`);
        if (apiKey) info(`${eng.apiKeyEnv}=… — adopted, so a run bills the way you just proved.`);
        info(`${eng.env}=${bin.path} — the absolute form, because a service's PATH is not your shell's.`);
        break engine;
      }
      problem(probeFailureText(v));
      if (v.detail) info(`engine said: ${v.detail}`);
      // — THE HAND-OFF. Signing in is the one step of this sequence nobody here can perform for
      // someone, so the wizard names the command, waits, and re-probes rather than ending at a
      // description of what is wrong. The text comes from ENGINE_BINARIES so the two adapters cannot
      // drift into one set of instructions.
      info(`if it is signed out: ${eng.signIn}, then answer yes below.`);
      // ── THE HEADLESS ENDING ────────────────────────────────────────────────
      //
      // On a box with no browser the interactive sign-in cannot complete, and the documented route had
      // no documented ending: `claude setup-token` walks the sign-in on ANY machine and prints a token
      // this box can hold — but its name appeared nowhere in this repository, so a reader over SSH was
      // told to sign in interactively and left there. The token is captured BY PASTE: the vendor's
      // stream layout is not ours to guess at, and a paste works whatever it prints where. Codex's
      // headless ending writes its own auth file and there is nothing to capture — the command is
      // named, and the re-probe is the proof either way.
      if (eng.headless) {
        info(`on a box with no browser: run \`${eng.headless.cmd}\`${eng.headless.tokenEnv ? " (from any machine you can sign in on)" : " here"}.`);
        if (eng.headless.tokenEnv && await confirm(`Did that give you a token to paste? Capture it into ${eng.headless.tokenEnv} now`, false)) {
          const tok = await askValue(`${eng.headless.tokenEnv}:`, { secret: true, skippable: true, skipped: "Nothing captured." });
          if (tok !== null) {
            candidate[eng.headless.tokenEnv] = tok;
            authEnv[eng.headless.tokenEnv] = tok;   // the re-probe below must prove the lane WITH it
            info(`${eng.headless.tokenEnv} captured — the turn below proves it before anything is written.`);
          }
        }
      }
      // — bb8's F9, and the same trap closed one prompt over. The default
      // was YES, so Enter re-ran a probe that CANNOT succeed until the reader has signed in somewhere
      // else — and the wizard's own header tells them Enter is the safe key. Driven with Enter it went
      // 19 attempts, no cap and no escape, in a wizard whose header says everything here is skippable.
      //
      // Enter now declines. The reader lands back on the engine menu, whose last row configures no
      // engine at all, so the way out is the one that already exists rather than a second one invented
      // here — and the line says what that costs before they take it.
      if (!await confirm("Fixed it? Run the turn again", false)) {
        info("Not proven, so not written. Back to the engine menu — its last row configures no engine: "
          + "the demo and a replayed report still work, and a real clearance refuses by name until one is set.");
        continue engine;
      }
    }
  }

  // 3 ── ambient keys, one at a time, by name only
  const ambient = AMBIENT_KEYS.filter((k) => present(process.env[k]));
  if (ambient.length) {
    say("\n  Credentials already in your environment");
    say("  These are set in the shell you started setup from. Setup shows the NAME only — never the value.");
    say("  Approve them one at a time; nothing is adopted by default.\n");
    for (const k of ambient) {
      if (await confirm(`Use ${k} from your environment?`, true)) { candidate[k] = process.env[k]; ok(`${k} adopted`); }
      else info(`${k} skipped`);
    }
  }

  // 4 ── register provider
  say("\n  Register provider");
  say("  This decides which register gets searched, and which vendor gets billed. There is no default in");
  say("  the engine — it refuses to guess.");
  const provider = await choose("Which register?", PROVIDERS.map((p) => ({ label: `${p.label} — ${p.cost}`, spec: p })), 0);
  const spec = provider.spec;
  say(`\n  ${spec.label}: covers ${spec.covers}`);
  for (const w of spec.warnings ?? []) warn(w);
  if (spec.signup && !spec.credentials.every((k) => present(candidate[k]))) {
    say("\n  How to get a credential:");
    for (const l of spec.signup) say(`    ${l}`);
    say("");
  }
  // ── — INSTALL MAY FINISH WITH NO REGISTER. Owner ruling, 2026-08-26 ──────────────────────
  //
  // Every row of PROVIDERS declares required credentials, and this prompt had no way out, so a reader
  // with no vendor account could not reach the closing screen at all — the menu offers no "none" row,
  // which means they arrive here without ever having chosen to supply a key.
  //
  // A REGISTER IS ALL-OR-NOTHING, WHICH IS WHY ONE SKIP ABANDONS THE WHOLE SELECTION. Half a credential
  // pair is not a working register; writing CLEAROTRON_DATABASE beside it would name an adapter that
  // cannot answer, and a run would fail on the missing key rather than on the honest fact that nobody
  // picked a register. So the selection is written only once every required credential is in hand.
  //
  // NOTHING DOWNSTREAM NEEDED CHANGING, and that is the owner's point rather than luck: CLEAROTRON_DATABASE
  // is single-valued with no default, a run already refuses by name when it is unset
  // (driver.config.mjs), and the Global config page already renders "No register is selected."
  // One register per install, any one of them sufficient, none a precondition for another.
  let registerSelected = true;
  // What THIS step collected, so abandoning the selection can take it back. Measured: a register with
  // two required credentials — `euipo`, `free-tier` — let a reader supply the first and skip the second,
  // and the first was written to the .env with no CLEAROTRON_DATABASE beside it. `candidate` is
  // serialised wholesale at the write step, so anything left in it ships. A credential for a register
  // nobody selected is a secret persisted for a decision that was reversed.
  const collectedHere = [];
  for (const k of spec.credentials) {
    if (present(candidate[k])) { ok(`${k} already adopted from your environment`); continue; }
    const v = await askValue(`${k}:`, { secret: true, skippable: true,
      skipped: `${k} not set, so ${spec.id} cannot be configured — this install will have NO register selected.` });
    if (v === null) { registerSelected = false; break; }
    candidate[k] = v;
    collectedHere.push(k);
  }
  if (!registerSelected) {
    // ONLY what this step collected. A credential ADOPTED from the environment was approved by name at
    // the "Credentials already in your environment" step, BEFORE any register was chosen — it is not
    // this selection's to discard, and it will still be there for whichever register is picked later.
    for (const k of collectedHere) delete candidate[k];
    if (collectedHere.length) info(`${collectedHere.join(" and ")} discarded — not written for a register that was not selected.`);
    say("");
    info("No register is selected, and nothing register-related will be written.");
    info(`Every search refuses until one is set — \`${invoke("doctor")}\` says so on every run, and the`);
    info("  Global config page says it too. Re-run setup, or set it there, when you have a credential.");
  }
  for (const k of registerSelected ? (spec.optionalCredentials ?? []) : []) {
    if (present(candidate[k])) { ok(`${k} already adopted from your environment`); continue; }
    info(`${k} is optional. Without it, the offices it serves are DISCLOSED as deferred coverage rather`);
    info("  than searched — the run still works and still tells the truth about what it did not reach.");
    if (await confirm(`Set ${k} now?`, false)) candidate[k] = await askValue(`${k}:`, { secret: true });
    else info(`Skipped. Build the index later with: ${invocationPrefix()}clearotron sync`);
  }
  if (registerSelected) {
    // WRITTEN HERE, not at the menu. Before this was set the moment a row was picked, so a reader
    // who could not supply the key still got CLEAROTRON_DATABASE naming an adapter with no credential.
    candidate.CLEAROTRON_DATABASE = spec.id;
    for (const [k, v] of Object.entries(spec.extra ?? {})) {
      candidate[k] = v;
      info(`${k}=${v} (the sandbox is a separate deployment holding a different corpus — production is the one that searches real marks)`);
    }
  }

  // 5 ── validate the register credential BEFORE anything is written
  // Skipped entirely when no register is selected: there is no credential to validate, and asking EUIPO
  // for a token with an undefined client id would refuse and abort a setup that is doing what it was
  // told to do.
  // Driven by what the SPEC declares, not by its id: `free-tier` composes EUIPO and the USPTO index, so
  // an id-shaped branch would silently skip the token check for the composite — the free tier most
  // readers will pick.
  if (registerSelected && spec.validateEuipo) {
    say("\n  Checking the EUIPO credential by asking EUIPO for a token…");
    const v = await validateEuipo({ clientId: candidate.EUIPO_CLIENT_ID, clientSecret: candidate.EUIPO_CLIENT_SECRET, environment: candidate.EUIPO_ENVIRONMENT });
    if (v.ok) ok("EUIPO issued a token — the credential works.");
    else {
      problem(`EUIPO refused: ${v.error}`);
      say("\n  Nothing has been written. Re-run setup with a working credential.");
      aborted = "euipo";
      throw new Error("euipo");
    }
  }
  if (registerSelected && spec.uspToLocalKey && present(candidate[spec.uspToLocalKey])) {
    const db = candidate[spec.uspToLocalKey];
    if (existsSync(db)) ok(`${db} exists`);
    else {
      warn(`${db} does not exist yet — build it with: ${invocationPrefix()}clearotron sync`);
      if (!await confirm("Keep this path anyway?", true)) { aborted = "uspto"; throw new Error("uspto"); }
      await offerUsptoSync(db, { ask: askRaw, say, ok, info, warn, problem });
    }
  }
  if (registerSelected && !spec.validateEuipo && !spec.uspToLocalKey) {
    info(`${spec.label} is a paid vendor. Setup does not test it: a probe call against a metered subscription is a charge you did not ask for.`);
  }

  // 6 ── research and web-search credentials, DERIVED from the driver's own tables
  //
  // The last hand-kept list here never mentioned SERPAPI_API_KEY, so a reader who completed setup
  // exactly as designed had every marketplace grid cell gap — the wizard and driver.config.mjs
  // disagreed, and the reader met the difference on their first report. The loop below cannot: an
  // adapter appears here the day it is wired, wearing the consequence and where-to-get lines its own
  // table row carries. A live check runs where one exists, keyed on the credential's name.
  say("\n  Search credentials");
  const liveChecks = { PERPLEXITY_API_KEY: validatePerplexity };
  for (const [tableLabel, table] of [["research", RESEARCH_PROVIDERS], ["the open-web and marketplace grid", SERP_PROVIDERS]]) {
    for (const adapter of Object.values(table)) {
      const name = adapter.credEnv;
      say("");
      say(`  ${adapter.label} — used for ${tableLabel}.`);
      say(`  Without it: ${adapter.absentMeans ?? "that lane refuses or degrades, and the report says so"}.`);
      if (adapter.obtain) say(`  Where to get one: ${adapter.obtain}.`);
      if (!present(candidate[name])) {
        const skippedLine = `Skipped. You can add ${name} later; until then: ${adapter.absentMeans ?? "the lane stays off"}.`;
        if (await confirm(`Enter a ${adapter.label} API key now?`, true)) {
          const v = await askValue(`${adapter.label} key:`, { secret: true, skippable: true, skipped: skippedLine });
          if (v !== null) candidate[name] = v;
        } else info(skippedLine);
      }
      const check = liveChecks[name];
      if (check && present(candidate[name])) {
        // Approval-gated: this is a real request against the reader's account.
        if (await confirm(`Check the key with one minimal request against ${adapter.label}?`, true)) {
          say("  Checking…");
          const v = await check(candidate[name]);
          if (v.ok) ok(`${adapter.label} accepted the key.`);
          else {
            problem(`${adapter.label} refused: ${v.error}`);
            if (!await confirm("Keep the key anyway?", false)) { aborted = "search-credential"; throw new Error("search-credential"); }
          }
        } else info("Not checked — a wrong key will surface on the first run instead.");
      } else if (!check && present(candidate[name])) {
        info(`Presence recorded — this vendor has no free probe wired, so a wrong key surfaces on the first run.`);
      }
    }
  }

  // 7 ── data-plane paths, explicit, never the code default
  say("\n  Where this install keeps its data");
  // Which sentence the reader gets is DECIDED by the getter, not chosen by whoever last edited this line
  //. No default ⇒ say so and say what unset costs them; a default ⇒ name the real one. Either way
  // the answer moves when driver.config.mjs moves, which is the only reason it was wrong before.
  const poolDefault = defaultWith("CLEAROTRON_REPORTS_DIR", () => config.poolRoot);
  // — F20. This led with the RISK and explained its own missing default at
  // length. Both halves were true and well written, and that was the trouble: it taught the reader to
  // expect that much explanation everywhere, so two prompts later, where there was none, the owner
  // stopped. Leads with what is being asked now; the safety point that made it long is kept, one line
  // shorter, and still decided by the getter rather than by whoever last edited this text.
  const baseDefault = join(homedir(), "trademark");
  prose("Reports, run workspaces, queues and locks all live under one directory.");
  if (poolDefault.refusal) {
    prose(`Enter accepts ${baseDefault}. There is no built-in default for the pool — left unset a run`,
          "refuses and names it rather than guessing — so setup gives it a real path under your home,",
          "and this install publishes only where you own the disk.");
  } else {
    prose(`Enter accepts ${baseDefault}. Left to the built-in default, published reports would go to`,
          `${poolDefault.value} — on a deployed server that is somebody's real client archive.`);
  }
  const base = await askValue("Base directory:", { def: baseDefault });
  candidate.CLEAROTRON_REPORTS_DIR = join(base, "pool");
  candidate.CLEAROTRON_WORK_DIR = join(base, "workspace");
  candidate.CLEAROTRON_QUEUE_DIR = join(base, "queue");
  candidate.CLEAROTRON_OUTBOX_DIR = join(base, "outbox");
  candidate.CLEAROTRON_RUN_LOCK_DIR = join(base, "locks");
  for (const k of ["CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR", "CLEAROTRON_QUEUE_DIR", "CLEAROTRON_OUTBOX_DIR", "CLEAROTRON_RUN_LOCK_DIR"]) ok(`${k}=${candidate[k]}`);

  // 7a ── AND HOW A REPORT IS LINKED TO, which nothing in the install asked before
  //
  // Nothing required `CLEAROTRON_REPORTS_URL`, so a packaged install completed, ran, and DELIVERED
  // carrying "no report URL (pool URL unset)". The report is produced; the links into it are not. An
  // operator who was never asked cannot know they answered wrong, and the first time anyone finds out is
  // a client opening a notification with nothing to click.
  //
  // ASKED, NOT REQUIRED. A local install with no web front is a real shape and must not be blocked by a
  // question about one — so empty is a legitimate answer, and the consequence of it is said out loud
  // rather than discovered later.
  // THE PROMPT THAT STOPPED THE OWNER ( — F19), rewritten to F20's template: what is
  // being asked for in the reader's words, one line on what it is for, one line on the default or what
  // skipping costs. Everything in the old text was true and none of it answered "what happens to me if
  // I press Enter", which is the only question an installer has at a prompt. Its heading named an
  // internal concept, its consequence sat mid-paragraph and in the negative, and it never answered the
  // question he actually asked — why is there no default — whose honest answer is one clause.
  say("\n  The link in delivery notifications");
  prose("When a run finishes, whoever ordered it gets a notification. This is the web address the link",
        "in it points to. No default — it is your public hostname, and only you know it.");
  prose("Skip it and runs still deliver; the notification just carries no link.");
  // SKIPPABLE, because "(empty for none)" was a promise the prompt could not keep. `{ def: "" }` makes
  // Enter yield the empty string, `present("")` is false, and askValue loops with "A value is needed
  // here." — so a reader taking the header at its word ("Enter takes the default in brackets") on the
  // one prompt that advertises empty as an answer could not leave it. Driven on the merged tree:
  // 60 enters, killed at the cap, every cycle this prompt. Same defect class as 's
  // engine-menu loop, arriving one commit after it was fixed, in a prompt this branch's own sibling
  // added.
  //
  // The escape goes in the BRACKETS and the consequence in `skipped`, matching the two prompts that
  // already take this mode — the question no longer carries "(empty for none)" because the bracket now
  // says it, and a prompt that says it twice in two different wordings is how the two drift apart.
  const reportsUrl = await askValue("Public base URL for the pool:", {
    skippable: true,
    skipped: "CLEAROTRON_REPORTS_URL left unset — runs will deliver, and their notifications will carry no link",
  });
  if (reportsUrl !== null) {
    const trimmed = reportsUrl.trim();
    candidate.CLEAROTRON_REPORTS_URL = trimmed;
    ok(`CLEAROTRON_REPORTS_URL=${trimmed}`);
  }

  // 7a-bis ── THE ADDRESS CLIENTS REACH THE CONNECTOR AT (owner ruling 2026-09-03, Q2)
  //
  // *"The installer asks once, at install, on the box. It is a deployment setting, never a per-person
  // one. Changing it later is editing that one setting and restarting."*
  //
  // ONE QUESTION AND ONE VARIABLE. `CLEAROTRON_CLIENT_MCP_URL` is what the Use-your-AI page, a report's
  // Ask-your-AI control and `doctor` all read; nothing in the tree wrote it before this prompt, which is
  // why a reader who connected successfully still met "not set up" on every surface.
  //
  // A LOCAL INSTALL SKIPS IT, and skipping means writing NOTHING. the deployment env example ships the
  // row empty and every advertising surface fails closed on it being empty — so a placeholder host
  // would defeat that guard and hand a client a dead address while the box reported itself configured
  // (docs/architecture/04-configuration-reference.md is explicit about this). Empty is the honest state
  // of a laptop, and the page's empty state is the correct answer for one.
  //
  // WHY THE ADDRESS IS NEEDED AT ALL, in the reader's terms rather than ours: an assistant reaches this
  // connector from its maker's servers, even one whose app is running on the reader's own machine. That
  // is the fact the whole ruling turns on (§3), and it is why a loopback address is not offered here as
  // a convenience.
  // — F20. Five lines that led with a networking concept and buried the
  // consequence at the end. Its explanation of WHY an assistant reaches the box from a vendor's cloud is
  // genuinely useful and is a document, not a prompt — it lives in mcp-server/CONNECT.md, and the prompt
  // carries one line and a pointer.
  say("\n  The address clients' assistants reach this install at");
  prose("An assistant connects from its maker's servers, not from your machine, so this has to be an",
        "address on the public internet, over https.");
  prose("No default — it is your hostname. Skip it and this stays a local install: everything works",
        "here, and the Use-your-AI page says so rather than handing out an address that fails.");
  prose("The usual shape, and why: mcp-server/CONNECT.md.");
  const { clientDoorReachability } = await import(join(REPO, "shared", "client-door.mjs"));
  for (;;) {
    const clientUrl = await askValue("Public connector address:", {
      skippable: true,
      skipped: "CLEAROTRON_CLIENT_MCP_URL left unset — the Use-your-AI page and a report's Ask-AI control will "
        + "show their empty state, which is correct for a local install",
    });
    if (clientUrl === null) break;
    const trimmed = clientUrl.trim();
    // JUDGED BY THE PRODUCT'S OWN READER, never by a second URL rule written here. `clientDoorReachability`
    // is what `doctor` reports through, so a value this prompt accepts cannot be one doctor calls a fault.
    // Reachability itself is NOT asked here — the tunnel may not be up while the wizard runs, and an
    // unprobed half is not a passed half; doctor is where that question belongs.
    const verdict = clientDoorReachability({ url: trimmed });
    if (verdict.state === "fail") {
      problem(verdict.message);
      say("  Enter an https address, or press Enter to leave it unset.");
      continue;
    }
    candidate.CLEAROTRON_CLIENT_MCP_URL = trimmed;
    ok(`CLEAROTRON_CLIENT_MCP_URL=${trimmed}`);
    say("  `clearotron doctor` will tell you whether it actually answers — being set is not being");
    say("  reachable, and every surface that advertises the connector renders from it being set.");
    break;
  }
  // (CLEAROTRON_AI was assigned here, unconditionally, in a step about disk paths. It is a decision now,
  // taken in step 2 where the engine is discussed, and only after the engine has completed a turn.)

  // 7b ── THIS INSTALL'S OWN CONFIGURATION, and the whole point is WHERE it defaults to
  //
  // Until this step the wizard asked only about DATA and never once about configuration, so a first-time
  // user customised a customer profile or a doctrine file inside their clone — because that is where the
  // engine looked when nothing said otherwise — and their first `git pull` was a merge conflict in files
  // they did not know were ours. INSTALL §6 recorded the portal committing profile edits INTO the
  // checkout for the same reason.
  //
  // Defaulted BESIDE the data directory rather than under the repository. That is the entire fix: the
  // split the engine is designed for only holds if the default lands on the right side of it.
  // — F20. This had a default and never said what accepting it MEANT, which is
  // the one thing the template requires of a prompt that offers one. A reader pressing Enter here was
  // making a decision about where their customer data lives without being told they had made it.
  const cfgDefault = join(base, "config");
  say("\n  Where this install keeps its own configuration");
  prose("Your customers and any doctrine you override live here, outside the checkout — which is what",
        "lets you take updates with `git pull` instead of merging into files you never meant to own.");
  prose(`Enter accepts ${cfgDefault}, and your customers are written there.`);
  const cfg = await askValue("Configuration directory:", { def: cfgDefault });

  // A store inside the checkout is the exact defect this step exists to prevent, so it is refused here
  // rather than warned about later. resolve() on both sides, and a separator on the prefix, so
  // `<repo>-notes` is not mistaken for a path inside `<repo>`.
  const cfgAbs = resolve(cfg);
  if (isInsideCheckout(cfg, REPO)) {
    problem(`${cfgAbs} is INSIDE the checkout (${resolve(REPO)}).`);
    say("  Everything you write there becomes a local modification to our files: `git pull` conflicts,");
    say("  and `git status` that is never clean. Choose a path outside the checkout.");
    aborted = "config-inside-checkout";
    throw new Error("config-inside-checkout");
  }

  // — THE WIZARD WRITES THE CURRENT SPELLINGS INTO THE USER'S.env, not the retired ones. This is
  // the half that outlives the session: a printed name is read once, a written one is the configuration
  // that reader keeps. Written retired, it works today through the compat window and stops working the
  // day that window closes, on a machine nobody is watching.
  candidate["CLEAROTRON_CUSTOMERS_DIR"] = join(cfg, "profiles");
  candidate.PROFILE_REPO_ROOT = cfg;   // no alias row — this name is current
  for (const k of ["CLEAROTRON_CUSTOMERS_DIR", "PROFILE_REPO_ROOT"]) ok(`${k}=${candidate[k]}`);

  // CLEAROTRON_INSTRUCTIONS_DIR IS DELIBERATELY NOT WRITTEN ( — bb8's F25).
  //
  // Setup used to point it at `<cfg>/skills` and create that directory empty. `clearotron start` then
  // makes `<cfg>` a git repository for saved searches — so the doctrine store ends up INSIDE a checkout
  // that tracks no file under it, and `preflightSkillsStore` classifies exactly that as `blocked`:
  // "doctrine store COULD NOT BE IDENTIFIED ... could-not-determine is not a pass". Every run on every
  // install where the wizard had been run carried that line, for the whole life of the install.
  //
  // Measured on this tree rather than reasoned about: unset classifies `pass`, an empty directory
  // outside a repository classifies `pass`, and an empty directory inside one classifies `blocked`. So
  // the variable was the cause and unset is the cure — which is also the documented supported mode:
  // doctrine resolves to the product's own files and doctor calls that "a normal, supported state".
  //
  // Note for whoever adds an overlay later: it needs this name set, which is why the line below says so
  // rather than leaving a reader to discover that files they dropped in are being ignored.
  info(`doctrine: this install overrides nothing, so CLEAROTRON_INSTRUCTIONS_DIR stays unset and the `
    + `product's own files are used. To override a doctrine file later, put it in ${join(cfg, "skills")}, `
    + `COMMIT it in ${cfg}, and set CLEAROTRON_INSTRUCTIONS_DIR to that directory — an uncommitted store `
    + "cannot be identified, and a run says so rather than guessing.");

  // DELIBERATELY NOT SEEDED, and this reverses what the issue asked for. Copying the house `generic.json`
  // in would make the store a working install — but since an EMPTY store already is one: profiles
  // resolve overlay-over-base, so every bundled profile shows through until the user overrides it by name.
  // A seeded copy would instead be an override of a file nobody chose to override, frozen at install time,
  // drifting from ours silently — which is precisely the failure exists to report on. The empty
  // store is not a missing step; it is the one that keeps `git pull` meaningful.
  // PRECISELY what shows through, because the last wording said "bundled customers" and the loader
  // says otherwise: the demo roster never layers into a deployment (a typo'd key must not resolve to
  // our fixtures), generic.json falls through BY NAME, and doctrine resolves file-by-file.
  say("  Left empty. The house doctrine shows through file-by-file, and generic.json — the universal");
  say("  fallback — falls through by name, so an empty store is a working install. Your own customers");
  say("  are added here by name; the bundled demo customers never show through into your roster.");

  // 8 ── the engine's own preflight over the whole candidate
  //
  // — THIS STEP CHECKS THE REGISTER PROVIDER AND NOTHING ELSE. `preflightCandidate` pins
  // CLEAROTRON_DATABASE and calls the driver's `preflightCredentials`, which refuses by name when no
  // provider is named. That refusal is correct at a RUN door and it is untouched here. But it also sat
  // at the END of setup, so an install that had deliberately selected no register — which the owner
  // ruled on 2026-08-26 that setup must allow — aborted on its last step with "Nothing has been
  // written", after the reader had answered every question.
  //
  // So the check is skipped when there is nothing for it to check, and said out loud rather than
  // silently passed over. A reader who is told a preflight ran and passed, when it never ran, learns
  // to trust a line that means nothing.
  if (registerSelected) {
    say("\n  Running the driver's own credential preflight over these values…");
    const pf = await preflightCandidate(candidate);
    if (pf.ok) ok(`preflight passed for provider "${pf.result.provider}" — checked ${pf.result.checked.join(" + ")}`);
    else {
      problem(pf.error);
      say("\n  Nothing has been written.");
      aborted = "preflight";
      throw new Error("preflight");
    }
  } else {
    say("\n  Skipping the driver's credential preflight: it checks the register provider's credentials,");
    say("  and no register is selected. The run door still refuses by name until one is — that guard is");
    say("  untouched, and this is only setup declining to fail an install it was told to allow.");
  }

  // 9 ── write, atomically
  say("\n  Writing configuration");
  // THE DIRECTORY MAY NOT EXIST, and on a fresh machine it does not. `.env` now lives under
  // `~/.config/clearotron/` (tracker issue 140), which nothing else creates — and the failure without
  // this line lands on the temporary file below, so it reads as a permissions problem writing `.env`
  // rather than a missing folder. Mode 700: the file inside is 600 and holds credentials, so a
  // world-readable directory around it advertises that it is there.
  mkdirSync(dirname(ENV_PATH), { recursive: true, mode: 0o700 });
  if (existsSync(ENV_PATH)) {
    copyFileSync(ENV_PATH, `${ENV_PATH}.bak`);
    chmodSync(`${ENV_PATH}.bak`, 0o600);
    ok(`existing .env backed up to ${ENV_PATH}.bak`);
  }
  const body = composeEnvBody(candidate, existsSync(ENV_PATH) ? readEnvFile(ENV_PATH) : {});
  // Atomic: a half-written .env is a file the loader reads and the engine believes. Write beside the
  // target (same filesystem, so rename is atomic), fix the mode BEFORE it is visible under its real
  // name, then rename over.
  const tmp = `${ENV_PATH}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, body, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, ENV_PATH);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
  ok(`${ENV_PATH} (mode 600)`);

  for (const k of ["CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR", "CLEAROTRON_QUEUE_DIR", "CLEAROTRON_OUTBOX_DIR", "CLEAROTRON_RUN_LOCK_DIR"]) mkdirSync(candidate[k], { recursive: true });
  ok(`data directories created under ${base}`);
  // — CREATED EMPTY, ON PURPOSE. The directories must exist because a configured-but-unreadable
  // store is a hard error on both sides (driver/profiles.mjs and config.resolveSkillPath both throw
  // rather than fall back, so a permissions fault can never silently swap a customer's framework for the
  // Generic default). Nothing is written INTO them — see the note at step 7b.
  for (const k of ["CLEAROTRON_CUSTOMERS_DIR"]) mkdirSync(candidate[k], { recursive: true });
  ok(`configuration directories created under ${cfg} (empty — doctrine and the generic fallback show through; customers are yours to add)`);

  // 9a ── PUT THE VERB ON THIS OPERATOR'S PATH
  //
  // The owner was given a command, typed it from his home directory, and got npm's error rather than
  // ours: `npx` resolves a local package by walking UP from the current directory, so every command
  // this product prints worked only where the reader happened to be standing. Owner ruling 2026-08-26:
  // put the verb on PATH, as a per-user shim — `npm link` wants write access to `/usr` and refuses
  // without root, which is why stopped at teaching the product to print `npx`.
  //
  // IT RUNS BEFORE THE CLOSING SCREEN BECAUSE THE SCREEN ASKS THE FILESYSTEM WHAT TO PRINT. Written
  // after, the three commands below would name a shim that did not exist when they were composed, and
  // the last screen a stranger reads would advertise the one form this issue is about.
  //
  // A SHIM THAT CANNOT BE WRITTEN IS A WARNING, NEVER AN ABORT. Everything the install came to do is
  // already on disk by this line; the verb on PATH is a convenience, and refusing a finished install
  // over a convenience would turn a working install into no install at all.
  say("\n  Putting the `clearotron` verb on your PATH");
  const shim = installShim();
  if (shim.ok) {
    ok(`${shim.path}${shim.replacing ? ` (replaced a shim for ${shim.replacing})` : ""}`);
  } else if (shim.reason === "occupied") {
    // NOT OVERWRITTEN, DELIBERATELY. Somebody else's `clearotron` on this operator's PATH is a fact
    // about their machine; replacing it silently would hijack a name we do not own.
    warn(`${shim.path} exists and was not written by this product — leaving it alone.`);
    info("the commands below name this install explicitly, so they work either way.");
  } else {
    warn(`could not put the verb on your PATH (${shim.reason}: ${shim.detail}).`);
    info("the commands below name this install explicitly, so they work either way.");
  }

  // 10 ── three next commands, and THE PRODUCT IS FIRST
  //
  // — this screen used to end a successful configuration by offering `npm run example` and a
  // raw `node driver/pipeline.mjs --job …`, and never named the product at all. A reader who had just
  // finished configuring the thing was pointed at the two commands that are not it.
  //
  // They are `clearotron` verbs now for a second reason as well: from an INSTALLED package there is
  // no `npm run example` to type — no package.json, no scripts block — so the old advice was not
  // merely misordered there, it was unrunnable.
  // ONE COMMAND, AND WHAT TO EXPECT FROM IT (, the owner's point 10). This screen
  // offered three, each with a sentence, and a reader who has just answered a page of questions is
  // being asked to make one more choice at the moment they most want to be told what to do. Three
  // equally-weighted options is not generosity; it is the decision handed back.
  //
  // `start` is the one, because it is the product — the other two were already ordered behind it for
  // that reason (, when this screen offered `npm run example` and a raw pipeline invocation and
  // named the product nowhere). They keep their place as an afterthought line rather than an option.
  // THE COMMAND LINE STAYS A PLAIN LITERAL, DELIBERATELY. onboard-wizard.test.mjs reads this screen
  // STATICALLY — it extracts every say() literal and asserts which command leads — and that guard is
  // the only thing standing between this screen and 's defect coming back. Wrapping the command in
  // style.bold() puts a nested template literal inside the say(), the extractor stops matching, and the
  // corpus goes empty. Its own comment records the previous generation of exactly this: the arms went
  // vacuous the moment these lines became template literals.
  //
  // So the weight goes on the heading and on the dimming around it, and the command is the one
  // undimmed line in the block — which is the contrast that matters anyway. Styling the command itself
  // would have bought a shade of emphasis at the price of a guard that can read the screen.
  // — F21. The wizard ended by handing the reader a next command and never said
  // it had FINISHED, or what state it had left the box in. The header invites skipping — "everything
  // here is skippable" — and the owner took it up, repeatedly; a reader who has skipped several answers
  // then has no way to tell what they ended up with except by re-reading their own answers upward.
  //
  // NO COMMAND APPEARS IN THIS BLOCK, deliberately. The arm below this screen extracts say() literals
  // and asserts which command LEADS; a command named here would lead instead, and the guard that has
  // twice caught this screen regressing would start reporting the wrong thing.
  const stateLine = (label, value, absent) => `${value ? "set" : "not set"} — ${label}: ${value || absent}`;
  say(`\n  ${style.bold("Setup finished.")} Nothing here needs running again.\n`);
  say("  What this box has now:");
  for (const line of [
    stateLine("register", candidate.CLEAROTRON_DATABASE, "no register, so every search refuses until one is chosen"),
    stateLine("web research", present(candidate.PERPLEXITY_API_KEY) ? "a key" : "", "a clearance refuses at preflight; a knockout search runs and discloses the half it skipped"),
    stateLine("data directory", candidate.CLEAROTRON_REPORTS_DIR, "unset"),
    stateLine("configuration store", candidate.CLEAROTRON_CUSTOMERS_DIR, "the bundled demo roster"),
    stateLine("notification links", candidate.CLEAROTRON_REPORTS_URL, "notifications carry no link into the report"),
    stateLine("client connector", candidate.CLEAROTRON_CLIENT_MCP_URL, "local install; the Use-your-AI page shows its empty state"),
  ]) say(`    ${line}`);

  say(`\n  ${style.bold("Start here:")}\n`);
  say(`    ${invocationPrefix()}clearotron start\n`);
  say("      Starts the portal and the engine door, prints one address, and opens it. That address is");
  say("      the product: you order a clearance from it and read the report there.\n");
  say(`  ${style.dim(`Also: \`${invocationPrefix()}clearotron demo\` replays a finished report with no keys and no model calls;`)}`);
  say(`  ${style.dim(`\`${invocationPrefix()}clearotron run --job examples/job.euipo.json\` runs a first real clearance on the EU register.`)}`);
  say(`  ${style.dim("Each still works the old way too — `npm start`, `npm run example`, `node driver/pipeline.mjs`.")}\n`);

  // WHY THOSE LINES LOOK THE WAY THEY DO, when they are not the bare verb (Refs tracker issue 1916).
  //
  // A login profile adds `~/.local/bin` to PATH only if the directory existed when the shell started,
  // so the shim written seconds ago is usually absent from THIS terminal's PATH and arrives at the next
  // login. That is the ordinary case, not a fault, and the absolute path above is the only one of the
  // three forms that is true in the terminal the reader is sitting in. Saying nothing would leave a
  // stranger reading a long path with no idea it becomes a short one tomorrow.
  //
  // Same shape as the engine-binary advice further up: name the directory, say what to add.
  const form = invocationForm();
  if (form.form === "shim-path" && form.shadowedBy) {
    say(`  A different \`clearotron\` is earlier on your PATH (${form.shadowedBy}), so the commands above`);
    say(`  name this install's own at ${form.shim} rather than trusting the bare name.\n`);
  } else if (form.form === "shim-path") {
    say(`  \`clearotron\` is now installed at ${form.shim}, and ${form.dir} is not on this shell's`);
    say("  PATH yet — most login profiles add it only if it existed when the shell started. So:\n");
    say(`    export PATH="${form.dir}:$PATH"     # this terminal, now`);
    say("      …or open a new login shell, and plain `clearotron start` works from anywhere.\n");
  } else if (form.form === "in-place") {
    say("  There is no `clearotron` on your PATH, so the commands above name the directory to run them");
    say("  from. Re-run the install to put the verb on your PATH.\n");
  }
  // — THE LAST SCREEN A STRANGER READS MUST NOT RECOMMEND A COMMAND THAT WILL REFUSE.
  //
  // Setup may now finish with no register, and the clearance run offered on the "Also" line is a real
  // one: it refuses at the door until CLEAROTRON_DATABASE is set. Printing it unqualified sends a
  // reader who followed every instruction to a refusal with no idea it was expected — the exact shape
  // of failure this issue was filed about, moved one screen later. `demo` and `start` are unaffected
  // and stay recommended, which is why this names them rather than a blanket warning.
  //
  // NAMED, NOT NUMBERED. This said "the third command above" and pointed at a
  // numbered list that no longer exists — the screen now leads with one command and demotes the other
  // two. A positional reference into copy somebody else will rewrite is a stale pointer waiting to
  // happen, and it went stale in the same commit that cut the list.
  // ── — CASE LAW IS NAMED ONCE, AND NOTHING IS COLLECTED ────────────────────
  //
  // ADR-0003 settles that setup must not offer to adopt an ambient case-law key: it is an OAuth flow,
  // not a variable, and offering to adopt one taught a new install to set something that configures
  // nothing. That reasoning is kept and this obeys it — nothing is asked, nothing is read, nothing is
  // written. What the ADR does not forbid is a SENTENCE, and its absence is why the owner met the lane
  // for the first time in a finished report, two and a half hours and real spend later.
  //
  // Printed only when nothing is enrolled, because on a box that has it there is nothing to say. Named
  // from the product's own declaration rather than typed, so it stays true if the offering changes.
  {
    const { caseLawInventory } = await import("../driver/config-inventory.mjs");
    const { PRODUCTS } = await import("../driver/products.mjs");
    const enrollable = caseLawInventory(process.env).filter((r) => r.enrolment === "oauth");
    const needs = PRODUCTS.filter((pr) => pr.caseLaw).map((pr) => pr.name);
    if (needs.length && !enrollable.some((r) => r.configured)) {
      say("\n  Case law");
      say(`  ${needs.join(" and ")} reasons against case law and oppositions. No case-law source is`);
      say("  enrolled on this box, so that search will run and its report will state the gap rather than");
      say("  telling you what the courts have decided. Nothing here can set it up: it is a one-time OAuth");
      say("  sign-in, described in providers/oauth-mcp-bridge/README.md, and every other search is");
      say(`  unaffected. \`${invocationPrefix()}clearotron doctor\` reports it at any time.\n`);
    }
  }

  if (!registerSelected) {
    warn(`no register is selected, so \`${invocationPrefix()}clearotron run\` will refuse at its door.`);
    say(`    \`${invocationPrefix()}clearotron demo\` and \`${invocationPrefix()}clearotron start\` work now. A real`);
    say("    clearance needs one register — any one is enough, and none requires another:");
    say(`      ${PROVIDERS.map((p) => p.id).join(", ")}`);
    say(`    Set it by re-running \`${invocationPrefix()}clearotron install\`, or on the Global config page.`);
    say(`    \`${invocationPrefix()}clearotron doctor\` says which state this install is in, at any time.\n`);
  }
} catch (e) {
  if (!aborted) {
    muted = false;
    // Ctrl-D / a closed stdin lands here. It is not a crash and must not read like one — and nothing has
    // been written at any point before the single atomic rename at the end.
    const msg = /Ctrl\+D|closed|aborted/i.test(String(e?.message ?? e))
      ? "cancelled. Nothing was written."
      : String(e?.message ?? e);
    console.error(`\nsetup: ${msg}\n`);
    rl.close();
    process.exit(2);
  }
} finally {
  muted = false;
  rl.close();
}
process.exit(aborted ? 1 : 0);
}
