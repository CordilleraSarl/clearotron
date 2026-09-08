// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// no-test-account-reaches-the-package.mjs — the last gate before a package is published.
//
//   node scripts/no-test-account-reaches-the-package.mjs <tarball.tgz>
//
// TWO THINGS MUST NOT BE IN THE PUBLISHED BYTES: a file that exists only to be tested against, and one
// of the three invented account names the fixtures use. Both shipped in every published version.
//
// WHY THE CHECKS ALREADY HERE COULD NOT CATCH IT:
//
//   · `files[]` excludes PATHS, and it did its job — the fixture profiles and recipe directories are
//     genuinely absent. The names were in about sixty OTHER files, written inside documents about
//     something else. A path list cannot exclude a mention.
//   · `verify-publishable` proves a packaged install WORKS — install it with no checkout and type the
//     verbs. It reads nothing about what the bytes say, by design.
//
// So this asks the one question neither asks, of the one artifact that reaches the world.
//
// THE TARBALL, NOT THE TREE. Every cheaper check answers about the working copy, and the working copy is
// not what is published — `files[]`, `.npmignore`, the prepack step and the bundled dependencies all sit
// between them. The packed bytes are the only thing that cannot be wrong about itself.
//
// ── WHAT THIS DOES NOT COVER, SAID HERE RATHER THAN DISCOVERED ─────────────────────────────────────
//
// IT DOES NOT LOOK FOR CUSTOMER NAMES. It reads one short list of invented names, in the open, in this
// repository. Real customer names are checked before a merge instead, where a list nobody may publish
// can live privately. That is a deliberate split and it leaves a gap worth knowing: the packed bytes
// include bundled dependencies that are not tracked files, and the pre-merge check reads tracked files.
// Nothing plausible puts a customer name in a third-party package, but this gate is not what would stop
// it.
//
// IT CANNOT READ A ROLE. A name list cannot tell an account from an ordinary use of the same word. One
// of the three IS an ordinary word, and the exemption for it is content-keyed and lives beside the list
// in `test-account-names.mjs` — read that file before adding another.
//
// FAIL CLOSED, AND SAY WHICH FAILURE IT IS. This exits 2 when it could not look — no tarball, or a list
// that will not load or has nothing in it. 1 means something was found. 0 means the bytes were read and
// carry neither. An empty list is a could-not-look and never a clean pass: it would clear everything.
import * as nodeFs from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { TEST_ACCOUNT_NAMES, ALLOWED_CONTEXTS } from "./test-account-names.mjs";

export const EXIT_CLEAN = 0, EXIT_FOUND = 1, EXIT_COULD_NOT_LOOK = 2;

/**
 * Validate the list this check reads. PURE.
 *
 * A BLANK OR EMPTY LIST IS A CHECK THAT CANNOT LOOK, not a check with nothing to find. Escaped and
 * matched, a blank entry matches every line — measured on the merge gate, where one blank cleared every
 * body. Neither state may be silent, so both are refused here rather than reported as clean.
 */
export function namesFor(list) {
  if (!Array.isArray(list)) return { error: "the name list is not a list", names: [] };
  if (!list.length) return { error: "the name list is empty, and an empty list clears everything", names: [] };
  if (list.some((n) => !String(n ?? "").trim())) return { error: "the name list carries a blank entry, which matches every line", names: [] };
  return { error: null, names: [...new Set(list.map((n) => String(n).trim()))] };
}

/**
 * Every hit, as `{ name, path, line, text }`. PURE, and the entries are injected so a test drives it
 * without a tarball.
 *
 * CASE-INSENSITIVE AND WHOLE-WORD, and the two pull opposite ways on purpose. Whole-word so an ordinary
 * word inside a longer one is not a hit. Case-insensitive because a name lowercased in a path or an
 * identifier is the same disclosure as the capitalised one — measured: most of the leak was lowercase,
 * in paths and identifiers rather than prose.
 */
