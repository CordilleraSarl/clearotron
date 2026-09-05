// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-notes-lint.mjs — a release note is written for the person who reads it.
//
// WHO THAT IS, AND WHY A CHECK EXISTS AT ALL. The reader is somebody who installs and runs Clearotron: a
// trademark lawyer, or the IT person helping them. They have never opened this repository. They do not
// know our issue numbers, our test names, our agents, or our words for things. They open the releases
// page or the changelog to decide whether to upgrade and what will be different.
//
// The notes shipped in the first pre-release failed that reader — they named internal things and
// addressed an undefined "you" — and the owner ruled on 2026-09-05 that the standard goes in the
// repository rather than in anybody's memory. `.changeset/README.md` carries the contract; this file is
// the half that cannot be forgotten, and it refuses a note rather than a release: it runs on the pull
// request that ADDS the note, where the person who wrote it is still holding it.
//
// WHAT IT WILL NOT DO. It cannot tell whether a sentence is true, or useful, or the right thing to say.
// It refuses the things that are mechanically decidable and says which rule and which line, so the
// argument is about the sentence rather than about whether there is a problem.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The three groups a note belongs to on the page. User-facing first, as the contract orders them. */
export const GROUPS = ["New", "Fixed", "For operators"];

/** At most this many words in a sentence. The contract's number, not a tuned one. */
export const MAX_WORDS = 25;

/**
 * Our internal vocabulary. Every one of these is a word we use fluently and the reader has never met in
 * this sense — which is the failure the owner named. `provenance` is here with a carve-out: the contract
 * allows it when glossed as "a signed record", so the note may use it beside that phrase.
 */
export const INTERNAL_WORDS = [
  "arm", "gate", "guard", "plant", "lane", "tracker", "sidecar", "funnel", "digest", "seam", "cut",
  "ratchet", "census", "drive", "stranger", "hardening", "class", "mechanism", "invariant", "resolver",
  "predicate", "OIDC", "dist-tag", "changeset", "pre-release mode",
];

/** Said instead of saying what happens. */
export const EMPTY_PHRASES = ["now correctly", "as expected", "properly"];

/**
 * The repository's own top-level source directories.
 *
 * A path whose first segment is one of these is a SOURCE-TREE path — `driver/test/…`, `scripts/…` — and
 * means nothing to somebody who has never opened this repository. A path that starts at the reader's own
 * home does not: `~/.config/clearotron/` is where THEIR settings are, and telling them is the note's job.
 * Owner ruling 2026-09-05, narrowing the contract's flat ban on "file paths": what a reader types or
 * opens is allowed; our tree is not.
 *
 * Derived from the tree rather than typed, so a directory added next month is covered without anybody
 * remembering to add it here.
 */
export function sourceDirectories(root = ROOT) {
  return new Set(readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => d.name));
}

/** Every command-line flag a ROOT DOCUMENT shows a user. The contract bans the ones that are not. */
export function documentedFlags(root = ROOT) {
  const out = new Set();
  for (const f of readdirSync(root).filter((n) => n.endsWith(".md"))) {
    for (const m of readFileSync(join(root, f), "utf8").matchAll(/--[a-z][a-z0-9-]+/g)) out.add(m[0]);
  }
  return out;
}

/** Everything the user documentation shows a reader, as one blob, for "is this documented" questions. */
export function userDocs(root = ROOT) {
  return readdirSync(root)
    .filter((n) => n.endsWith(".md"))
    .map((n) => readFileSync(join(root, n), "utf8"))
    .join("\n");
}

/**
 * Every package name `changeset version` will accept, read off the workspace list.
 *
 * MEASURED 2026-09-05: ten notes named the ROOT package, `clearotron`. `changeset version` refuses that
 * — the root is not one of the workspaces — and it refuses it on MAIN, after the merge, in the release
 * job, which is the worst place available to find out. A note naming a package that does not exist is
 * decidable the moment it is written, so it is decided then.
 *
 * The root is deliberately absent from this set even though it is the package a user installs: the four
 * workspaces are a fixed group and `scripts/release-version.mjs` carries their number to the root. A note
 * against the root is a note nothing will ever version.
 */
