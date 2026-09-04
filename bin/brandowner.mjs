#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// brandowner.mjs — onboard a brand owner from the command line, framework and all.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
//
// Owner, 2026-08-26: "how do you ADD A NEW BRAND OWNER [...] and give it the framework etc. You
// cannot do that in the UI." He was right. The two documented ways to create one were a git
// pull request and a form on the legacy staff config page; there was no verb, so onboarding a client
// meant hand-editing JSON in a directory that holds real client material.
//
// ── THE FRAMEWORK IS SET HERE, AND THAT NEEDED A NEW DOOR ─────────────────────────────────────────
//
// Owner ruling, 2026-08-29: the risk framework stays MANDATORY at onboarding, with a DEFAULT BACKUP so
// onboarding is never blocked. This sets `frameworkPath` ALWAYS — the client's own when supplied, the
// Generic default otherwise — and says out loud which one it used.
//
// THE SAVE PATH CANNOT DO THAT, and finding out why is the whole reason this file writes its own.
// `preserveCodeOwned` (driver/profile-service.mjs) takes the on-disk value of every code-owned field
// when one exists and DELETES the field when one does not. A brand owner being created has nothing on
// disk, so a create routed through the service deletes `frameworkPath` every single time — and does it
// silently, which is how it would have passed its own tests while writing no framework at all.
//
// That preserve is RIGHT and is untouched here. It exists because three UI saves in July 2026 silently
// stripped the field from two real customers and flipped them to the house framework. Its rule is that
// a CLIENT BODY may not introduce a framework selection. An operator running a command on the box is
// not a client body, so this is a second door with the same validation rather than a hole in that one.
//
// ── ONE OPINION ABOUT VALIDITY, NOT TWO ───────────────────────────────────────────────────────────
//
// Borrowed from bin/grant.mjs, which had this problem first. Every refusal below asks code that already
// ships:
//
//   which store am I writing to    profileStoreResolution() — including its own word for the two ways
//                                  a store can be absent
//   is this key well formed        assertProfileKey()
//   is this profile valid          the roster loader, over the proposed state
//   is this framework real         loadFrameworkManifest(), the same read the rating stage makes
//
// There is no second definition of "a good brand owner" here to keep in step with the first.
//
// ── A BAD ADD MUST FAIL ONE CUSTOMER, NEVER THE DEPLOYMENT ────────────────────────────────────────
//
// The roster loader throws for the WHOLE roster when two brand owners claim the same domain. So an add
// with a colliding domain does not fail the new customer — it stops the deployment resolving ANY of
// them, at the next process start, with the operator's own file as the cause. The candidate is
// therefore composed into the roster IN MEMORY and that whole proposed roster is validated before
// anything is written.

// FIRST IMPORT, and enforced (driver/test/env-local.test.mjs): it loads `<repo>/.env` and applies the
// name aliases as a side effect, so every module imported after it sees a settled environment.
import "../shared/env-local.mjs";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import { assertProfileKey, profileStoreResolution, CONTEXT_PACK_FILE, validateProfileEdit } from "../driver/profiles.mjs";
import { DEFAULT_FRAMEWORK, loadFrameworkManifest } from "../driver/framework.mjs";
import { defaultWriteProfile } from "../driver/profile-service.mjs";
import { config } from "../driver/driver.config.mjs";
import { makeCommittableAudit, commitWithAuditRow, makeStoreCommit, resolveStoreRepoRoot } from "../shared/store-in-repo.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
// Shared with `project add`, which asks an identical question of the same variable — see the
// module header for why this is not two copies.
import { Refusal, storeForAdd } from "../shared/onboarding-store.mjs";