export function scanEntries(entries, names, allowed = ALLOWED_CONTEXTS) {
  const res = names.map((n) => ({ n, re: new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }));
  const ctx = (allowed ?? []).map((s) => String(s).toLowerCase());
  // AN EXEMPTION KEYED ON WHAT THE LINE SAYS, NOT ON WHERE IT SITS. Exempting the file would clear every
  // other line in it, so a genuine leak into the same file would ride out behind a legitimate one.
  const exempt = (line) => ctx.some((c) => String(line).toLowerCase().includes(c));
  const hits = [];
  for (const { path, text } of entries ?? []) {
    // THE MANIFEST NAMES WHAT IT EXCLUDES, AND THAT IS NOT A MENTION. `package.json`'s `files[]` carries
    // `"!driver/profiles/<name>.json"` lines whose whole job is to keep those files out of the package.
    // Reading them as occurrences makes the gate refuse the very rule that removes them. Scoped to
    // exclusion entries in the manifest, not to the file: a name anywhere else there is still a hit.
    const isManifest = path === "package.json" || path.endsWith("/package.json");
    const lines = String(text ?? "").split("\n")
      .filter((l) => !(isManifest && /^\s*"!/.test(l)));
    for (const { n, re } of res) {
      if (re.test(path)) { hits.push({ name: n, path, line: 0, text: "(in the path itself)" }); continue; }
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i]) || exempt(lines[i])) continue;
        hits.push({ name: n, path, line: i + 1, text: lines[i].trim().slice(0, 100) });
        break;
      }
    }
  }
  return hits;
}

/**
 * OUR members that exist only to be tested against. PURE.
 *
 * The SECOND clause, and it fails for a different reason from the first: a fixture whose body never
 * writes an account name is invisible to the name scan, and is still a file no installer can use.
 *
 * BUNDLED DEPENDENCIES ARE NOT OURS AND ARE NOT EXCLUDABLE. `files[]` does not filter a bundled
 * dependency — npm packs each one's own published tree entire — so a third-party package shipping its
 * own `test/` directory is not something this repository can fix, and refusing on it would refuse every
 * release forever. Measured on the packed bytes, 2026-09-08: 71 such members, every one under
 * `node_modules/` and not one of ours. Scoped rather than dropped, because the clause still has to
 * catch a fixture of ours that the manifest missed.
 */
export function fixtureFilesIn(entries) {
  const bad = /(^|\/)(test|tests|fixtures|__fixtures__|bench)\//i;
  const ours = (p) => !/(^|\/)node_modules\//.test(p);
  return (entries ?? []).map((e) => e.path).filter((p) => ours(p) && (bad.test(p) || /\.test\.(mjs|js|ts|tsx)$/i.test(p)));
}

/**
 * Files the package is USELESS WITHOUT, and the reason this is a positive check.
 *
 * Every other assertion here is an absence — no fixture, no account name — and an absence check cannot
 * tell a clean package from a package that is missing half of itself. These four are what a fresh
 * install rates its first clearance under: the house risk framework and its manifest, the house worked
 * examples, and the Generic profile.
 *
 * THEY SHIP TODAY BY ACCIDENT OF PATTERN SHAPE, which is why they are asserted rather than assumed. The
 * manifest excludes `risk-framework-*` and `worked-examples-*` — a hyphen — and the house defaults carry
 * a dot, so they survive by not matching rather than by being chosen. They are now re-included by name
 * as well; this check is what refuses if a future pattern edit drops them anyway. A package that ships
 * no framework rates nothing, and it would pass every other line in this file.
 */
export const MUST_SHIP = Object.freeze([
  "driver/skills/prelim-search/risk-framework.md",
  "driver/skills/prelim-search/risk-framework.manifest.json",
  "driver/skills/prelim-search/worked-examples.md",
  "driver/profiles/generic.json",
]);

/** Which of `MUST_SHIP` the packed member list does not carry. PURE. */
export function missingFrom(entries, required = MUST_SHIP) {
  const paths = (entries ?? []).map((e) => String(e.path));
  return required.filter((want) => !paths.some((p) => p === want || p.endsWith(`/${want}`)));
}

/**
 * The tarball's entries, extracted ONCE.
 *
 * The first version read each member with its own `tar -xzOf`, which is one decompression per file —
 * about ten minutes on a package of this size. A publish gate that slow is a publish gate somebody
 * routes around, so the cost is part of whether it works rather than a detail of how.
 */
