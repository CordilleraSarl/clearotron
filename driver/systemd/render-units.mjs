#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// render-units.mjs — RESOLVE THE UNITS CONFIGURATION CANNOT REACH, AND WRITE THE RESOLVED COPIES.
//
// Owner ruling 2026-08-25 (, option B): the installer writes resolved unit copies into
// ~/.config/systemd/user/, and the tracked units stay generic.
//
// WHY THIS EXISTS AT ALL. Most shipped units take what differs per box from `EnvironmentFile=%h/.env`
// and expand `${CLEAROTRON_CHECKOUT_DIR}` in `ExecStart=`. Three cannot:
//
//   · a `.path` unit CANNOT READ AN ENVIRONMENT VARIABLE — no %E, no EnvironmentFile, no expansion
//     (driver/systemd/README.md). Its `PathExistsGlob=` is a literal or it is nothing.
//   · `profile-service.service` loads no EnvironmentFile DELIBERATELY: its CF Access identifiers are set
//     explicitly so that ~/.env cannot shadow the trademark AUD. On systemd an EnvironmentFile WINS over
//     an Environment= line, so gaining the variable would cost the protection.
//   · `courtlistener-mcp.service` loads none for the same class of reason — an EnvironmentFile would let
//     ~/.env override its PATH.
//
// Documenting them as operator edits works and is honest, and it puts the burden on somebody
// remembering. The failure when they do not is silent in two of the three.
//
// THE PLACEHOLDER IS `@NAME@`, AND THE CHOICE IS LOAD-BEARING. systemd expands `%h` and `${VAR}` in
// some positions and not others, which is the whole reason these three are stuck. It expands `@NAME@`
// NOWHERE. So a placeholder this script fails to substitute reaches systemd verbatim and the unit fails
// to start with the literal in the error — loud, immediate, and naming the variable that was missing.
// A substitution scheme that degrades to something plausible would hide exactly the case this exists for.
//
// THE SET IS DERIVED, NOT LISTED. Every tracked unit is scanned; a unit is "resolved" if and only if it
// contains a placeholder. A hand-kept list of which units need rendering is a second answer waiting to
// disagree with the files, and it goes stale the first time somebody adds a placeholder without finding
// the list. `driver/unit-inventory.mjs` still declares them — and a test asserts the declaration and the
// files agree in BOTH directions, so neither can drift alone.
//
// Usage:
//   node driver/systemd/render-units.mjs --check     compare installed copies against this tree; exit 1 on drift
//   node driver/systemd/render-units.mjs --apply     write the resolved copies
//   node driver/systemd/render-units.mjs             same as --check (read-only by default)
//
//   --dest <dir>   where the resolved copies go (default ~/.config/systemd/user)
//   --env  <file>  the environment file to read values from (default ~/.env)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { SERVER_INSTALL_SET } from "../../shared/server-units.mjs";   // — one authority, two callers
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDenylistPath } from "../../shared/client-door.mjs";
import { homedir } from "node:os";
import { envFrom } from "../../shared/env-aliases.mjs";
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

// The directories a shipped unit can live in. Derived from the tree, not from a list of unit names —
// adding a unit to any of these is enough for it to be seen.
export const UNIT_DIRS = Object.freeze([
  "driver/systemd",
  "mcp-server/remote",
  "providers/oauth-mcp-bridge/systemd",
]);

const UNIT_EXT = /\.(service|path|timer|socket)$/;
export const PLACEHOLDER_RE = /@([A-Z][A-Z0-9_]*)@/g;

