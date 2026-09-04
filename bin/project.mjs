#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// project.mjs — add an engagement under a brand owner.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
//
// A project is the overlay beneath a brand owner: the classes, jurisdictions and platforms one
// engagement runs under, where the owner's own bundle carries the rest. `driver/profiles/projects/`
// shipped with working examples in it and no documented way to add one, so the only route was writing
// JSON into a directory that holds real client material and hoping the loader agreed.
//
// `brandowner add` did the same job one level up. This is deliberately its mirror:
// same store resolution, same refusal shape, same receipt.
//
// ── A PROJECT IS A SPARSE OVERLAY, AND THE FIELD SET IS THE CONTRACT ──────────────────────────────
//
// PROJECT_KEYS is what an engagement may re-decide. CUSTOMER_ONLY_KEYS is what it may not, and the list
// is reasoned rather than arbitrary: a project must not re-point the framework its matters are rated
// under, must not widen what the account may trigger, and must not mark a real customer's run as demo
// data. Naming a customer-only key here is refused BY THAT NAME, because the generic "unknown key"
// message would send the reader looking for a typo in a key they spelled correctly.
//
// ── A BAD PROJECT STOPS EVERY PROJECT, NOT JUST ITS OWN ───────────────────────────────────────────
//
// `loadProjects` throws from inside its loop over customer directories. A project directory naming a
// brand owner that is not in the roster, an unparseable file, or one that fails the shape check does
// not fail that project — it aborts the whole tree, so every OTHER engagement stops resolving too, at
// the next process start, with the operator's own file as the cause.
//
// So the candidate is validated through the loader's own public validator BEFORE anything is written,
// and the customer is confirmed present in the roster first. Same reasoning as the domain-collision
// check one level up, same reason: a refusal is cheap and a broken tree is not.

// FIRST IMPORT, and enforced (driver/test/env-local.test.mjs): it loads `<repo>/.env` and applies the
// name aliases as a side effect, so every module imported after it sees a settled environment.
import "../shared/env-local.mjs";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import {
  assertProfileKey, profileStoreResolution, loadProfiles, loadProjects,
  validateProfileEdit, PROJECT_KEYS, CUSTOMER_ONLY_KEYS, CONTEXT_PACK_FILE,
} from "../driver/profiles.mjs";
import { defaultWriteProject } from "../driver/profile-service.mjs";
import { makeCommittableAudit, commitWithAuditRow, makeStoreCommit, resolveStoreRepoRoot } from "../shared/store-in-repo.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
// The same question `brandowner add` asks of the same variable — one answer, not two.
import { Refusal, storeForAdd } from "../shared/onboarding-store.mjs";

// ── argument parsing ───────────────────────────────────────────────────────────────────────────────
// Long flags only, and an unknown one REFUSES. A permissive parser on a command that writes into the
// customers directory turns a typo'd flag into a silently missing field.
const FLAGS = ["--name", "--platforms", "--classes", "--jurisdictions", "--density", "--product", "--context"];
const list = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);

export function parseArgs(argv) {
  const out = { customer: null, project: null, name: null, platforms: null, classes: null,
    jurisdictions: null, density: null, product: null, context: null, dryRun: false };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a.startsWith("--")) {
      if (!FLAGS.includes(a)) throw new Refusal(`no such option "${a}". One of: ${FLAGS.join(", ")}, --dry-run`);
      const v = rest.shift();
      if (v === undefined || v.startsWith("--")) throw new Refusal(`${a} needs a value`);
      if (a === "--name") out.name = v;
      else if (a === "--platforms") out.platforms = list(v.toLowerCase());
      else if (a === "--classes") out.classes = list(v);
      else if (a === "--jurisdictions") out.jurisdictions = list(v.toUpperCase());
      else if (a === "--density") out.density = v;
      else if (a === "--product") out.product = v;
      else if (a === "--context") out.context = v;
      continue;
    }
    if (out.customer === null) { out.customer = a; continue; }
    if (out.project === null) { out.project = a; continue; }
    throw new Refusal(`unexpected argument "${a}" — this command takes a brand owner key and a project key`);
  }
  return out;
}

/** The overlay this writes. Sparse by construction: a key the operator did not name is a key the
 *  project inherits from its brand owner, which is the whole point of an overlay. */