// ── the framework, which is the point of the setup ─────────────────────────────────────────────────
/**
 * Resolve the framework this brand owner will be rated under, as the ruling words it: the client's own
 * when supplied, the Generic default otherwise, and always stated.
 *
 * ABSENT AND BROKEN ARE NOT THE SAME EVENT and the ruling separates them deliberately. Absent means the
 * client has not given us their framework yet — onboarding proceeds under the Generic default, named.
 * Broken means someone TRIED to select one and it does not resolve, and falling back there would rate a
 * client's matters under a framework nobody chose while the output said everything was fine.
 *
 * The profile validator checks the SHAPE of this string only (`skills/prelim-search/<file>.md`, no
 * escape) and never whether the file is there — so a shape-valid path to a document that does not exist
 * validates cleanly and fails at rating time, which is the wrong place to find out.
 */
export function resolveFramework(requested, {
  resolveSkill = (rel) => config.resolveSkillPath(rel),
  loadManifest = loadFrameworkManifest,
} = {}) {
  if (requested == null || String(requested).trim() === "")
    return { path: DEFAULT_FRAMEWORK, source: "default" };

  const path = String(requested).trim();
  // Shape first, and by the profile validator's own rule rather than a second copy of it: a path that
  // would be refused at load must be refused here, in the same words, before anything is written.
  if (!/^skills\/prelim-search\/[^/]+\.md$/.test(path) || path.includes(".."))
    throw new Refusal(
      `--framework must name a document of the form "skills/prelim-search/<file>.md" (got ${JSON.stringify(path)}). `
      + `A profile selects a SHIPPED framework, never an arbitrary path.`);

  // RESOLVED THE WAY THE RATING STAGE RESOLVES IT, never by joining the repo root. `skills/...` paths
  // are relative to the DRIVER's skills directory, and a deployment may serve them from a doctrine
  // overlay (CLEAROTRON_INSTRUCTIONS_DIR) instead. Joining the repo root would have looked in a
  // directory that does not exist, refused every valid framework on every install, and — worse in the
  // other direction — been blind to the overlay a deployment actually reads.
  const deck = resolveSkill(path);
  if (!existsSync(deck))
    throw new Refusal(
      `--framework names ${path}, and there is no such document on this install (resolved to ${deck}). `
      + `Refusing rather than rating this brand owner's matters under the Generic default: a framework `
      + `somebody chose and that does not resolve is a mistake, not an absence.`);

  // The manifest is DERIVED from the deck path, never a separate knob — and it is what the validators,
  // the renderer and the profile page read to know the framework's band vocabulary. A deck whose
  // manifest will not load produces a customer whose page cannot state their own ladder.
  //
  // ASKED, NOT RE-CHECKED. An `existsSync` on the manifest here would be a second opinion about the
  // same fact: `loadFrameworkManifest` already refuses a missing sidecar by name
  // (`framework_manifest_missing:<path>`) and is the exact read the rating stage makes. Two checks
  // means two messages to keep in step, and the one this file could write would be the one that goes
  // stale.
  let manifest;
  try {
    manifest = loadManifest(resolveSkill, path);
  } catch (e) {
    throw new Refusal(
      `--framework names ${path}, and the framework will not load: ${String(e?.message ?? e)}. `
      + `Refusing rather than falling back: a framework somebody chose and that does not resolve is a `
      + `mistake, not an absence.`);
  }
  return { path, source: "supplied", manifest };
}

// ── the profile this writes ────────────────────────────────────────────────────────────────────────
/**
 * Which marketplaces this brand owner's searches cover — supplied, or the Generic default, SAID OUT LOUD.
 *
 * A customer bundle is a COMPLETE document in this design, not an overlay on generic: every shipped
 * profile carries its own `platforms`, and the loader requires a non-empty array on every file. The
 * command had no way to supply one and set none, so every bundle it wrote failed to load on this field
 * as well as on the `key` field above — two independent invalidities, and onboarding could not produce
 * a loadable brand owner at all.
 *
 * Defaulting rather than refusing, and naming it, is this command's own established idiom: the same
 * ruling governs the framework one function down. Which marketplaces a client's clearance searches is
 * not a detail to decide silently, so an operator who supplies nothing is TOLD what they got and can
 * refine it in the portal.
 */
