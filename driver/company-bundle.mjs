// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// company-bundle.mjs — what a valid company bundle is, and what the roster will accept.
//
// ── EXTRACTED FROM bin/brandowner.mjs WHEN THE SECOND DOOR ARRIVED ─────────────────────────────────
//
// The command line was the only way to create a company, so this logic lived beside it. The browser is
// now the second door, and the alternative to moving it was a second opinion about what a valid company
// is — which is the thing this codebase keeps paying to remove. There is one definition and both doors
// ask it.
//
// It lives here rather than in shared/ because every question below is answered by driver code — the
// profile validator, the framework loader, the skill-path resolver — and shared/ does not depend on
// driver/. And it lives outside bin/ for the reason shared/onboarding-store.mjs already states: a bin
// entry importing another bin entry is a dependency between two things a user types.
//
// ── WHAT IS HERE AND WHAT IS NOT ──────────────────────────────────────────────────────────────────
//
// Everything here is filesystem-and-roster pure: it composes a bundle and says whether the roster would
// accept it. What differs between the two doors stays with each — where the store is, how a context pack
// is read, who the author is (the command reads the OS username, the service takes it from the verified
// sign-in), and how the write is recorded.
//
// The refusal that matters most is the domain collision. The roster loader throws for the WHOLE roster
// when two companies claim one domain, so a bad create does not fail one company — it stops the
// deployment resolving ANY of them at the next start. That check is not reachable from the per-profile
// validator, so it has to be made here, against the proposed roster, before anything is written.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { validateProfileEdit } from "./profiles.mjs";
import { DEFAULT_FRAMEWORK, loadFrameworkManifest } from "./framework.mjs";
import { config } from "./driver.config.mjs";
import { Refusal } from "../shared/onboarding-store.mjs";

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
      + `somebody chose and that does not resolve is a mistake, not an absence.`,
      { code: "framework_missing", path });

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
      + "brand owner with. Pass --platforms, or repair the generic profile in the store.",
      { code: "no_marketplaces" });
  return { platforms: [...house], source: "house default" };
}

export function buildProfile({ key, name, domains, platforms, framework, industry,
  tradingNames, classes, territories }) {
  // NO `key` IN THE DOCUMENT. The loader derives it from the FILENAME and injects it — readProfilesLayer
  // composes `{ key, ...p }` — so a `key` written here is redundant on the way in and fatal on the way
  // out: it is not in KNOWN_PROFILE_KEYS, and the deny-unknown-key gate hard-fails the whole roster over
  // it. Every bundle this command wrote carried one, so the first successful onboarding made the store
  // unloadable and the next command to read profiles threw. The parameter stays — the filename and the
  // roster checks are addressed by key — it simply does not travel into the file.
  const profile = { name, platforms };
  if (domains?.length) profile.matchDomains = domains;
  if (industry) profile.industry = industry;
  // THE OPTIONAL THREE, OMITTED WHEN EMPTY RATHER THAN WRITTEN AS `[]`. An empty array is a real
  // instruction to the reader of a profile, not the absence of one, so writing it for a field nobody
  // filled in states something nobody said. The whole create path treats absent and empty as different
  // and this is where that has to hold.
  if (tradingNames?.length) profile.selfExclusionOwners = tradingNames;
  if (classes?.length) profile.defaultClasses = classes;
  if (territories?.length) profile.defaultJurisdictions = territories;
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
/**
 * The key a company gets from its name — the filename, and the key every screen and route uses.
 *
 * ONE SPELLING FOR BOTH DOORS. The command line takes the key as an argument and the browser derives it
 * from the name, so without this the two doors would file "Acme Ltd" under different keys depending on
 * which one you used, and neither would be wrong.
 *
 * Capped well under the validator's 39 characters and stripped of leading and trailing hyphens, so a
 * name made entirely of punctuation produces nothing rather than a key of dashes — the caller then
 * refuses and asks for the key, which is honest, where inventing one would file a company under a name
 * nobody chose.
 */
export function companyKeyFrom(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    // COMBINING MARKS ARE DROPPED, NOT SEPARATED. NFKD splits "ü" into "u" + a combining diaeresis, and
    // the class below would turn that mark into a hyphen — so "Zürich Präzision" filed as
    // "zu-rich-pra-zision". Accented company names are the normal case in the languages this product
    // works in, not an edge.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39)
    .replace(/-+$/, "");
}

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
  // `generic` IS RESERVED AND THE KEY RULE DOES NOT SAY SO. `PROFILE_KEY_RE` matches it, while the
  // comment above that regex claims the create path never allows it — so the rule was a sentence rather
  // than a check. On a store with no `generic.json` of its own, creating one here writes a file that
  // shadows the bundled universal fallback for every job that names no company, which is silent and
  // affects every clearance rather than one. Refused at the gate both doors pass through.
  if (String(key).toLowerCase() === "generic")
    throw new Refusal(
      `"generic" is the house default every unprofiled clearance falls back to, so it cannot be created `
      + `as a company. Nothing has been written. Pick another key.`);

  const v = validateProfileEdit(key, profile);
  if (!v.ok)
    throw new Refusal(`the company bundle is not valid, so nothing was written:\n  ${v.errors.join("\n  ")}`,
      { code: "invalid_bundle", errors: v.errors });

  const existing = rosterAsItStands(store, loadProfiles);
  if (existing.has(key))
    throw new Refusal(
      `a brand owner "${key}" already exists in ${store}. This command creates; it does not overwrite an `
      + `existing bundle. Edit it in the portal, or remove the file deliberately first.`,
      { code: "key_exists", key });

  for (const d of profile.matchDomains ?? []) {
    const dl = String(d).toLowerCase();
    for (const [otherKey, other] of existing) {
      if ((other.matchDomains ?? []).some((o) => String(o).toLowerCase() === dl))
        throw new Refusal(
          `domain "${dl}" is already claimed by the brand owner "${otherKey}". Two owners claiming one `
          + `domain makes the WHOLE roster refuse to load on the next start — not just this bundle — so `
          + `nothing has been written.`,
          { code: "domain_claimed", domain: dl, heldBy: otherKey });
    }
  }
}


// ── argument parsing ───────────────────────────────────────────────────────────────────────────────
// Long flags only, and an unknown one REFUSES. A permissive parser on a command that writes into the
// customers directory is how a typo'd flag becomes a silently missing field — `--fraemwork` would
// otherwise onboard a client under the Generic default while the operator believed they had set theirs.
const FLAGS = ["--name", "--domains", "--platforms", "--framework", "--industry", "--context"];