export function buildOverlay(args) {
  const o = {};
  if (args.name) o.projectName = args.name;
  if (args.platforms?.length) o.platforms = args.platforms;
  if (args.classes?.length) o.defaultClasses = args.classes;
  if (args.jurisdictions?.length) o.defaultJurisdictions = args.jurisdictions;
  if (args.density) o.marketplaceDensity = args.density;
  if (args.product) o.defaultProduct = args.product;
  return o;
}

/**
 * Refuse a customer-only key BY NAME, before the generic deny-unknown gate sees it.
 *
 * `validateProfileEdit` would reject these too, as unknown keys for a sparse overlay — and that message
 * sends the reader hunting for a typo in a key they spelled correctly. The distinction is worth a
 * sentence: these keys are not misspelled, they are not overlayable, and the reason differs per key.
 */
export function assertOverlayable(overlay) {
  // projectName and archived are overlay META, lifted out by the loader before the field set is read —
  // they are not in PROJECT_KEYS and must not be checked against it.
  const META = new Set(["projectName", "archived"]);
  for (const k of Object.keys(overlay)) {
    if (META.has(k)) continue;
    if (CUSTOMER_ONLY_KEYS.includes(k))
      throw new Refusal(
        `"${k}" belongs to the brand owner and cannot be set on one of its projects. An engagement may `
        + `re-decide how it searches, never who it is or what rates its matters. Settable here: `
        + `${PROJECT_KEYS.join(", ")}.`);
    if (!PROJECT_KEYS.includes(k))
      throw new Refusal(`"${k}" is not a project field. Settable here: ${PROJECT_KEYS.join(", ")}.`);
  }
  return overlay;
}

/**
 * Judge the candidate the way the deployment will read it — as one member of a tree that fails whole.
 *
 * The customer check is first and separate because its failure mode is the loud one: a project under a
 * brand owner that is not in the roster stops EVERY project resolving, not just this one.
 */
export function assertTreeAccepts({ store, customer, project, overlay, contextPack, loadProfiles: loadP, loadProjects: loadPr }) {
  const roster = loadP({ dir: store, force: true });
  if (!roster.has(customer))
    throw new Refusal(
      `no brand owner "${customer}" resolves from ${store}. A project must live under one that does — a `
      + `projects/ directory naming an owner the roster does not have stops the WHOLE project tree `
      + `loading, not just this project. Add the brand owner first: clearotron brandowner add ${customer}`);

  const existing = loadPr({ dir: store, profiles: roster, force: true });
  if (existing.has(`${customer}/${project}`))
    throw new Refusal(
      `a project "${customer}/${project}" already exists in ${store}. This command creates; it does not `
      + `overwrite. Edit it in the portal, or remove the file deliberately first.`);

  // THE LOADER'S OWN VALIDATOR, sparse — not a second opinion about what a good overlay is. Whatever
  // the tree would refuse at load must be refused here, in the same words, before anything is written.
  const v = validateProfileEdit(`projects/${customer}/${project}`, overlay, contextPack ?? "", { sparse: true });
  if (!v.ok)
    throw new Refusal(`the project overlay is not valid, so nothing was written:\n  ${v.errors.join("\n  ")}`);
}

const USAGE = `
  clearotron project add <brand-owner> <project> [options]

    --name          a display name for the engagement (defaults to its key)
    --platforms     comma-separated marketplaces this project searches
    --classes       comma-separated Nice classes
    --jurisdictions comma-separated jurisdictions
    --density       sparse | dense — how much marketplace output one batch carries
    --product       the search this project runs by default
    --context       a file whose contents become this project's context pack
    --dry-run       say exactly what would be written, and write nothing

  A project INHERITS everything it does not set from its brand owner. Anything about who the
  client is, or what rates their matters, belongs on the brand owner and is refused here.

  Exit codes: 0 written and recorded · 1 refused, nothing written · 2 usage
              3 written but NOT recorded — the project is written and the store has no record of it
`;

