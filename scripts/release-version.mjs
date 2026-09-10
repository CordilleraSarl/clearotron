// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-version.mjs — property 1: a merge cuts a version.
//
// WHAT CHANGESETS DOES NOT DO HERE, MEASURED RATHER THAN ASSUMED. The issue recommends Changesets
// because it is workspace-aware and this repository has four workspaces. It is, and it does not cover
// the case that matters: `changeset version` versions the WORKSPACE packages and leaves the ROOT
// package alone, and the root package is `clearotron` — the one thing a user installs and the only
// version they will ever quote back to us. Measured on 3.0.1: a note against `clearotron-driver` moved
// clearotron-driver 0.1.0 -> 0.1.1 and left `clearotron` at 0.1.0, with a changelog written per workspace
// and none at the root.
//
// So the four workspaces are a `fixed` group — one version number moves them together — and this script
// carries that number to the root and assembles the one changelog a reader will actually open. Without
// it the release cuts a version of four packages nobody installs, and the tag would name a version the
// published artifact does not carry.
//
// It runs the plain-language gate LAST, over the assembled root changelog, and refuses there. That is
// the compile-time enforcement of property 3: it holds regardless of who or what wrote the note,
// because it reads the output rather than trusting the input.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findings, sentences } from "./changelog-plain-language.mjs";
import { tagsHere } from "./release-cut-decision.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GROUP = ["driver", "mcp-server", "portal-ui", "providers/oauth-mcp-bridge"];
/** The page's order, user-facing first, from the owner's contract. */
export const GROUPS = ["New", "Fixed", "For operators"];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** PURE. Where `version` is already out: tagged in this checkout, published on the registry, both, or neither. */
export function alreadyOut({ version, tags = [], published = false }) {
  const where = [];
  if (tags.includes(`v${version}`)) where.push(`tagged here as v${version}`);
  if (published === true) where.push("published on the registry");
  return where;
}

/**
 * Whether the registry already carries `name@version`: true, false, or null when it could not be asked.
 *
 * npm answers a version it does not have with exit 1 and `E404`, "No match found for version", so that one
 * failure is the answer no. Any other failure is a failure to look, and the caller refuses on it.
 */
export function registryHas(name, version, {
  run = (args) => execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
} = {}) {
  try {
    return String(run(["view", `${name}@${version}`, "version"]) ?? "").trim() === version;
  } catch (e) {
    return /\bE404\b|No match found for version/.test(`${e?.stderr ?? ""}${e?.message ?? ""}`) ? false : null;
  }
}

/** The one version the fixed group now carries — and a refusal if they disagree. */
export function groupVersion(root = ROOT) {
  const seen = new Map();
  for (const w of GROUP) seen.set(w, readJson(join(root, w, "package.json")).version);
  const distinct = [...new Set(seen.values())];
  if (distinct.length !== 1) {
    throw new Error("release-version: the fixed group disagrees about its version — "
      + [...seen].map(([w, v]) => `${w}=${v}`).join(", ")
      + ". A `fixed` group that has come apart means the release would tag one number while the "
      + "packages carry another.");
  }
  return distinct[0];
}

/**
 * Assemble the root changelog from what changesets wrote per workspace.
 *
 * The per-workspace files are the record of which package changed; the root file is the record a
 * READER opens, so it carries the sentences and not the package names. Duplicates are collapsed: a
 * fixed group means one note commonly lands in several files unchanged.
 */
