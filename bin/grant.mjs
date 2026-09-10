#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grant.mjs — give someone access, take it away, or see who has it ( item 2).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
//
// The guest list was a JSON file edited by hand. `bin/start.mjs` writes one at install and nothing
// added a second person to it, so for anyone self-hosting the only way to let a colleague in was a text
// editor — and a mistake in that file does not error. `resolvePerson` simply matches nothing, and the
// person signs in to an empty world with nothing in any log to say why.
//
// `npm start` and `npm run setup` exist so that installing is not that. Enrolment is the very next thing
// the same reader does, and it dropped straight back to the editor.
//
// ── ONE OPINION ABOUT VALIDITY, NOT TWO ───────────────────────────────────────────────────────────
//
// The change itself is made by `withPerson` (shared/grants-edit.mjs), the editor the portal's People
// page writes through, so the two writers cannot produce two shapes of one fact — and a company the
// organisation does not hold is refused there, by the same sentence the page would get.
//
// The product also knew the other typo direction: `accessView` (driver/portal-config-view.mjs) reports a
// company that no customer bundle matches. It reported it AFTER the mistake shipped. So this command runs
// `accessView` OVER THE PROPOSED STATE, seen from the top of the tree, and refuses if the change would
// introduce that finding. The screen's report and this refusal are the same code by construction.
//
// The email rule is borrowed the same way: `makePrincipal` refuses a multi-`@` identity outright, so a
// grant for one could never resolve. Rather than restate the rule, this asks `makePrincipal`.
//
// ── A PERSON IS ACCESS PLUS TWO PERMISSIONS ───────────────────────────────────────────────────────
//
// Access is where on the tree a person may look: a whole organisation (`--accounts '*'`) or companies
// it holds. What they may DO is two switches under `people`: `--run` (start and stop clearances) and
// `--manage` (add people and companies, change settings). Neither flag is the view-only person, and the
// output says so in a sentence — someone who can read a company's reports and start nothing is a real
// posture, not a mistake, but it must never be the surprise.
//
// Access to everything is not granted here. The person who installs holds it (`clearotron start`
// writes that entry), and it is CARRIED through every change this command makes to their entry, never
// dropped: `withPerson` replaces the entry it writes, and a person who held everything and was then
// given Run here would otherwise lose the whole install with nothing said.
//
// ── THE FILE STAYS AUTHORITATIVE ──────────────────────────────────────────────────────────────────
//
// This is an editor for that file and never a second store. It stays hand-editable, and anything this
// command writes a human can read and change back.
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
// the first direct CLEAROTRON_* product read in the tree, which the arm catches, because the
// declaration ratchet is keyed on the CLEAROTRON_* prefix and goes blind the moment that premise stops
// holding. One reader, one spelling.
import "../shared/env-local.mjs";
import { readFileSync, existsSync } from "node:fs";
import { assertGrantsShape } from "../shared/scope.mjs";   // — one shape check, not a second opinion
import { withPerson, withOrganisation, withCompany } from "../shared/grants-edit.mjs";   // — the People page's own editors
import { basename } from "node:path";
import { atomicWrite } from "../driver/progress.mjs";
import { accessView } from "../driver/portal-config-view.mjs";
import { makePrincipal } from "../driver/portal-access.mjs";
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half
import { defaultGrantsPath } from "./start.mjs";       // — one owner for the roster's path

// — found in review. This read the variable and nothing else, so it refused with
// "Set CLEAROTRON_ACCESS_FILE" — a name NOTHING writes. `start` injects it into the environment of the
// services it supervises and never persists it, so the door found the roster and this command, run in
// the operator's own shell, could not. Enrolling a client had no working path at all.
//
// The default comes from installPaths' own owner rather than being recomputed here: a second opinion
// about the same path drifts the first time anyone moves the base.
const FILE = defaultGrantsPath();

const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
const out = (msg) => console.log(msg);

/** The grants file, or a stated refusal. NEVER an invented empty one — a typo in the path would then
 *  silently create a second guest list nobody reads. */
