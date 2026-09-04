#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grant.mjs — put someone on the guest list, take them off, or see who is on it ( item 2).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
//
// The guest list was a JSON file edited by hand. `bin/start.mjs` writes an empty one at install and
// nothing added a person to it, so for anyone self-hosting the only way to let a second person in was a
// text editor — and a mistake in that file does not error. `accountsForEmail` simply matches nothing,
// and the person signs in to an empty world with nothing in any log to say why.
//
// `npm start` and `npm run setup` exist so that installing is not that. Enrolment is the very next thing
// the same reader does, and it dropped straight back to the editor.
//
// ── ONE OPINION ABOUT VALIDITY, NOT TWO ───────────────────────────────────────────────────────────
//
// The product already knew what a mistake looked like: `accessView` (driver/portal-config-view.mjs)
// computes BOTH typo directions for the People & access screen — a grant naming an account its own
// tenant does not hold, and an account named in a grant that no customer bundle matches. It computed
// them AFTER the mistake shipped.
//
// So this command does not grow a second opinion. It builds the grants object it is about to write,
// runs `accessView` OVER THAT PROPOSED STATE, and refuses if the change would introduce either finding.
// The screen's report and this refusal are the same code by construction — they cannot drift, and there
// is no second definition of "a good grant" to keep in step.
//
// The email rule is borrowed the same way: `makePrincipal` refuses a multi-`@` identity outright, so a
// grant for one could never resolve. Rather than restate the rule, this asks `makePrincipal`.
//
// ── THE FILE STAYS AUTHORITATIVE ──────────────────────────────────────────────────────────────────
//
// This is an editor for that file and never a second store. It stays hand-editable, and anything this
// command writes a human can read and change back. No browser write path is added here or anywhere.
//
// WRITTEN ATOMICALLY, because the portal reads this file PER REQUEST — that is what makes a grant land
// without a restart, and it is also what makes a non-atomic write dangerous: a reader catching a
// half-written file gets malformed JSON, and `loadGrants` throws on it. Fail-closed, but a routine
// enrolment would 500 the portal for a moment. `atomicWrite` renames into place, so a reader sees the
// old file or the new one and never a partial.

// FIRST IMPORT, and that ordering is enforced (driver/test/env-local.test.mjs). It loads `<repo>/.env`
// and applies the name aliases as a side effect, so anything imported after it sees a settled
// environment — an import that read `process.env` at module scope before this ran would see the
// unaliased one and disagree with every other reader in the tree.
//
// It is also why FILE below reads the CLEAROTRON_* spelling. An operator sets CLEAROTRON_ACCESS_FILE;
// `applyEnvAliases` translates it. Reading the operator's spelling directly would work — and would put
// the first direct CLEAROTRON_* product read in the tree, which 's arm catches, because the
// declaration ratchet is keyed on the CLEAROTRON_* prefix and goes blind the moment that premise stops
// holding. One reader, one spelling.
import "../shared/env-local.mjs";
import { readFileSync, existsSync } from "node:fs";
import { assertGrantsShape } from "../shared/scope.mjs";   // — one shape check, not a second opinion
import { basename } from "node:path";
import { atomicWrite } from "../driver/progress.mjs";
import { accessView } from "../driver/portal-config-view.mjs";
import { makePrincipal } from "../driver/portal-access.mjs";
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

const FILE = envFrom(process.env, "CLEAROTRON_ACCESS_FILE") || "";

const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
const out = (msg) => console.log(msg);

/** The grants file, or a stated refusal. NEVER an invented empty one — a typo in the path would then
 *  silently create a second guest list nobody reads. */
function readGrants() {
  if (!FILE) die("No guest list configured. Set CLEAROTRON_ACCESS_FILE to the grants file the portal reads.");
  if (!existsSync(FILE)) die(`No guest list at ${FILE}. \`npm start\` writes an empty one at install; point CLEAROTRON_ACCESS_FILE at it, or create it as {"tenants":{}}.`);
  let g;
  try { g = JSON.parse(readFileSync(FILE, "utf8")); }
  catch (e) { die(`${basename(FILE)} is not valid JSON (${e.message}). Refusing to touch it — fix it by hand, or the portal will 500 on every request until you do.`); }
  if (!g || typeof g.tenants !== "object" || Array.isArray(g.tenants)) die(`${basename(FILE)} has no \`tenants\` object. Refusing to rewrite a file this command does not recognise.`);
  // — THE SAME SHAPE CHECK THE PORTAL'S READER MAKES, not a second opinion.
  // This command has its own reader (it must: it refuses to rewrite a file it cannot recognise, which
  // `loadGrants` has no opinion about), and a reader that stops at "has a tenants object" hands a
  // valid-JSON wrong shape straight through — which is how an operator got `TypeError: (eff ?? []) is
  // not iterable` from a door instead of a sentence from the command they were already running.
  try { assertGrantsShape(g, basename(FILE)); }
  catch (e) { die(`${e.message}\nRefusing to touch the file — fix that entry by hand.`); }
  return g;
}