export function workspaceNames(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const out = new Set();
  for (const w of pkg.workspaces ?? []) {
    const p = join(root, w, "package.json");
    if (existsSync(p)) out.add(JSON.parse(readFileSync(p, "utf8")).name);
  }
  return out;
}

/** The packages a note names, in its frontmatter. */
export function packagesIn(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? ""));
  if (!m) return [];
  return [...m[1].matchAll(/^\s*"?([^":\n]+)"?\s*:/gm)].map((x) => x[1].trim()).filter(Boolean);
}

/** The note's text, without its frontmatter. */
export function bodyOf(text) {
  const s = String(text ?? "");
  const m = /^---\n[\s\S]*?\n---\n?/.exec(s);
  return (m ? s.slice(m[0].length) : s).trim();
}

/** Sentences, split on terminators that are not inside a decimal or an abbreviation we use. */
export function sentencesIn(body) {
  return String(body ?? "")
    .replace(/`[^`]*`/g, (t) => t.replace(/\./g, "\u2024"))   // a dot inside code is not a full stop
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\u2024/g, ".").trim())
    .filter(Boolean);
}

const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/**
 * Every refusal in one note. PURE apart from `flags`, which is injected so this can be driven.
 *
 * @returns {Array<{line:number, rule:string, offending:string}>} in file order
 */
export function findings(text, {
  file = "a note",
  flags = documentedFlags(),
  sourceDirs = sourceDirectories(),
  docs = userDocs(),
  packages = workspaceNames(),
} = {}) {
  const out = [];
  const lines = String(text ?? "").split("\n");
  const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim() === "---") + 1;
  const add = (i, rule, offending) => out.push({ line: i + 1, rule, offending });

  // The frontmatter, before anything about the prose: a note naming a package that does not exist never
  // reaches the changelog at all, so its wording is the second question.
  const named = packagesIn(text);
  if (!named.length) {
    out.push({ line: 1, rule: "a note names no package, so nothing would ever version for it", offending: file });
  }
  for (const name of named) {
    if (!packages.has(name)) {
      out.push({
        line: 2,
        rule: `\`${name}\` is not one of this repository's workspace packages, and \`changeset version\` `
          + `refuses it — on main, after the merge. The workspaces are ${[...packages].sort().join(", ")}`,
        offending: name,
      });
    }
  }

  const body = bodyOf(text);
  if (!body) {
    out.push({ line: 1, rule: "a note with no sentence in it says nothing to anybody", offending: file });
    return out;
  }

  // The group, which is how the page is ordered. Not part of the owner's contract text — it is the
  // mechanism that delivers its rule 5 — so it is checked first and named as itself.
  const group = /^(New|Fixed|For operators):\s/.exec(body)?.[1];
  if (!group) {
    out.push({
      line: bodyStart + 1,
      rule: `a note opens with its group — one of ${GROUPS.map((g) => `\`${g}:\``).join(", ")} — so the page can order them`,
      offending: body.split("\n")[0].slice(0, 80),
    });
  }
  const prose = group ? body.slice(group.length + 2) : body;

  for (let i = 0; i < lines.length; i++) {
    if (i < bodyStart) continue;
    const line = lines[i];
    if (!line.trim()) continue;

    if (/#\d+/.test(line)) add(i, "a reader has no issue tracker to look a number up in", /#\d+/.exec(line)[0]);
    if (/\btracker issue\b/i.test(line)) add(i, "a reader has no issue tracker to look a number up in", "tracker issue");
    for (const m of line.matchAll(/\b[\w.-]+\.(mjs|ts|tsx|json|yml|yaml)\b/g)) {
      add(i, "a file name means nothing to somebody who has never opened this repository", m[0]);
    }
    // A path, judged by WHOSE it is. The reader's own — `~/.config/clearotron/` — is the note's job to
    // give them. Ours is not, and "ours" is wider than this repository's directory names: an absolute
    // path into a server's filesystem is our deployment, not their machine.
    //
    // WHAT COUNTS AS A PATH AT ALL is deliberately narrow, because `and/or` is not one. A token qualifies
    // when it opens with `~`, `/`, `./` or `../`, when its first segment is one of our own directories,
    // or when a segment carries a dot. Ordinary prose with a slash in it does not.
    for (const m of line.matchAll(/(?:^|[\s`(])((?:~|\.{1,2})?\/?[\w.~-]+(?:\/[\w.~-]+)+\/?)/g)) {
      const path = m[1];
      if (/^https?:/.test(path)) continue;
      const segments = path.replace(/^[~./]+/, "").split("/").filter(Boolean);
      const looksLikePath = /^[~./]/.test(path) || sourceDirs.has(segments[0]) || segments.some((x) => x.includes("."));
      if (!looksLikePath) continue;
      if (path.startsWith("~")) continue;                       // the reader's own home
      if (docs.includes(path)) continue;                        // the user documentation shows it
      add(i, "a file path that is ours rather than the reader's means nothing to somebody who has never "
        + "opened this repository", path);
    }
    for (const m of line.matchAll(/--[a-z][a-z0-9-]+/g)) {
      if (!flags.has(m[0])) add(i, "a flag the user documentation never shows is a flag the reader cannot use", m[0]);
    }
    for (const m of line.matchAll(/\bport\s+\d{2,5}\b|\b:\d{4,5}\b/gi)) {
      add(i, "a port number is our deployment detail, not the reader's", m[0].trim());
    }
    for (const w of INTERNAL_WORDS) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(line)) add(i, `\`${w}\` is our word, not the reader's`, w);
    }
    // `provenance` is allowed only where the sentence glosses it.
    if (/\bprovenance\b/i.test(line) && !/signed record/i.test(line)) {
      add(i, "`provenance` is allowed only when the sentence glosses it as a signed record", "provenance");
    }
    for (const p of EMPTY_PHRASES) {
      if (new RegExp(`\\b${p}\\b`, "i").test(line)) add(i, `"${p}" says nothing — say what happens instead`, p);
    }
  }

  for (const s of sentencesIn(prose)) {
    if (words(s) > MAX_WORDS) {
      const at = lines.findIndex((l, i) => i >= bodyStart && l.includes(s.slice(0, 30)));
      out.push({
        line: (at < 0 ? bodyStart : at) + 1,
        rule: `a sentence runs to at most ${MAX_WORDS} words; this one is ${words(s)}`,
        offending: s.slice(0, 90) + (s.length > 90 ? "…" : ""),
      });
    }
  }
  return out;
}