export function resolvePlatforms(supplied, roster) {
  if (supplied?.length) return { platforms: supplied, source: "supplied" };
  const house = roster?.get?.("generic")?.platforms ?? [];
  if (!house.length)
    throw new Refusal(
      "no --platforms was given and the Generic default carries none, so there is nothing to onboard this "
      + "brand owner with. Pass --platforms, or repair the generic profile in the store.");
  return { platforms: [...house], source: "house default" };
}

export function buildProfile({ key, name, domains, platforms, framework, industry }) {
  // NO `key` IN THE DOCUMENT. The loader derives it from the FILENAME and injects it — readProfilesLayer
  // composes `{ key, ...p }` — so a `key` written here is redundant on the way in and fatal on the way
  // out: it is not in KNOWN_PROFILE_KEYS, and the deny-unknown-key gate hard-fails the whole roster over
  // it. Every bundle this command wrote carried one, so the first successful onboarding made the store
  // unloadable and the next command to read profiles threw. The parameter stays — the filename and the
  // roster checks are addressed by key — it simply does not travel into the file.
  const profile = { name, platforms };
  if (domains?.length) profile.matchDomains = domains;
  if (industry) profile.industry = industry;
  // ALWAYS SET, per the ruling. `frameworkFor` would fall back to the same value if this were absent —
  // but "the tool sets it" is the point of the setup, and an explicit selection is what makes the
  // receipt below mean anything.
  profile.frameworkPath = framework.path;
  return profile;
}

// ── the proposed roster, validated whole ───────────────────────────────────────────────────────────
/**
 * Validate the candidate the way the deployment will read it: as one member of the roster, not alone.
 *
 * `loadProfiles` composes every profile in the store and throws on the FIRST cross-profile conflict it
 * finds — a domain claimed twice, most of all. That throw is not scoped to the offending file: it stops
 * the roster loading at all. So the only honest check is over the proposed state, which is what
 * bin/grant.mjs does with `accessView` for exactly the same reason.
 */
/**
 * The roster as it stands, where AN EMPTY STORE IS AN EMPTY ROSTER — F42.
 *
 * `loadProfiles` with an explicit `dir` reads that directory ALONE and refuses a store with no
 * `generic.json`, which is right for what that refusal is for: `generic` is the universal fallback every
 * unprofiled job resolves to, and a RUN against a store without it would silently reprofile a client.
 * The explicit-dir form deliberately has no fall-through, because the fixtures that build a roster
 * assert on precisely that roster and layering the bundled set underneath would widen three set-level
 * guards until none still tested its own name.
 *
 * BUT THIS COMMAND IS NOT RUNNING A CLEARANCE. It reads the store to answer one question — does this key
 * or one of its domains already exist — and on a fresh install the honest answer is "no, there is
 * nothing here yet". Instead it stack-traced on the FIRST day-one command a new operator types, with a
 * refusal about a file they had never heard of and did not need: the runtime resolves `generic` from the
 * product's bundled set through the OVERLAY path, so a deployment store never needs its own copy.
 *
 * So the missing-generic refusal is caught BY NAME and answered as the empty roster it describes. Caught
 * by name rather than broadly, because every other thing that loader throws — an overlapping domain, an
 * unknown key, an unreadable store — is a real refusal this command must still relay.
 */
export function rosterAsItStands(store, loadProfiles) {
  try { return loadProfiles({ dir: store, force: true }); }
  catch (e) {
    if (/generic\.json is REQUIRED/.test(String(e?.message ?? ""))) return new Map();
    throw e;
  }
}