/** Every tracked unit file, as {path, rel, text}. PURE over a root so a test can point it anywhere. */
export function trackedUnits(root = ROOT) {
  const out = [];
  for (const d of UNIT_DIRS) {
    const abs = join(root, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (!UNIT_EXT.test(f)) continue;
      const p = join(abs, f);
      if (!statSync(p).isFile()) continue;
      out.push({ path: p, rel: `${d}/${f}`, name: f, text: readFileSync(p, "utf8") });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// A COMMENT MUST NEVER DEMAND A VALUE, and this was found by the tool on its own first run rather than
// by a test. `profile-service.service` explains the convention in prose — "an unsubstituted @NAME@
// reaches systemd verbatim" — and the scanner dutifully reported `NAME` as a placeholder the installer
// must resolve. A unit that DOCUMENTS the mechanism would have refused to render.
//
// So the REQUIRED set is read from directive lines only. Substitution still runs over the whole file, so
// a comment carrying a real placeholder is rewritten to match the directive beside it and never shows a
// reader something the unit does not do; it simply cannot make the render refuse.
const isCommentLine = (l) => /^\s*(#|;)/.test(l);
export const directiveText = (text) =>
  String(text ?? "").split("\n").filter((l) => !isCommentLine(l)).join("\n");

/**
 * The placeholder names a unit REQUIRES, deduplicated and sorted. Empty ⇒ it needs no rendering.
 * `includeComments` is for the substitution pass and for tests that assert the comment rule itself.
 */
export function placeholdersIn(text, { includeComments = false } = {}) {
  const scanned = includeComments ? String(text ?? "") : directiveText(text);
  return [...new Set([...scanned.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))].sort();
}

/** The units that need rendering, derived. */
export function unitsNeedingRender(root = ROOT) {
  return trackedUnits(root).map((u) => ({ ...u, placeholders: placeholdersIn(u.text) }))
    .filter((u) => u.placeholders.length);
}

// ── VALUES ───────────────────────────────────────────────────────────────────────────────────────
//
// Read from the process environment first, then the environment file the units themselves load. Both go
// through `envFrom`, so a name that later gains an old spelling in the alias table keeps resolving —
// a literal `process.env.X` here would be a spelling, and a spelling goes stale in silence.
//
// A `KEY=value` parser and nothing more: this reads the same file systemd's EnvironmentFile= reads, and
// systemd does no shell expansion there either. Quotes are stripped because operators write them.
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function resolveValues(names, { env = process.env, envFile = null } = {}) {
  const fileVals = envFile && existsSync(envFile) ? parseEnvFile(readFileSync(envFile, "utf8")) : {};
  const values = {}, missing = [];
  for (const n of names) {
    const v = envFrom(env, n) ?? envFrom(fileVals, n) ?? null;
    if (v == null || String(v).trim() === "") missing.push(n);
    else values[n] = String(v).trim();
  }
  return { values, missing };
}

/**
 * Substitute, or refuse. NEVER a partial write: a unit with one placeholder left is a unit that starts
 * and misbehaves, which is worse than one that does not start. Returns {text} or throws.
 */
export function renderUnit(text, values) {
  // Only DIRECTIVE placeholders can refuse a render — see the comment rule above.
  const left = placeholdersIn(text).filter((n) => values[n] == null);
  if (left.length) throw new Error(`unresolved placeholder(s): ${left.join(", ")}`);
  // `?? whole` and not `?? ""`: a placeholder with no value is only ever a COMMENT one by this point
  // (the directive set refused above), and rewriting it to "undefined" — which is what returning the
  // bare lookup did — puts a word in a comment that the unit never said. Leave prose as written.
  return String(text).replace(PLACEHOLDER_RE, (whole, n) => values[n] ?? whole);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Through `isEntrypoint`, never a raw argv comparison: it realpaths both sides, and `process.argv[1]`
// keeps the path the caller typed while the module URL is resolved — so through a symlink they differ
// and main() never runs, the process exiting 0 having done nothing.
if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
  const APPLY = argv.includes("--apply");
  const dest = resolve(arg("--dest", join(homedir(), ".config", "systemd", "user")));
  const envFile = resolve(arg("--env", join(homedir(), ".env")));

  // ── WHAT GETS INSTALLED IS A LIST, NOT A SIDE EFFECT OF NEEDING A PLACEHOLDER ──────────────────
  //
  //. This used to iterate `unitsNeedingRender`, and the result was that a
  // documented hosted install placed exactly two units: a retired queue watcher and a bridge no box
  // runs under that name. Not the portal, not the engine door, not the drainer — because those take
  // `${VAR}` from their EnvironmentFile, carry no placeholder, and a RENDERER CORRECTLY SKIPS THEM.
  // The tool was doing its job; the documentation called it the install step. It exited 0 having
  // written two files, which is why nobody noticed.
  //
  // So the set is now `SERVER_INSTALL_SET` — stated in shared/server-units.mjs, read by this path and
  // by `clearotron start --background`, so the two cannot answer the question differently. Members
  // that carry a placeholder are rendered; members that do not are copied verbatim, which is the
  // whole of what changed for them.
  const tracked = trackedUnits();
  const missingFiles = SERVER_INSTALL_SET.filter((n) => !tracked.some((u) => u.name === n));
  if (missingFiles.length) {
    // A list naming a file the tree does not ship installs nothing and reads as done — the same
    // absence-as-a-pass the inventory's own ratchets refuse.
    console.error(`render-units: REFUSED — ${missingFiles.length} unit(s) named for install are not in `
      + `the tree: ${missingFiles.join(", ")}. Nothing was written.`);
    process.exit(1);
  }
  const units = SERVER_INSTALL_SET
    .map((n) => tracked.find((u) => u.name === n))
    .map((u) => ({ ...u, placeholders: placeholdersIn(u.text) }));
  const names = [...new Set(units.flatMap((u) => u.placeholders))].sort();
  const { values, missing } = resolveValues(names, { envFile });

  console.log(`render-units: installing ${units.length} unit(s), ${names.length} placeholder value(s) to resolve`);
  console.log(`  values from: the environment, then ${envFile}`);
  if (missing.length) {
    // REFUSE, and name every missing one at once rather than the first. An operator fixing these is
    // editing one file; telling them about one variable at a time costs a round trip each.
    console.error(`render-units: REFUSED — ${missing.length} value(s) unset: ${missing.join(", ")}`);
    console.error("  Set them in the environment or in the file above, then run again. Nothing was written:");
    console.error("  a unit with an unsubstituted placeholder starts and misbehaves, which is worse than not starting.");
    process.exit(1);
  }
  for (const n of names) console.log(`  ${n}=${values[n]}`);

  // ── THE ENV COMES BEFORE THE UNITS, AND THAT ORDER IS THE POINT ────────────
  //
  // It used to run after the write loop, when the only thing at stake was `PORTAL_MCP_URL` and a box
  // that had its units was strictly better off than one that did not. Since settled point 2 the set
  // includes the CLIENT DOOR, and that unit REFUSES TO START without settings this block writes — so
  // placing it first would mean an install whose last act is to hand systemd a unit it has already
  // decided cannot run. `Restart=on-failure` then makes that a crash loop rather than a single error.
  //
  // Written first, and a failure here REFUSES before any unit is placed. The rule this restores is the
  // one the missing-files branch above already follows: nothing is written when the install cannot be
  // completed, because a half-installed box reports itself installed.
  let laneNote = "";
  if (APPLY) laneNote = await writeInstallEnv(envFile);

  let drift = 0;
  for (const u of units) {
    const rendered = renderUnit(u.text, values);
    const target = join(dest, u.name);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (APPLY) {
      mkdirSync(dest, { recursive: true });
      writeFileSync(target, rendered);
      console.log(`  wrote ${target}${current === rendered ? " (unchanged)" : ""}`);
    } else if (current === null) { drift++; console.log(`  ABSENT  ${target}`); }
    else if (current !== rendered) { drift++; console.log(`  DRIFTED ${target}`); }
    else console.log(`  current ${target}`);
  }
  if (APPLY) {
    if (laneNote) console.log(laneNote);
    console.log("render-units: written. `systemctl --user daemon-reload` before starting them.");
    process.exit(0);
  }
  // An absence counts as drift, not as a pass: "no copy installed" is exactly the state this refuses to
  // report as clean, and it is the state a fresh box is in.
  if (drift) {
    console.error(`render-units: ${drift} unit(s) absent or drifted. Re-run with --apply.`);
    process.exit(1);
  }
  console.log("render-units: every resolved copy matches this tree.");
}

/**
 * Everything the installed units read out of the env file — written before a single unit is placed.
 *
 * ── THE LANE THE UNITS NEED, WRITTEN RATHER THAN LEFT EMPTY ────────────────
 *
 * Installing the portal without `PORTAL_MCP_URL` produces a box whose Start button has no engine to
 * call, and whose every health surface says fine. `bin/start.mjs` was the only thing that ever set it,
 * so a documented hosted install never did — the deployment env example ships the row EMPTY with a
 * correct sentence about what empty costs, which asks a reader to do arithmetic this product can do
 * itself.
 *
 * ADD-ONLY, so an operator's own value always wins, and an existing row — even an empty one — is left
 * exactly as it is rather than gaining a second assignment underneath it.
 *
 * ── AND THE CLIENT DOOR'S OWN SETTINGS, FROM ITS OWN AUTHORITY ─────────────
 *
 * The names are NOT written out here. `enablePlan` in `shared/client-door.mjs` derives them — six
 * names and an allow-list composed from the same resolved port — and it is what `clearotron connect`
 * has always called. A second list here would be a second author for a door's security posture, and
 * the specific way that breaks is documented in that function: a port written in one place and an
 * allow-list in another produce a door that starts and turns every request away, which reads as a dead
 * door rather than as a misconfiguration.
 *
 * Returns the line to print, or throws — and a throw here refuses the install.
 */
export async function writeInstallEnv(envFile) {
  const { mergeEnvFile } = await import("../../shared/env-file-merge.mjs");
  const { laneValuesFor, LANE_VALUE_NOTES, signingSecretIfAbsent } = await import("../../shared/lane-address.mjs");
  const { enablePlan } = await import("../../shared/client-door.mjs");
  const { randomBytes } = await import("node:crypto");
  const { resolvePorts } = await import("../../bin/start.mjs");

  const fileEnv = parseEnvFile(existsSync(envFile) ? readFileSync(envFile, "utf8") : "");
  const ports = resolvePorts({ ...fileEnv, ...process.env });
  let body = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const want = laneValuesFor({ ports });
  // ── THE SIGNING SECRET, GENERATED IF ABSENT ( Q4) ──────────────────────────
  //
  // The client door refuses to start without it, and bin/start.mjs has been the only thing that
  // ever minted one — so a documented hosted install could not bring that door up at all.
  //
  // Q4 IS THE OWNER'S WORD SINCE 2026-09-03 ("on q4 yes"), replacing the INFERRED marking this block
  // was written under. The behaviour it confirms is the one already here: generate if absent, never
  // replace a live secret, announce it.
  //
  // ANNOUNCED, NEVER SILENT. An installer that begins generating cryptographic material is a posture
  // change, and the reader meets it in the output of the command that does it rather than discovering
  // it in a file.
  const fresh = signingSecretIfAbsent(fileEnv.TRADEMARK_MCP_TOKEN_SECRET ?? process.env.TRADEMARK_MCP_TOKEN_SECRET, { randomBytes });
  if (fresh) {
    want.TRADEMARK_MCP_TOKEN_SECRET = fresh;
    console.log("  GENERATED a signing secret for this install (32 bytes). Every key is signed with");
    console.log("  it, so replacing it later invalidates every key already issued. Written to the env");
    console.log("  file at mode 600, and never printed.");
  }

  // ── THE CLIENT DOOR'S SETTINGS, FROM `enablePlan` AND AFTER THE SECRET ────
  //
  // ORDER IS LOAD-BEARING AND THE HANDOVER NAMED IT: `enablePlan`'s first blocker is the missing
  // signing secret, so it must be asked AFTER the generation above — and asked against the env as it
  // WILL BE, not as it was. `want` is not on disk yet, so the view handed in merges it over the file.
  //
  // `issuesKey: false` because an installer mints nothing. That flag turns off exactly the two
  // blockers that are about a key (a signed-in identity; that identity's enrolment) and leaves every
  // settings blocker armed — see the function's own header for why the split is where it is.
  //
  // `portIsFree` IS NOT PASSED, and that is a deliberate `undefined` rather than an oversight. Binding
  // a port to test it is a live act, and an installer that races the door it is about to install would
  // report the door's own listener as an occupied port on every re-run. The check stays where a reader
  // is standing in front of it: `clearotron connect`.
  const doorPlan = enablePlan({
    env: { ...fileEnv, ...want },
    address: null,
    identity: null,
    issuesKey: false,
    checkoutDir: ROOT,
    denylistPath: defaultDenylistPath(homedir()),   // — one owner for this path
    // The unit reads the FILE, never this shell. `want` is what is about to be written to it, so this
    // is true iff the door will find a secret where it looks — which is the exact question the blocker
    // asks, and the one a shell-exported secret answers wrongly.
    unitEnvHasSecret: Boolean(String((want.TRADEMARK_MCP_TOKEN_SECRET ?? fileEnv.TRADEMARK_MCP_TOKEN_SECRET) ?? "").trim()),
  });
  if (!doorPlan.possible) {
    // REFUSED, NOT WARNED. This used to be a warning about `PORTAL_MCP_URL`, where a box with units and
    // no lane was still better than a box with neither. It is not true of the client door: the unit is
    // in the install set now, `Restart=on-failure` is in its file, and placing it without these
    // settings produces a crash loop that the ruling names as forbidden in its own words — "never a
    // unit failing at boot".
    console.error("render-units: REFUSED — the client door's settings cannot be written, so its unit "
      + "would be installed and crash-loop. Nothing was written:");
    for (const b of doorPlan.blockers) {
      console.error(`  · ${b.why}`);
      console.error(`    ${b.fix}`);
    }
    // THE HOSTED READER IS NOT THE READER THOSE REMEDIES WERE WRITTEN FOR, and this is the reachable
    // case rather than the exotic one: the deployment env example ships `CLEAROTRON_ACCESS_FILE=` EMPTY,
    // so an operator who copies it and runs this reaches exactly here. The blockers' own remedies say
    // "run `clearotron start`", which is right for the laptop reader `connect` serves and is not what a
    // hosted operator is doing. Both ways out, named, on the one command that refused.
    console.error(`  On a hosted install, set these in ${envFile} (INSTALL.md §8 names them) and run this`);
    console.error("  again. `clearotron start` writes them itself if this box is a local install.");
    process.exit(1);
  }
  for (const [k, v] of Object.entries(doorPlan.settings)) want[k] = v;

  // AN EMPTY ROW IS NOT A CHOICE, and this is the case that matters most rather than an edge.
  // the deployment env example ships `PORTAL_MCP_URL=` empty, so the operator most likely to hit
  // this path has that exact line — and add-only would leave it, report "already carries the
  // address", and hand them the dead lane this whole change exists to end. A blank value is a
  // template the reader never filled in, not a decision to overwrite; a value they actually set
  // is left untouched, which is what add-only is protecting.
  const filled = [];
  for (const [k, v] of Object.entries(want)) {
    const blank = new RegExp(`^[ \\t]*${k}[ \\t]*=[ \\t]*$`, "m");
    if (blank.test(body)) { body = body.replace(blank, `${k}=${v}`); filled.push(k); }
  }
  const merged = mergeEnvFile(body, want, { by: "`render-units.mjs --apply`", notes: LANE_VALUE_NOTES });
  const changed = [...filled, ...merged.added];
  if (changed.length) {
    writeFileSync(envFile, merged.text, { mode: 0o600 });
    // NAMES ONLY. One of these is the signing secret.
    return `  ${envFile} — set ${changed.join(", ")}`;
  }
  return `  ${envFile} already carries the lane and the client door's settings, left as the operator set them`;
}