/** The notes a run should read: everything under `.changeset/`, consumed ones included. */
export function notePaths(root = ROOT) {
  const dir = join(root, ".changeset");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "pre") {
      for (const f of readdirSync(join(dir, "pre"))) if (f.endsWith(".md")) out.push(join(dir, "pre", f));
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      out.push(join(dir, entry.name));
    }
  }
  return out.sort();
}

function main() {
  const named = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const paths = named.length ? named : notePaths();
  // A LINT OVER NOTHING EXITS 0, and that is the shape where the glob broke and every note went
  // unread. Named paths are the caller's business; a discovered set that is empty is not a pass.
  if (!named.length && !paths.length) {
    console.log("release-notes-lint: no release notes to read.");
    return;
  }
  const flags = documentedFlags();
  let bad = 0;
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`release-notes-lint: ${p} does not exist. Refusing rather than reporting a file it never read.`);
      process.exitCode = 2;
      return;
    }
    const found = findings(readFileSync(p, "utf8"), { file: basename(p), flags });
    for (const f of found) {
      console.error(`${p}:${f.line}  ${f.rule}\n    ${f.offending}`);
      bad += 1;
    }
  }
  if (bad) {
    console.error(`\nrelease-notes-lint: ${bad} thing(s) a reader of the releases page cannot use. `
      + "The contract and its examples are in .changeset/README.md.");
    process.exitCode = 1;
    return;
  }
  console.log(`release-notes-lint: ${paths.length} note(s) written for the person who reads them.`);
}

if (isEntrypoint(import.meta.url)) main();