function readGrants() {
  if (!existsSync(FILE)) die(`No guest list at ${FILE}. \`clearotron start\` writes one the first time it runs — start the product once, or set CLEAROTRON_ACCESS_FILE if your roster lives elsewhere.`);
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
 * Every company a customer bundle actually holds, as `{ key: name }`, or NULL when that cannot be
 * established.
 *
 * EMPTY IS NULL HERE, DELIBERATELY. `accessView` guards its unknown-company check with `known.size` — so
 * an empty map means the check DOES NOT RUN and reports nothing, which is indistinguishable from running
 * and finding nothing. Collapsing empty into null makes the command say "not checked" instead of implying
 * "checked and clean": not probed is not passed.
 */
async function knownCompanies() {
  try {
    const { loadProfiles } = await import("../driver/profiles.mjs");
    const named = [...loadProfiles({ force: true }).entries()]
      .map(([key, p]) => [key, typeof p?.name === "string" && p.name.trim() ? p.name.trim() : key]);
    return named.length ? Object.fromEntries(named) : null;
  } catch { return null; }
}

/**
 * Would this proposed state be a good one? Asked of `accessView`, so the answer is the screen's answer.
 *
 * SEEN FROM THE TOP OF THE TREE. The screen hides what its viewer cannot see; this command is run by
 * whoever administers the box, and a finding hidden from it would be a check that did not run.
 *
 * Returns the findings ATTRIBUTABLE TO THIS CHANGE only. A guest list that already contains someone
 * else's dangling grant is not this operator's problem to fix before they can add a colleague, and
 * refusing on it would make the command unusable on exactly the messy file it exists to tidy.
 */
function faultsIntroduced(before, after, companies, email) {
  const view = (g) => accessView({ grants: g, viewer: { everything: true }, companies: companies ?? {} });
  const b = view(before), a = view(after);
  const dangling = a.people.filter((p) => p.email === email).flatMap((p) => p.dangling);
  const newUnknown = a.unknownAccounts.filter((x) => !b.unknownAccounts.includes(x));
  return { dangling: [...new Set(dangling)], unknownAccounts: newUnknown };
}

/** What a person may do, in a sentence — the view-only case said as plainly as the others. */
function mayLine(email, entry) {
  const run = entry?.run === true, manage = entry?.manage === true;
  const whole = entry?.everything === true ? ", with access to everything on this install" : "";
  if (!run && !manage)
    return `${email} can view what this gives them and do nothing else: no clearance can be started, and nobody added${whole}. Add --run, --manage or both to change that.`;
  return `${email} may ${[run && "run clearances", manage && "manage (add people and companies, change settings)"].filter(Boolean).join(" and ")}${whole}.`;
}

function usage(code = 1) {
  // — HELP ASKED FOR GOES TO STDOUT; usage printed as a REFUSAL goes to stderr.
  // This wrote to stderr either way, and it was the only verb of nine that did: `clearotron grant
  // --help | less` showed nothing, and neither did any redirect a reader would try. The exit code
  // already carries the distinction, so it decides the stream.
  const out = code === 0 ? console.log : console.error;
  out(`clearotron grant — edit who may use this install

  grant list
  grant add <email> --tenant <organisation> --accounts <key,key|*> [--run] [--manage]
  grant remove <email> [--tenant <organisation>]
  grant remove-tenant <organisation>

--accounts * is the whole organisation, including companies filed under it later. --run lets the
person start and stop clearances; --manage lets them add people and companies and change settings.
With neither they can view what they have access to and nothing else.

The file (${FILE || "CLEAROTRON_ACCESS_FILE unset"}) stays authoritative and hand-editable; this is an
editor for it. The portal re-reads it per request, so a change lands with no restart.`);
  process.exit(code);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

if (!cmd || cmd === "--help" || cmd === "-h") usage(0);

let grants = readGrants();

if (cmd === "list") {
  const companies = await knownCompanies();
  const v = accessView({ grants, viewer: { everything: true }, companies: companies ?? {} });
  if (!v.people.length) out("Nobody has access yet. `clearotron start` gives the person who installs access to everything; `grant add` gives anyone else theirs.");
  for (const p of v.people) {
    const reach = p.access.map((pt) => pt.kind === "everything" ? "everything on this install"
      : pt.kind === "organisation"
        ? `the whole of ${pt.name}${pt.name !== pt.key ? ` (${pt.key})` : ""} — every company it holds: ${(grants.tenants[pt.key]?.accounts ?? []).filter((a) => a !== "generic").join(", ") || "none yet"}`
        : `${pt.key}, in ${pt.org}`).join("; ") || "nothing";
    const may = [p.permissions.run && "run clearances", p.permissions.manage && "manage"].filter(Boolean).join(" and ") || "view only";
    out(`${p.email}\n    access   ${reach}\n    may      ${may}${p.dangling.length ? `\n    ⚠ DANGLING ${p.dangling.join(", ")} — the organisation that grants ${p.dangling.length > 1 ? "these does not hold them" : "this does not hold it"}, so it resolves to nothing` : ""}`);
  }
  if (companies === null) out("\nNote: customer bundles could not be read, so companies were NOT checked against them.");
  else if (v.unknownAccounts.length) out(`\n⚠ Named in grants but matching no customer bundle: ${v.unknownAccounts.join(", ")}`);
  process.exit(0);
}

if (cmd === "add") {
  const email = String(argv[1] ?? "").trim().toLowerCase();
  const tenant = flag("tenant");
  const accountsArg = flag("accounts");
  const run = argv.includes("--run");
  const manage = argv.includes("--manage");
  if (!email || !tenant || !accountsArg) usage();

  // THE EMAIL RULE IS makePrincipal's, asked rather than restated. Asked over a file in which this address
  // would see everything, so the only way it resolves to nobody is that the resolver refused the address
  // itself — which it does, outright, for a multi-@ identity. Writing that grant would be writing a line
  // that cannot ever match, which is the silent-uselessness this command exists to prevent.
  if (!makePrincipal({ email, grants: { tenants: {}, people: { [email]: { everything: true } } } })) {
    if (email.indexOf("@") !== email.lastIndexOf("@"))
      die(`"${email}" carries more than one @. The portal refuses those identities outright, so this grant could never match anyone.`);
    die(`"${email}" is not an email address.`);
  }
  const list = accountsArg === "*" ? "*" : accountsArg.split(",").map((s) => s.trim()).filter(Boolean);
  if (list !== "*" && !list.length) die("--accounts named nothing. Use a comma-separated list of account keys, or * for the whole organisation.");

  // ── A REFUSAL THAT NAMES THE ROUTE ( — F38) ─────────────────────────────
  //
  // This used to end at "it does not create one", and NOTHING IN THE CLI CREATES ONE: `brandowner`
  // never writes a tenant, this command refused to, and `connect` sends the reader here. On a fresh
  // install the file named no tenant, so the documented first run was connect → "run grant" → grant →
  // "a tenant must already exist" → nothing. A dead end reached by following instructions.
  //
  // THE FIRST TENANT IS CREATED HERE — ONLY WHEN THE ROSTER HOLDS NONE, and that limit is the point.
  // Creating on any unknown name would mean a typo mints an organisation nobody meant, silently, in the
  // file the door reads — so once there is a roster to typo against, the refusal stays and lists what
  // exists.
  //
  // THROUGH THE SHARED EDITORS. `withOrganisation` derives the key from the name, so the key is taken
  // from what it returns rather than assumed equal to what was typed. SEEDED FROM --accounts, not
  // created empty: for an organisation that does not exist yet, the companies this grant names ARE the
  // companies it holds. `*` names none, so the organisation starts holding no company and the person gets
  // the whole of it — a legitimate state, and the only one: an organisation's list is never "*".
  let key = tenant;
  if (!grants.tenants[tenant] && Object.keys(grants.tenants).length === 0) {
    try {
      const made = withOrganisation(grants, { name: tenant });
      key = made.key;
      grants = made.grants;
      for (const account of list === "*" ? [] : list) grants = withCompany(grants, { tenant: key, account });
    } catch (e) { die(`Refusing: ${e.message}. Nothing written.`); }
    out(`Creating the first tenant "${key}" in ${FILE}, holding: ${list === "*" ? "no company yet — * gives the person the whole organisation, including companies filed under it later" : list.join(", ")}`);
  }
  if (!grants.tenants[key]) die(`No tenant "${tenant}". It must already exist with its companies — this command grants access to a tenant, and it creates one only when there are none at all, so that a typo cannot mint a tenant nobody meant.
Tenants: ${Object.keys(grants.tenants).join(", ")}

To add another, put it in ${FILE} — the shape is:
    { "tenants": { "${tenant}": { "name": "<its name>", "accounts": ["<company-key>"], "users": {} } } }
"accounts" holds the company keys this tenant holds, and a company belongs to one tenant only; \`clearotron doctor\` names the ones this install has, under "brand owner(s) resolve here". Then run this command again.`);

  const before = structuredClone(grants);
  const held = (Array.isArray(grants.tenants[key].accounts) ? grants.tenants[key].accounts : []).join(", ") || "(none)";
  const points = list === "*" ? [{ tenant: key }] : list.map((account) => ({ tenant: key, account }));
  const peopleKey = Object.keys(grants.people ?? {}).find((k) => k.toLowerCase() === email);
  const had = peopleKey === undefined ? null : grants.people[peopleKey];
  // THE SWITCHES ARE WRITTEN ONLY WHEN ONE IS ASKED FOR. A person with no entry is already view-only, so
  // writing `{ run: false, manage: false }` for them adds a line that says nothing; and a person who
  // already holds Run must not lose it because a company was added without repeating the flag.
  const setSwitches = run || manage;
  let after;
  try {
    after = withPerson(grants, { email, points, switches: { run, manage, everything: had?.everything === true }, setSwitches });
  } catch (e) {
    if (/does not hold/.test(e.message))
      die(`Refusing: ${e.message}.\nThat grant would resolve to nothing and fail as a silent 404 for ${email}.\nAccounts "${key}" holds: ${held}. Nothing written.`);
    die(`Refusing: ${e.message}. Nothing written.`);
  }

  const companies = await knownCompanies();
  const faults = faultsIntroduced(before, after, companies, email);
  if (faults.dangling.length)
    die(`Refusing: tenant "${key}" does not hold ${faults.dangling.join(", ")}.\nThat grant would resolve to nothing and fail as a silent 404 for ${email}.\nAccounts "${key}" holds: ${held}`);
  if (faults.unknownAccounts.length)
    die(`Refusing: ${faults.unknownAccounts.join(", ")} ${faults.unknownAccounts.length > 1 ? "match" : "matches"} no customer bundle.\nThe grant would be written and reach nothing. Check the account key, or add the bundle first.`);
  if (companies === null) console.error("Note: customer bundles could not be read, so the account keys were NOT checked against them.");

  atomicWrite(FILE, JSON.stringify(after, null, 2) + "\n");
  out(`${email} → ${key} (${list === "*" ? "the whole organisation" : list.join(", ")})`);
  if (setSwitches) out(mayLine(email, after.people?.[email]));
  else if (had) out(`${mayLine(email, had)} Their permissions are unchanged; pass --run and --manage to set them.`);
  else out(mayLine(email, null));
  out(`Written to ${basename(FILE)}. The portal re-reads per request — no restart.`);
  process.exit(0);
}

if (cmd === "remove") {
  const email = String(argv[1] ?? "").trim().toLowerCase();
  const only = flag("tenant");
  if (!email) usage();
  let removed = 0;
  for (const [name, t] of Object.entries(grants.tenants)) {
    if (only && name !== only) continue;
    if (t?.users && email in t.users) { delete t.users[email]; removed++; }
    // AN EMPTY `users` MAP IS NOT A DELETED TENANT, and this writes the former deliberately: the tenant
    // still exists and still holds its accounts, it simply has nobody on its guest list. Deleting the
    // tenant here would destroy configuration the operator never asked to remove, and it round-trips —
    // `remove-tenant` is the other verb, and it is explicit.
  }
  // AND THE PERSON'S OWN ENTRY, when they are removed from everywhere. Their permissions and their access
  // to everything live under `people`, not in any tenant, so a removal that left that entry would leave a
  // person who sees everything still seeing everything. Removed from one tenant, they may still hold
  // access elsewhere, and their entry stays.
  const peopleKey = only ? undefined : Object.keys(grants.people ?? {}).find((k) => k.toLowerCase() === email);
  if (peopleKey !== undefined) delete grants.people[peopleKey];
  if (!removed && peopleKey === undefined) die(`${email} is not on the guest list${only ? ` for "${only}"` : ""}. Nothing written.`);
  atomicWrite(FILE, JSON.stringify(grants, null, 2) + "\n");
  out(`Removed ${email} from ${removed} tenant(s)${peopleKey !== undefined ? ", and their permissions under people" : ""}. Written to ${basename(FILE)}.`);
  const kept = Object.entries(grants.people ?? {}).find(([k]) => k.toLowerCase() === email)?.[1];
  if (kept?.everything === true)
    out(`${email} still has access to everything through their entry under people. \`grant remove ${email}\` without --tenant takes that away too.`);
  process.exit(0);
}

if (cmd === "remove-tenant") {
  const name = String(argv[1] ?? "").trim();
  if (!name) usage();
  if (!grants.tenants[name]) die(`No tenant "${name}". Nothing written.`);
  const people = Object.keys(grants.tenants[name].users ?? {}).length;
  delete grants.tenants[name];
  atomicWrite(FILE, JSON.stringify(grants, null, 2) + "\n");
  out(`Removed tenant "${name}"${people ? ` and the ${people} grant(s) it held` : ""}. Written to ${basename(FILE)}.`);
  process.exit(0);
}

usage();