/**
 * Every account key a customer bundle actually holds, or NULL when that cannot be established.
 *
 * EMPTY IS NULL HERE, DELIBERATELY. `accessView` guards its unknown-account check with
 * `if (known.size && …)` — so an empty set means the check DOES NOT RUN and reports nothing, which is
 * indistinguishable from running and finding nothing. Collapsing empty into null makes the command say
 * "not checked" instead of implying "checked and clean": not probed is not passed.
 */
async function knownAccounts() {
  try {
    const { loadProfiles } = await import("../driver/profiles.mjs");
    const keys = [...loadProfiles({ force: true }).keys()];
    return keys.length ? keys : null;
  } catch { return null; }
}

/**
 * Would this proposed state be a good one? Asked of `accessView`, so the answer is the screen's answer.
 *
 * Returns the findings ATTRIBUTABLE TO THIS CHANGE only. A guest list that already contains someone
 * else's dangling grant is not this operator's problem to fix before they can add a colleague, and
 * refusing on it would make the command unusable on exactly the messy file it exists to tidy.
 */
function faultsIntroduced(before, after, known, email) {
  const view = (g) => accessView({ grants: g, knownAccounts: known ?? [], grantsFile: null });
  const b = view(before), a = view(after);
  const rowFor = (v) => v.people.filter((p) => p.email === email);
  const dangling = rowFor(a).flatMap((p) => p.dangling);
  const newUnknown = a.unknownAccounts.filter((x) => !b.unknownAccounts.includes(x));
  return { dangling: [...new Set(dangling)], unknownAccounts: newUnknown };
}