export function assembleRoot(version, root = ROOT) {
  const entries = [];
  const seen = new Set();
  for (const w of GROUP) {
    const p = join(root, w, "CHANGELOG.md");
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    // Only this version's section: from its heading to the next version heading, or to end of file.
    //
    // NOT a lookahead ending in `\\Z`. JavaScript has no `\\Z` — it is a literal "Z" — so a lookahead
    // written `(?=^## |\\Z)` never matches the LAST section of a file, which is every section that
    // matters here. It failed silently: no match, no bullets, and an empty changelog that the plain
    // language gate then passed because empty text carries no jargon. Split on the headings instead.
    const sections = text.split(/^## /m).slice(1);
    const mine = sections.find((sec) => sec.split("\n", 1)[0].trim() === version);
    if (!mine) continue;
    for (const note of notesOf(mine)) {
      const key = note.join("\n");
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(...note);
    }
  }
  return { version, ...group(entries) };
}

/**
 * One version section of a workspace changelog, as the notes it holds. Each note is the list of its
 * entries in order, and each entry opens with the group it belongs under, unless none was named.
 *
 * EVERY PARAGRAPH IS AN ENTRY. Changesets writes a note's first line as a bullet and indents every later
 * line beneath it. Reading only the bullets kept each note's first line and dropped the rest without a
 * word: the 0.2.3 page reads "Five things a first-time reader could not act on." with none of the five
 * under it, and a dry run of 0.3.0 put 8 of the 75 sentences in eight pending notes on the page
 * (measured 2026-09-10). So each later paragraph is an entry of its own, and so is each list item.
 *
 * AN ENTRY THAT NAMES NO GROUP TAKES THE GROUP OF THE ENTRY BEFORE IT. A note opens with its group, and a
 * paragraph that opens with another group starts that group's entries: `Fixed:` two paragraphs into a
 * `New:` note is a fix, and so is the paragraph after it that explains the fix. A note whose first line
 * names no group gives the rest of it none either, so the whole note is refused, not only its first line.
 */
export function notesOf(section) {
  const notes = [];
  let note = null, lines = null, current = null;
  const close = () => {
    if (!lines) return;
    const text = lines.join(" ");
    lines = null;
    const own = /^(New|Fixed|For operators):\s/.exec(text)?.[1];
    if (own) current = own;
    note.push(own || !current ? text : `${current}: ${text}`);
  };
  for (const line of section.split("\n").slice(1)) {
    const top = /^-\s+(.*\S)\s*$/.exec(line);
    const item = /^\s+-\s+(.*\S)\s*$/.exec(line);
    if (top) {
      close();
      note = [];
      notes.push(note);
      current = null;
      // THE COMMIT SHA COMES OFF. Changesets' default generator prefixes every bullet with the commit
      // that carried the note, so a squashed release writes the SAME seven characters at the head of
      // every line — `- f7c1570:` seven times over, telling a reader nothing they can use. This is the
      // file a customer opens to decide whether to upgrade; the provenance they can act on is the tag
      // and the release page, both of which name that commit once.
      lines = [top[1].replace(/^[0-9a-f]{7,40}: /, "")];
    } else if (!note) {
      continue;                              // the version heading, or anything before the first note
    } else if (line.startsWith("#")) {
      close();                               // `### Patch Changes`: a new set of notes starts here
      note = null;
    } else if (!line.trim()) {
      close();                               // a blank line ends a paragraph
    } else if (item) {
      close();
      lines = [item[1]];
    } else {
      (lines ??= []).push(line.trim());      // a paragraph's next line, or its first after a blank line
    }
  }
  close();
  return notes;
}

/**
 * The bullets, sorted into the three groups the page shows, with the group marker taken off.
 *
 * WHY A MARKER AT ALL. The owner's contract says the page groups notes New / Fixed / For operators, with
 * the user-facing ones first. That has to come from the note — the person writing it is the only one who
 * knows which it is — so a note opens with its group and this reads it off. `.changeset/README.md` says
 * so beside the contract, and `release-notes-lint.mjs` refuses a note without one.
 *
 * A BULLET WITH NO GROUP IS A REFUSAL, not a default. Dropping it into "Fixed" would put a new feature
 * under the wrong heading and nobody would ever see that it had happened.
 */
export function group(bullets) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
  const ungrouped = [];
  for (const b of bullets) {
    const m = /^(New|Fixed|For operators):\s+(.*)$/s.exec(b);
    if (!m) { ungrouped.push(b); continue; }
    groups[m[1]].push(m[2].trim());
  }
  return { groups, ungrouped };
}

/**
 * Prepend this version's section to the root changelog, creating it if this is the first release.
 *
 * The ruling that blocked the first cut MOVED on 2026-08-31 (owner,: the landed
 * decision is master): ADR-0004/0006 are amended and `CHANGELOG.md` is off `shared/withheld-paths.mjs`,
 * so writing the file no longer reds publication-scrub. What still binds: the CUT rule deciding the
 * file must land in the same change as the file's first appearance — the export's rule tables refuse a
 * rule matching nothing, so it cannot be pre-added, and `driver/test/release-pipeline.test.mjs` reds an
 * existing-but-undecided changelog so the first version PR cannot merge without it.
 */
