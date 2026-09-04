#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// validate-profiles.mjs — validate a customer-config store's profile bundles. Read-only.
//
//   node scripts/validate-profiles.mjs [--dir <profiles dir>]
//
// Exit 0 clean, 1 with findings, 2 if it could not look.
//
// ── why this exists as a CLI ─────────────────────────────────────────────────────────────────────────
//
// Every guard below already existed, and none of it was reachable from outside this repo. The live config
// store holds the only real client data of the three repos and has no CI: `render-skills.mjs --check` was
// its single guard and it ran by hand. A bad `owned/` edit or a malformed bundle reached production
// without passing through anything. That store has no package.json and cannot import this module, so the
// check has to be an entry point its CI can call after checking this repo out.
//
// ── it collects, it does not stop at the first ────────────────────────────────────────────────────────
//
// `loadProfiles` throws on the first bad bundle, which is right for a running driver and wrong for CI: an
// author fixing one error at a time per push learns to distrust the gate. So each bundle is validated
// through `validateProfileEdit`, which collects, and the cross-file guards run afterwards.
//
// ── the guards are not re-implemented here ───────────────────────────────────────────────────────────
//
// Everything is `driver/profiles.mjs`'s own: the F7 deny-unknown-key rule, the F8 appetite guard, the
// delivery/template/style checks, the context-pack shape, the sparse rules for a project overlay, the
// required `generic.json`, and the matchDomains-overlap refusal. A second copy of a validator drifts from
// the first, and then the store passes a check the driver disagrees with — which is the failure this is
// supposed to prevent, arriving one level up.

import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfiles, loadProjects, validateProfileEdit, assertProfileKey } from "../driver/profiles.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const dirArg = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : null;

// Precedence: --dir, then CLEAROTRON_CUSTOMERS_DIR, then the bundled demo roster. The bundled roster is a
// legitimate target (it is what a clean checkout and the offline tests validate against), so this does
// not refuse an unset env — but it says which store it read, because the two share not one key and a
// report that does not name the store is unreadable.
// / — read EVERY spelling. Reading one makes an operator who set the documented name read
// as having set nothing.
//
// AND THE REPORT NAMES THE CURRENT SPELLING, NOT "the one they set" — measured, not preferred.
// `applyEnvAliases` fills BOTH directions, so by the time any downstream site looks, both spellings
// carry the value and which one the operator typed is unrecoverable. The only sites that can honestly
// report it are the ones that tracked provenance themselves (`bin/onboard.mjs`'s `effective()`).
// A legacy-spelling reader is not stranded: the deprecation notice that fires above this line names
// both, which is what makes the current spelling the useful half to print.
const envSpelling = ["CLEAROTRON_CUSTOMERS_DIR"].find((n) => (process.env[n] ?? "").trim());
const dir = dirArg || (envSpelling ? process.env[envSpelling].trim() : "") || join(REPO, "driver", "profiles");
const source = dirArg ? "--dir" : envSpelling || "bundled demo roster";

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`validate-profiles: no profiles directory at ${dir}  (${source})`);
  console.error(`  pass --dir <path>, or set CLEAROTRON_CUSTOMERS_DIR.`);
  process.exit(2);
}

const findings = [];
const add = (where, msg) => findings.push(`${where}: ${msg}`);

// ── every customer bundle ────────────────────────────────────────────────────────────────────────────

const bundles = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (!bundles.length) add(dir, "holds no *.json profile bundle at all — an empty store is not a clean one");

for (const f of bundles) {
  const key = f.replace(/\.json$/, "");
  // `generic` is exempt: the key rule governs what a CREATE path may mint, and generic predates it.
  if (key !== "generic") {
    try { assertProfileKey(key); } catch (e) { add(f, e.message); }
  }
  let obj;
  try { obj = JSON.parse(readFileSync(join(dir, f), "utf8")); }
  catch (e) { add(f, `unparseable JSON (${e.message})`); continue; }

  // The context pack rides with the bundle when one exists — same pairing the driver reads.
  const packPath = join(dir, `${key}.context.md`);
  const pack = existsSync(packPath) ? readFileSync(packPath, "utf8") : "";

  const { ok, errors } = validateProfileEdit(key, obj, pack);
  if (!ok) for (const e of errors) add(f, e);
}

// ── every project overlay ────────────────────────────────────────────────────────────────────────────

const projDir = join(dir, "projects");
if (existsSync(projDir)) {
  for (const ck of readdirSync(projDir).sort()) {
    const cdir = join(projDir, ck);
    if (!statSync(cdir).isDirectory()) continue;
    for (const f of readdirSync(cdir).filter((x) => x.endsWith(".json")).sort()) {
      const rel = `projects/${ck}/${f}`;
      let obj;
      try { obj = JSON.parse(readFileSync(join(cdir, f), "utf8")); }
      catch (e) { add(rel, `unparseable JSON (${e.message})`); continue; }
      // sparse: an overlay states only its deltas, and may not touch identity or rating authority.
      const { ok, errors } = validateProfileEdit(f.replace(/\.json$/, ""), obj, "", { sparse: true });
      if (!ok) for (const e of errors) add(rel, e);
    }
  }
}

// ── the cross-file guards ────────────────────────────────────────────────────────────────────────────
//
// These cannot be collected per file because they are properties of the SET: the universal fallback must
// exist, no two profiles may claim the same match domain (readdir order must never decide a customer),
// and every overlay must have a customer to overlay.

// They run only once the per-file pass is clean. `loadProfiles` throws on the FIRST bad bundle, so with
// a broken bundle present it re-reports that one error and reaches none of the set-level guards — a
// missing `generic.json` sat behind a single unknown key and never got mentioned. Reporting a per-file
// error twice while hiding a worse one is the opposite of what a CI report is for.

let profiles = null;
let crossFileRan = false;

if (!findings.length) {
  crossFileRan = true;
  try { profiles = loadProfiles({ dir, force: true }); }
  catch (e) { add("the store as a whole", e.message); }

  if (profiles) {
    try { loadProjects({ dir, profiles, force: true }); }
    catch (e) { add("project overlays", e.message); }
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────

console.log(`validate-profiles: ${dir}  (${source})`);
console.log(`  ${bundles.length} bundle(s)${profiles ? `, roster: ${[...profiles.keys()].sort().join(", ")}` : ""}`);

if (!findings.length) {
  console.log(`  no findings.`);
  process.exit(0);
}

console.error(`\n${findings.length} finding(s):`);
for (const f of findings) console.error(`  - ${f}`);
if (!crossFileRan) {
  console.error(`\nThe set-level guards did NOT run — a required generic.json, a matchDomains collision and an`);
  console.error(`orphaned project overlay are all still unchecked. Fix the above and run again.`);
}
console.error(`\nEvery check above is driver/profiles.mjs's own load-time guard. A bundle that fails here`);
console.error(`is one the driver would refuse at runtime — which on a live store means refusing a customer.`);
process.exit(1);