function usage(code = 1) {
  // — HELP ASKED FOR GOES TO STDOUT; usage printed as a REFUSAL goes to stderr.
  // This wrote to stderr either way, and it was the only verb of nine that did: `clearotron grant
  // --help | less` showed nothing, and neither did any redirect a reader would try. The exit code
  // already carries the distinction, so it decides the stream.
  const out = code === 0 ? console.log : console.error;
  out(`clearotron grant — edit the guest list the portal reads

  grant list
  grant add <email> --tenant <name> --accounts <key,key|*>
  grant remove <email> [--tenant <name>]
  grant remove-tenant <name>

The file (${FILE || "CLEAROTRON_ACCESS_FILE unset"}) stays authoritative and hand-editable; this is an
editor for it. The portal re-reads it per request, so a change lands with no restart.`);
  process.exit(code);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

if (!cmd || cmd === "--help" || cmd === "-h") usage(0);

const grants = readGrants();
const tenants = grants.tenants;

if (cmd === "list") {
  const known = await knownAccounts();
  const v = accessView({ grants, knownAccounts: known ?? [], grantsFile: null });
  if (!v.people.length) out("The guest list is empty. Staff arrive by domain and are not listed here.");
  for (const p of v.people) {
    const reach = p.wildcard ? `* (every account ${p.tenant} holds: ${p.accounts.join(", ") || "none"})` : p.accounts.join(", ") || "nothing";
    out(`${p.email}\n    tenant   ${p.tenant}\n    reaches  ${reach}${p.dangling.length ? `\n    ⚠ DANGLING ${p.dangling.join(", ")} — ${p.tenant} does not hold ${p.dangling.length > 1 ? "these" : "this"}, so it resolves to nothing` : ""}`);
  }
  if (known === null) out("\nNote: customer bundles could not be read, so accounts were NOT checked against them.");
  else if (v.unknownAccounts.length) out(`\n⚠ Named in grants but matching no customer bundle: ${v.unknownAccounts.join(", ")}`);
  process.exit(0);
}

if (cmd === "add") {
  const email = String(argv[1] ?? "").trim().toLowerCase();
  const tenant = flag("tenant");
  const accountsArg = flag("accounts");
  if (!email || !tenant || !accountsArg) usage();

  // THE EMAIL RULE IS makePrincipal's, asked rather than restated. A multi-@ identity is refused there
  // outright, so a grant for one could never resolve — writing it would be writing a line that cannot
  // ever match, which is the silent-uselessness this command exists to prevent.
  if (!makePrincipal({ email, grants: { tenants: {} }, staffDomains: [] }) && email.indexOf("@") !== email.lastIndexOf("@"))
    die(`"${email}" carries more than one @. The portal refuses those identities outright, so this grant could never match anyone.`);
  if (!email.includes("@")) die(`"${email}" is not an email address.`);

  // ── A REFUSAL THAT NAMES THE ROUTE ( — F38) ─────────────────────────────
  //
  // This used to end at "it does not create one", and NOTHING IN THE CLI CREATES ONE: `brandowner`
  // never writes a tenant, this command refuses to, and `connect` sends the reader here. On a fresh
  // install the file is {"tenants":{}}, so the documented first run was connect → "run grant" → grant →
  // "a tenant must already exist" → nothing. A dead end reached by following instructions.
  //
  // The route exists — it is the file — and `grant --help` documents it. What was missing is that the
  // refusal which STOPS you did not carry it, so the shape of the object is printed here, against this
  // install's own path, rather than left to a reader to find in another command's help.
  if (!tenants[tenant]) die(`No tenant "${tenant}". It must already exist with its accounts — this command grants access to a tenant, it does not create one.
Tenants: ${Object.keys(tenants).join(", ") || "(none)"}

No command creates one yet. Add it to ${FILE} — the shape is:
    { "tenants": { "${tenant}": { "accounts": ["<brand-owner-key>"], "users": {} } } }
"accounts" holds the brand-owner keys this tenant may act for; \`clearotron brandowner list\` names the ones this install has. Then run this command again.`);

  const before = JSON.parse(JSON.stringify(grants));
  const value = accountsArg === "*" ? "*" : accountsArg.split(",").map((s) => s.trim()).filter(Boolean);
  if (value !== "*" && !value.length) die("--accounts named nothing. Use a comma-separated list of account keys, or * for every account the tenant holds.");
  tenants[tenant].users = { ...(tenants[tenant].users ?? {}), [email]: value };

  const known = await knownAccounts();
  const faults = faultsIntroduced(before, grants, known, email);
  if (faults.dangling.length)
    die(`Refusing: tenant "${tenant}" does not hold ${faults.dangling.join(", ")}.\nThat grant would resolve to nothing and fail as a silent 404 for ${email}.\nAccounts "${tenant}" holds: ${(tenants[tenant].accounts ?? []).join(", ") || "(none)"}`);
  if (faults.unknownAccounts.length)
    die(`Refusing: ${faults.unknownAccounts.join(", ")} ${faults.unknownAccounts.length > 1 ? "match" : "matches"} no customer bundle.\nThe grant would be written and reach nothing. Check the account key, or add the bundle first.`);
  if (known === null) console.error("Note: customer bundles could not be read, so the account keys were NOT checked against them.");

  atomicWrite(FILE, JSON.stringify(grants, null, 2) + "\n");
  out(`${email} → ${tenant} (${value === "*" ? "every account the tenant holds" : value.join(", ")})\nWritten to ${basename(FILE)}. The portal re-reads per request — no restart.`);
  process.exit(0);
}

if (cmd === "remove") {
  const email = String(argv[1] ?? "").trim().toLowerCase();
  const only = flag("tenant");
  if (!email) usage();
  let removed = 0;
  for (const [name, t] of Object.entries(tenants)) {
    if (only && name !== only) continue;
    if (t?.users && email in t.users) { delete t.users[email]; removed++; }
    // AN EMPTY `users` MAP IS NOT A DELETED TENANT, and this writes the former deliberately: the tenant
    // still exists and still holds its accounts, it simply has nobody on its guest list. Deleting the
    // tenant here would destroy configuration the operator never asked to remove, and it round-trips —
    // `remove-tenant` is the other verb, and it is explicit.
  }
  if (!removed) die(`${email} is not on the guest list${only ? ` for "${only}"` : ""}. Nothing written.`);
  atomicWrite(FILE, JSON.stringify(grants, null, 2) + "\n");
  out(`Removed ${email} from ${removed} tenant(s). Written to ${basename(FILE)}.`);
  process.exit(0);
}

if (cmd === "remove-tenant") {
  const name = String(argv[1] ?? "").trim();
  if (!name) usage();
  if (!tenants[name]) die(`No tenant "${name}". Nothing written.`);
  const people = Object.keys(tenants[name].users ?? {}).length;
  delete tenants[name];
  atomicWrite(FILE, JSON.stringify(grants, null, 2) + "\n");
  out(`Removed tenant "${name}"${people ? ` and the ${people} grant(s) it held` : ""}. Written to ${basename(FILE)}.`);
  process.exit(0);
}

usage();