export async function add(argv, {
  resolution = profileStoreResolution(),
  loadProfiles: loadP = loadProfiles,
  loadProjects: loadPr = loadProjects,
  out = console.log,
} = {}) {
  const args = parseArgs(argv);
  if (!args.customer || !args.project) throw new Refusal(`this command needs a brand owner key and a project key.${USAGE}`);
  assertProfileKey(args.customer);
  assertProfileKey(args.project);

  const store = storeForAdd(resolution);

  let contextPack = null;
  if (args.context) {
    const packFile = resolvePath(args.context);
    if (!existsSync(packFile)) throw new Refusal(`--context names ${args.context}, and there is no such file (looked at ${packFile}).`);
    contextPack = readFileSync(packFile, "utf8");
  }

  const overlay = assertOverlayable(buildOverlay(args));
  if (!Object.keys(overlay).length)
    throw new Refusal(
      `a project that sets nothing is the same as no project — it would inherit every value from `
      + `${args.customer} and change nothing about how the engagement searches. Set at least one of: `
      + `${PROJECT_KEYS.join(", ")}.`);

  assertTreeAccepts({ store, customer: args.customer, project: args.project, overlay, contextPack, loadProfiles: loadP, loadProjects: loadPr });

  const target = join(store, "projects", args.customer, `${args.project}.json`);
  const inherits = PROJECT_KEYS.filter((k) => !(k in overlay));
  const inheritLine = `inherits from ${args.customer}: ${inherits.join(", ") || "nothing — this project sets every overlayable field"}`;

  if (args.dryRun) {
    out(`would create ${target}`);
    if (contextPack) out(`would create ${join(store, "projects", args.customer, CONTEXT_PACK_FILE(args.project))}`);
    out(inheritLine);
    out("nothing was written (--dry-run)");
    return { written: false, store, overlay };
  }

  const { files } = defaultWriteProject({
    profileDir: store, customer: args.customer, project: args.project, overlay, contextPack,
  });

  // The receipt, through the same helper the save paths use, so the store's git log reads as one trail.
  // `.root` IS THE PATH. The resolver returns { root, from, tried }; the whole object here reaches
  // git as the literal `[object Object]`, which killed the record half of every add on every store
  // and blamed the store for it. The helpers now refuse a non-path at the boundary, so this can no
  // longer fail quietly — but the call still has to ask for the field it wants.
  const repoRoot = resolveStoreRepoRoot({ names: ["CLEAROTRON_CUSTOMERS_DIR"], fallback: store }).root;
  const audit = makeCommittableAudit({ auditPath: join(store, "audit.jsonl"), repoRoot });
  const gitCommit = makeStoreCommit({ repoRoot, what: "customers" });
  let by = "unknown";
  try { by = userInfo().username || "unknown"; } catch { /* no passwd entry — the row still gets written */ }
  const { commit, commitError } = commitWithAuditRow({
    audit, gitCommit, files, by,
    message: `project ${args.customer}/${args.project} added`,
    row: { event: "project_add", customer: args.customer, project: args.project, by, fields: Object.keys(overlay) },
  });

  for (const f of files) out(`wrote ${f}`);
  out(inheritLine);
  if (commit) out(`recorded ${commit}`);
  if (commitError) out(`WROTE THE PROJECT BUT DID NOT RECORD IT: ${commitError} — the audit line is on disk; fix the store's git state`);
  out(`doctor will now list ${args.customer}/${args.project}`);
  return { written: true, store, overlay, commit, commitError };
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") { console.log(USAGE); process.exit(sub ? 0 : 1); }
  if (sub !== "add") { console.error(`project: no such action "${sub}". One of: add`); process.exit(2); }
  try {
    // WROTE-BUT-DID-NOT-RECORD IS NOT SUCCESS. The write stands — rolling a written bundle back
    // would lose the operator's work over a git fault they can fix — but a scripted onboarding
    // reading exit 0 concludes the store recorded it, and the store did not. Exit 3 says both
    // halves: not 1, which this file already spends on a refusal that wrote nothing, and not 2,
    // which is a usage error. The loud line above names the fault; this makes it machine-readable.
    const result = await add(rest);
    if (result?.commitError) process.exit(3);
  } catch (e) {
    // A REFUSAL IS NOT A CRASH: it names what was wrong and exits 1. Anything else keeps its stack,
    // because an unexpected throw here is a defect and a tidy message would cost the debug.
    if (e instanceof Refusal) { console.error(`project: ${e.message}`); process.exit(1); }
    throw e;
  }
}

if (isEntrypoint(import.meta.url)) main();