export function assertRosterAccepts({ store, key, profile, loadProfiles }) {
  // THE LOADER'S OWN VALIDATOR, over the CANDIDATE — the discipline `project add` already applies to an
  // overlay, in the same words, for the same reason: whatever the tree would refuse at load is refused
  // here, before anything is written. Everything below this line reads the store AS IT STANDS, which is
  // why none of it could ever see a bad field in the file about to be added: the candidate never met the
  // loader until the next command did, and by then the write had landed.
  const v = validateProfileEdit(key, profile);
  if (!v.ok)
    throw new Refusal(`the brand owner bundle is not valid, so nothing was written:\n  ${v.errors.join("\n  ")}`);

  const existing = rosterAsItStands(store, loadProfiles);
  if (existing.has(key))
    throw new Refusal(
      `a brand owner "${key}" already exists in ${store}. This command creates; it does not overwrite an `
      + `existing bundle. Edit it in the portal, or remove the file deliberately first.`);

  for (const d of profile.matchDomains ?? []) {
    const dl = String(d).toLowerCase();
    for (const [otherKey, other] of existing) {
      if ((other.matchDomains ?? []).some((o) => String(o).toLowerCase() === dl))
        throw new Refusal(
          `domain "${dl}" is already claimed by the brand owner "${otherKey}". Two owners claiming one `
          + `domain makes the WHOLE roster refuse to load on the next start — not just this bundle — so `
          + `nothing has been written.`);
    }
  }
}


// ── argument parsing ───────────────────────────────────────────────────────────────────────────────
// Long flags only, and an unknown one REFUSES. A permissive parser on a command that writes into the
// customers directory is how a typo'd flag becomes a silently missing field — `--fraemwork` would
// otherwise onboard a client under the Generic default while the operator believed they had set theirs.
const FLAGS = ["--name", "--domains", "--platforms", "--framework", "--industry", "--context"];
export function parseArgs(argv) {
  const out = { key: null, name: null, domains: [], platforms: null, framework: null, industry: null, context: null, dryRun: false };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a.startsWith("--")) {
      if (!FLAGS.includes(a)) throw new Refusal(`no such option "${a}". One of: ${FLAGS.join(", ")}, --dry-run`);
      const v = rest.shift();
      if (v === undefined || v.startsWith("--")) throw new Refusal(`${a} needs a value`);
      if (a === "--name") out.name = v;
      else if (a === "--domains") out.domains = v.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
      else if (a === "--platforms") out.platforms = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      else if (a === "--framework") out.framework = v;
      else if (a === "--industry") out.industry = v;
      else if (a === "--context") out.context = v;
      continue;
    }
    if (out.key === null) { out.key = a; continue; }
    throw new Refusal(`unexpected argument "${a}" — this command takes one brand owner key`);
  }
  return out;
}

const USAGE = `
  clearotron brandowner add <key> --name "<legal name>" [options]

    --name       the brand owner's legal name (required)
    --domains    comma-separated email domains that resolve to this owner
    --platforms  comma-separated marketplaces their searches cover
                 omitted ⇒ the Generic default's platforms are applied and named in the output
    --framework  their risk framework, as skills/prelim-search/<file>.md
                 omitted ⇒ the Generic default is applied and named in the output
    --industry   free text, shown on their profile
    --context    a file whose contents become this owner's context pack
    --dry-run    say exactly what would be written, and write nothing

  Exit codes: 0 written and recorded · 1 refused, nothing written · 2 usage
              3 written but NOT recorded — the bundle is written and the store has no record of it
`;