export function entriesOf(tgz, opts = {}) {
  const { mkdtempSync, readFileSync: rf, readdirSync, statSync, rmSync } = opts.fs ?? nodeFs;
  const exec = opts.run ?? ((...a) => execFileSync("tar", a, { encoding: "utf8", maxBuffer: 1e9 }));
  const dir = mkdtempSync(join(tmpdir(), "pkg-scan-"));
  try {
    exec("-xzf", tgz, "-C", dir);
    const out = [];
    const walk = (d, rel) => {
      for (const name of readdirSync(d)) {
        const abs = join(d, name), r = rel ? `${rel}/${name}` : name;
        if (statSync(abs).isDirectory()) { walk(abs, r); continue; }
        let text = "";
        try { text = rf(abs, "utf8"); } catch { text = ""; }   // binary or unreadable: the PATH is still scanned
        out.push({ path: r, text });
      }
    };
    walk(dir, "");
    return out;
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the caller is exiting anyway */ } }
}

function main(argv = process.argv.slice(2)) {
  const tgz = argv.find((a) => a.endsWith(".tgz"));
  if (!tgz || !existsSync(tgz)) {
    console.error(`no-test-account: no tarball to read${tgz ? ` at ${tgz}` : ""}. That is this check failing to look, not a clean package.`);
    return EXIT_COULD_NOT_LOOK;
  }
  const { error, names } = namesFor(TEST_ACCOUNT_NAMES);
  if (error) {
    console.error(`no-test-account: ${error}.`);
    console.error("  The list is scripts/test-account-names.mjs. This is a could-not-look, not a pass —");
    console.error("  nothing was judged.");
    return EXIT_COULD_NOT_LOOK;
  }
  const entries = entriesOf(tgz);
  const hits = scanEntries(entries, names);
  const fixtures = fixtureFilesIn(entries);
  const missing = missingFrom(entries);
  console.log(`no-test-account: read ${entries.length} member(s) of ${tgz} against ${names.length} name(s)`);
  if (!hits.length && !fixtures.length && !missing.length) return EXIT_CLEAN;
  if (missing.length) {
    console.error(`\nREFUSED — ${missing.length} file(s) a fresh install cannot rate a clearance without:`);
    for (const m of missing) console.error(`  ${m}`);
    console.error("  These are re-included by name in `files[]`. If an exclusion pattern was widened, it");
    console.error("  caught the house default as well as the fixtures it was aimed at.");
  }
  if (fixtures.length) {
    console.error(`\nREFUSED — ${fixtures.length} member(s) exist only to be tested against:`);
    for (const p of fixtures.slice(0, 10)) console.error(`  ${p}`);
  }
  if (hits.length) {
    const byName = new Map();
    for (const h of hits) byName.set(h.name, (byName.get(h.name) ?? 0) + 1);
    console.error(`\nREFUSED — the bytes about to be published name ${byName.size} test account(s):`);
    for (const [n, c] of byName) console.error(`  ${n}: ${c} member(s)`);
    // TEN DISTINCT PLACES, not ten hits. Three names on one line is three hits, and a list that spends
    // its ten slots repeating one line tells a reader far less than it appears to.
    const seen = new Set(), shown = [];
    for (const h of hits) {
      const where = `${h.path}${h.line ? `:${h.line}` : ""}`;
      if (seen.has(where)) continue;
      seen.add(where); shown.push({ ...h, where });
      if (shown.length === 10) break;
    }
    console.error(`\n${hits.length} hit(s). The first ${shown.length} distinct place(s):`);
    for (const h of shown) console.error(`  ${h.where}  [${h.name}]  ${h.text}`);
  }
  console.error("\nThese names are invented and belong in the repository; what they must not do is reach an");
  console.error("install, where one would stand as an account beside the house default. Exclude the file in");
  console.error("`files[]` if it is a fixture, or reword the mention if it is prose. If the occurrence is an");
  console.error("ordinary use of the word rather than an account, add it to ALLOWED_CONTEXTS with the reason.");
  return EXIT_FOUND;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