export function writeRootChangelog({ version, groups }, root = ROOT) {
  const p = join(root, "CHANGELOG.md");
  // THE HEAD SAYS HOW THE READER GOT THE BINARY, AND THAT IS NOT DECORATION. Every root document is
  // read by somebody who has to be able to run what it shows them, and this one is written by a script
  // rather than a person — so the notes it carries are plain English about `clearotron doctor` and
  // `clearotron demo`, which is the right way to write them. Without the install line above, the first
  // such note makes the generated file fail the tree's own root-document guard, and it fails on the
  // VERSION PULL REQUEST alone: main has no CHANGELOG.md, so nothing in the branch that wrote the note
  // can see it coming. Measured 2026-09-05, on the first version pull request the pipeline ever opened.
  //
  // It is also just true. A changelog exists to tell somebody what they get if they upgrade, and this
  // says how.
  const head = "# Changelog\n\nWhat changed in each release of Clearotron, in plain English.\n\n"
    + "Install or upgrade with `npm install -g clearotron`.\n";
  // Everything from the first version heading down — read that way rather than by stripping a known
  // head, so editing the head above cannot leave the old one buried in the file for ever.
  const prior = existsSync(p) ? (readFileSync(p, "utf8").match(/\n## [\s\S]*/)?.[0] ?? "") : "";
  // Empty groups are dropped rather than printed empty: a heading with nothing under it tells a reader
  // that something is missing, which is a worse lie than not mentioning the group at all.
  const body = GROUPS
    .filter((g) => groups[g]?.length)
    .map((g) => `### ${g}\n\n${groups[g].map((b) => `- ${b}`).join("\n")}\n`)
    .join("\n");
  const section = `\n## ${version}\n\n${body}`;
  writeFileSync(p, head + section + prior);
  return p;
}

function main() {
  const args = process.argv.slice(2);
  const run = (...a) => execFileSync(process.execPath,
    [join(ROOT, "node_modules/@changesets/cli/bin.js"), ...a], { cwd: ROOT, stdio: "inherit" });

  run("version", ...args);
  const version = groupVersion();

  // ── A VERSION ALREADY OUT IS REFUSED HERE, BEFORE ANYTHING IS STAMPED ─────────────────────────────
  //
  // The pre-release line keeps no record of its last number. `.changeset/pre.json` holds its mode and tag
  // and nothing else, and a stable release deletes it, so `changeset version` counts again from
  // package.json. Measured 2026-09-10: entering beta on a tree at 0.2.4 computed 0.3.0-beta.0, which was
  // already tagged and on the registry. A cut from there would stamp main with it, consume every pending
  // note, and fail only at publish, leaving both to be unwound by hand. The tags and the registry are the
  // record, so the number is checked against both, and a failure to read either is a refusal too.
  const tags = tagsHere();
  if (!tags.length) {
    console.error(`release-version: this checkout has no tags, so whether ${version} is already out cannot `
      + "be read. Refusing rather than stamping a number that may already be published.");
    process.exitCode = 2;
    return;
  }
  const name = readJson(join(ROOT, "package.json")).name;
  const published = registryHas(name, version);
  if (published === null) {
    console.error(`release-version: the registry could not be asked whether ${name}@${version} exists. `
      + "Refusing rather than stamping a number that may already be published.");
    process.exitCode = 2;
    return;
  }
  const out = alreadyOut({ version, tags, published });
  if (out.length) {
    console.error(`release-version: this cut computed ${version}, and that version is already out: `
      + `${out.join(" and ")}. Publishing it would fail after main is stamped and the notes are consumed.\n`
      + "  The pre-release line keeps no record of its last number: .changeset/pre.json holds only its mode "
      + "and tag, and a stable release deletes it, so this was counted again from package.json. Put the "
      + "line back where its last published version left it, then cut again.");
    process.exitCode = 1;
    return;
  }
  const pkgPath = join(ROOT, "package.json");
  const pkg = readJson(pkgPath);
  const was = pkg.version;
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`release-version: clearotron ${was} -> ${version} (carried from the fixed group)`);

  // AND THE LOCKFILE, WHICH NOTHING ELSE IN THIS CUT TOUCHES. `changeset version` rewrites the
  // workspace manifests and the block above rewrites the root's; `package-lock.json` records the same
  // five version numbers and neither writes it. Measured on main at 1e69d606: every manifest said
  // 0.1.1 and the lock still said 0.1.1-beta.0, one release behind, which is where it had been since
  // the first cut. It survives because npm only refuses a lock that disagrees about DEPENDENCIES — a
  // version field is not that, so `npm ci` installs, CI passes, and the drift rides into main.
  //
  // npm owns the lock's format, so npm writes it. `--package-lock-only` needs no node_modules and
  // resolves nothing that is already satisfied, so it moves the version fields and no dependency:
  // a release cut is the last place that should quietly bump a package.
  execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"],
    { cwd: ROOT, stdio: "inherit" });
  console.log("release-version: package-lock.json carries the same version as the manifests");

  const assembled = assembleRoot(version);
  // A note that named no group would land under the wrong heading, silently. It refuses instead.
  if (assembled.ungrouped.length) {
    console.error("release-version: these release notes name no group, so the page cannot order them. "
      + `Each opens with one of ${GROUPS.map((g) => `\`${g}:\``).join(", ")} — see .changeset/README.md.\n`);
    for (const b of assembled.ungrouped) console.error("  " + b.slice(0, 100));
    process.exitCode = 1;
    return;
  }
  // AN EMPTY RELEASE RECORD IS A REFUSAL, NOT A PASS. This is what caught the bug above: the section
  // came out with no bullets, and the plain-language gate passed it, because empty text contains no
  // jargon. A release whose changelog says nothing is worse than no changelog — a reader opens it,
  // learns nothing, and concludes the release did nothing.
  const total = GROUPS.reduce((n, g) => n + assembled.groups[g].length, 0);
  if (!total) {
    console.error(`release-version: version ${version} assembled ZERO changelog lines. Either no note `
      + "described a user-visible change, or the per-workspace changelogs were not written where this "
      + "expects them. Both are refusals: a release with an empty record does not go out.");
    process.exitCode = 1;
    return;
  }
  const p = writeRootChangelog(assembled);
  const found = findings(readFileSync(p, "utf8"));
  if (found.length) {
    console.error(`release-version: the assembled changelog is not plain English. Rewrite the notes.\n`);
    for (const s of sentences(found)) console.error("  " + s);
    process.exitCode = 1;
    return;
  }
  console.log(`release-version: ${p} is plain English`);
}

if (isEntrypoint(import.meta.url)) main();