export async function add(argv, {
  resolution = profileStoreResolution(),
  loadProfiles: loadProfilesFn,
  out = console.log,
} = {}) {
  const args = parseArgs(argv);
  if (!args.key) throw new Refusal(`this command needs a brand owner key.${USAGE}`);
  // A REFUSAL, NOT A STACK (, acceptance: "refuses malformed input BY NAME — key
  // pattern"). `assertProfileKey` throws a plain Error, and main() deliberately lets a non-Refusal keep
  // its stack because an unexpected throw here is a defect worth debugging. A key an operator typed is
  // not that: it is the first thing this command validates and the most likely thing to get wrong, and
  // it was answering a typo with a Node stack trace naming a line in driver/profiles.mjs. The message
  // is already the right sentence — only its CLASS was wrong.
  try { assertProfileKey(args.key); }
  catch (e) { throw new Refusal(e?.message ?? String(e)); }
  if (!args.name || !args.name.trim()) throw new Refusal(`--name is required — the brand owner's legal name.`);

  const store = storeForAdd(resolution);
  const framework = resolveFramework(args.framework);

  let contextPack = null;
  if (args.context) {
    const packFile = resolvePath(args.context);
    if (!existsSync(packFile)) throw new Refusal(`--context names ${args.context}, and there is no such file (looked at ${packFile}).`);
    contextPack = readFileSync(packFile, "utf8");
  }

  // THE ROSTER IS READ BEFORE THE CANDIDATE IS BUILT, because the Generic default lives in it. The
  // candidate is still judged as a member of the roster and not alone — see assertRosterAccepts.
  const { loadProfiles } = await import("../driver/profiles.mjs");
  const load = loadProfilesFn ?? loadProfiles;
  const platforms = resolvePlatforms(args.platforms, rosterAsItStands(store, load));

  const profile = buildProfile({
    key: args.key, name: args.name.trim(), domains: args.domains,
    platforms: platforms.platforms, framework, industry: args.industry,
  });

  assertRosterAccepts({ store, key: args.key, profile, loadProfiles: load });

  // WHICH FRAMEWORK, SAID OUT LOUD — the ruling's own requirement, and it is stated whether or not
  // anything is written, so a dry run answers the question the operator actually has.
  const frameworkLine = framework.source === "supplied"
    ? `framework: ${framework.path} — this brand owner's own, as supplied`
    : `framework: ${framework.path} — THE GENERIC DEFAULT, applied because none was supplied. `
      + `Their matters will be rated under it until they give us theirs.`;

  const platformsLine = platforms.source === "supplied"
    ? `platforms: ${platforms.platforms.join(", ")} — as supplied`
    : `platforms: ${platforms.platforms.join(", ")} — THE GENERIC DEFAULT, applied because none was supplied. `
      + `Their searches cover these marketplaces until someone changes them in the portal.`;

  if (args.dryRun) {
    out(`would create ${join(store, `${args.key}.json`)}`);
    if (contextPack) out(`would create ${join(store, CONTEXT_PACK_FILE(args.key))}`);
    out(frameworkLine);
    out(platformsLine);
    out(`nothing was written (--dry-run)`);
    return { written: false, store, profile, framework };
  }

  // NO mkdir HERE. storeForAdd has already refused a store that does not exist, and creating one
  // would contradict that refusal — silently turning a typo into an empty roster that reads as a
  // working install.
  const { files } = defaultWriteProfile({ profileDir: store, key: args.key, profile, contextPack });

  // THE RECEIPT — who, when, which document — through the same helper the save paths use, so the
  // store's git log reads as one audit trail rather than two.
  // `.root` IS THE PATH. The resolver returns { root, from, tried }; the whole object here reaches
  // git as the literal `[object Object]`, which killed the record half of every add on every store
  // and blamed the store for it. The helpers now refuse a non-path at the boundary, so this can no
  // longer fail quietly — but the call still has to ask for the field it wants.
  const repoRoot = resolveStoreRepoRoot({ names: ["CLEAROTRON_CUSTOMERS_DIR"], fallback: store }).root;
  const audit = makeCommittableAudit({ auditPath: join(store, "audit.jsonl"), repoRoot });
  const gitCommit = makeStoreCommit({ repoRoot, what: "customers" });
  // WHO, from the OS rather than the environment. `SUDO_USER`/`USER` are shell variables this
  // product does not own, and reading one would put an undocumented variable into the config
  // surface the governance ratchet guards. bin/start.mjs already had this problem and answered it
  // this way, including the catch: a container with no passwd entry has no username to give.
  let by = "unknown";
  try { by = userInfo().username || "unknown"; } catch { /* no passwd entry — the row still gets written */ }
  const { commit, commitError } = commitWithAuditRow({
    audit, gitCommit, files, by,
    message: `brand owner ${args.key} onboarded (framework ${framework.path})`,
    row: { event: "brandowner_add", key: args.key, by, framework: framework.path, frameworkSource: framework.source },
  });

  for (const f of files) out(`wrote ${f}`);
  out(frameworkLine);
  out(platformsLine);
  if (commit) out(`recorded ${commit}`);
  if (commitError) out(`WROTE THE BUNDLE BUT DID NOT RECORD IT: ${commitError} — the audit line is on disk; fix the store's git state`);
  out(`doctor will now resolve ${args.key} from ${store}`);

  // ── F51 — AN ACCOUNT MUST NEVER EXIST THAT THE PORTAL CANNOT START ───────
  //
  // This command used to end one line above, saying the account was ready. It was not: the portal's
  // trigger lane runs on a PINNED ops token minted before the account existed, so the portal offered a
  // clearance and the engine door refused it —
  //
  //     FORBIDDEN (start_run): your grant [generic] does not include account "acmelaw"
  //
  // The product DID detect this, at the portal's next boot, naming the account and the remedy with its
  // flag. It said so to the journal, and the next reader was a client whose search was refused. So the
  // same computation is asked HERE, in the surface the person who created the account is looking at,
  // the moment they create it.
  //
  // IT REPORTS RATHER THAN RE-MINTS, and that is a boundary rather than a shortcut: re-minting needs
  // the signing secret, a rewrite of the unit environment and a portal restart, and a create-an-account
  // command that silently reissues the credential every run is authorised by would be a larger surprise
  // than the one being fixed. What it owes the reader is that they cannot miss it, and the exact
  // command — which is what it now prints.
  //
  // NEVER FATAL, and never a reason to unwrite the bundle. The account is real and correct; what is
  // stale is a credential elsewhere. Refusing here would leave a written bundle behind a failed exit,
  // which is worse than a written bundle and a loud instruction.
  try {
    const { opsTokenPosture } = await import("../driver/portal-service.mjs");
    const { triggerCapGap, triggerCapWarning } = await import("../driver/trigger-cap.mjs");
    const posture = opsTokenPosture(process.env.PORTAL_OPS_TOKEN);
    if (posture.readable) {
      const roster = [...rosterAsItStands(store, loadProfiles).keys(), args.key];
      const gap = triggerCapGap({ accounts: posture.accounts, roster });
      if (gap.uncovered.length) {
        out("");
        out(`  ⚠ NOT YET STARTABLE — ${triggerCapWarning(gap)}`);
        out(`    The portal will offer a clearance for ${args.key} and the engine door will refuse it until the trigger token is re-minted.`);
      }
    }
  } catch (e) {
    // An absence is a finding: say the check did not happen rather than let silence read as a pass.
    out(`  (could not check whether the portal's trigger token covers ${args.key}: ${e?.message ?? e})`);
  }
  return { written: true, store, profile, framework, commit, commitError };
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") { console.log(USAGE); process.exit(sub ? 0 : 1); }
  if (sub !== "add") { console.error(`brandowner: no such action "${sub}". One of: add`); process.exit(2); }
  try {
    // WROTE-BUT-DID-NOT-RECORD IS NOT SUCCESS. The write stands — rolling a written bundle back
    // would lose the operator's work over a git fault they can fix — but a scripted onboarding
    // reading exit 0 concludes the store recorded it, and the store did not. Exit 3 says both
    // halves: not 1, which this file already spends on a refusal that wrote nothing, and not 2,
    // which is a usage error. The loud line above names the fault; this makes it machine-readable.
    const result = await add(rest);
    if (result?.commitError) process.exit(3);
  } catch (e) {
    // A REFUSAL IS NOT A CRASH. It names what was wrong and exits 1; anything else keeps its stack,
    // because an unexpected throw here is a defect and hiding it behind a tidy message costs the debug.
    if (e instanceof Refusal) { console.error(`brandowner: ${e.message}`); process.exit(1); }
    throw e;
  }
}

if (isEntrypoint(import.meta.url)) main();
