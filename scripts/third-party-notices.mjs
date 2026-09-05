// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// third-party-notices.mjs —. Generates THIRD-PARTY-NOTICES.md from the installed production tree.
//
// WHY IT IS GENERATED AND NOT WRITTEN. An attributions file that is maintained by hand is wrong the
// first time a dependency moves, and nothing says so — the failure is silent and the consequence is a
// licence obligation quietly unmet. This reads the tree npm actually installs and is checked in CI, so
// the file cannot drift from the dependencies it claims to describe.
//
// WHAT IT COVERS. The PRODUCTION tree only (`npm ls --omit=dev`): a devDependency is not distributed,
// so it carries no attribution obligation for anyone who installs this. Our own workspaces and the
// vendored `buffers` are excluded — they are this repository, under its own licence.
//
// PERMISSIVE LICENCES REQUIRE THE NOTICE, NOT JUST THE NAME. MIT, BSD and ISC all oblige a distributor
// to reproduce the copyright and permission notice. So where a package ships a licence file, its text
// is included verbatim. Where it ships none, that ABSENCE IS RECORDED IN THE FILE rather than skipped:
// a package with a declared licence and no text is a smaller problem than one with neither, and a
// reader deciding whether we are compliant needs to see both.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently
import { nonEmpty } from "../shared/vacuous-pass.mjs";        // — an empty row set would confirm compliance over nothing

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = join(ROOT, "THIRD-PARTY-NOTICES.md");
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.\w+)?$/i;
// Ours, under this repository's own licence — an attributions file that credited us to ourselves would
// be noise. READ from package.json rather than listed here: a hand-written list of our own workspace
// names was wrong the first time I ran it (it guessed `trademark-mcp-server` and `oauth-mcp-bridge`;
// the real names are `trademark-artifacts-mcp` and `trademark-oauth-mcp-bridge`), and the failure was
// silent — two of our own packages listed as third-party attributions.
function ourNames(root) {
  const names = new Set(["buffers"]);   // the clean-room replacement this issue's other row landed
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  names.add(rootPkg.name);
  for (const w of rootPkg.workspaces ?? []) {
    try { names.add(JSON.parse(readFileSync(join(root, w, "package.json"), "utf8")).name); } catch { /* not a workspace */ }
  }
  return names;
}

const licenceOf = (p) => {
  const l = p.license ?? p.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => x?.type ?? x).filter(Boolean).join(" OR ");
  if (l && typeof l === "object") return l.type ?? null;
  return null;
};
const repoOf = (p) => {
  const r = p.repository;
  const u = typeof r === "string" ? r : r?.url;
  return u ? String(u).replace(/^git\+/, "").replace(/\.git$/, "") : null;
};

/**
 * `npm ls --json`, tolerating a NON-ZERO EXIT THAT STILL PRODUCED THE TREE. PURE given `run`.
 *
 * `npm ls` exits non-zero for any tree problem — `ELSPROBLEMS` — and an INVALID resolution is one.
 * It still writes the complete dependency tree to stdout; only the status is unhappy. `execFileSync`
 * throws on the status, so this file died before comparing anything.
 *
 * Measured, 2026-08-23, on a cold install of main:
 *
 *     npm error code ELSPROBLEMS
 *     npm error invalid: uuid@11.1.1 …/node_modules/uuid
 *
 * `overrides` pins uuid to ^11.1.1 while `exceljs` declares ^8.3.2, so the resolution is
 * deliberate and npm calls it invalid anyway. That is a legitimate state for this repo and it must not
 * take the attributions file down with it — the licence obligation this script exists to meet does not
 * depend on every range being satisfiable.
 *
 * IT DOES NOT SWALLOW FAILURE. The output has to parse AND look like a tree; anything else rethrows,
 * so npm genuinely falling over is still a failure. The alternative — a bare try/catch returning `{}` —
 * would report an EMPTY production tree as a clean bill of health, which is this repo's favourite bug.
 */
export function npmTree(root = ROOT, run = execFileSync) {
  const opts = { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 };
  let out;
  try {
    out = run("npm", ["ls", "--omit=dev", "--all", "--json"], opts);
  } catch (e) {
    out = e?.stdout;
    if (typeof out !== "string" || !out.trim()) throw e;
    let parsed;
    try { parsed = JSON.parse(out); } catch { throw e; }
    if (!parsed || typeof parsed !== "object" || !parsed.dependencies) throw e;
  }
  return JSON.parse(out);
}

// ── DECLARED, NOT TOLERATED ──────────────────────────────────────────────────────────────────
//
// `npmTree` above reads the tree even when npm exits non-zero, which is what stopped a deliberate
// resolution from taking this guard down. On its own it accepts ANY problem whose tree still parses —
// and the next one will not be a deliberate pin. A package that failed to install, a workspace that
// stopped resolving: each of those leaves a parseable tree too, and the attributions would then be
// generated from a tree nobody looked at, which is a licence obligation quietly unmet.
//
// So each accepted problem is NAMED with its reason and anything else throws. And the check runs BOTH
// WAYS: a declaration matching nothing npm reports fails as stale, because an excuse that outlives its
// condition is how a declared exception becomes a permanent blind spot. That pair is publication-scrub's
// shape, deliberately — one direction alone rots.
export const DECLARED_LS_PROBLEMS = [
  {
    match: /^invalid: uuid@/,
    // THE NEAR-MISS CONTROL ( /, one ruling). A canonical problem ONE STEP BROADER than what
    // this declaration was written for, asserted NOT to match. Widening the matcher to `/^invalid:/`
    // leaves the suite green today — not stale, not empty, and silently accepting every future invalid
    // resolution in the tree. Both directions already checked that the exception still APPLIES; neither
    // checked that it still applies NARROWLY, and that is the hole.
    //
    // It is a FIELD rather than one hand-written arm so a declaration added later cannot skip it: the
    // guard walks this table, and an entry without a `nearMiss` fails by name.
    nearMiss: "invalid: other@1.2.3",
    reason:
      'npm reports uuid as invalid because #1722 pins it through the root `overrides` while #1725 '
      + 'bundles `exceljs`, whose own declared range it no longer satisfies. Isolated with the installed '
      + 'tree held constant and only the manifest swapped underneath it, `bundleDependencies` is the '
      + 'trigger. The resolution is what #1722 intended and the bundle carries it: `npm pack` puts '
      + 'node_modules/uuid inside the tarball, and verify-publishable installs and runs it.',
  },
];

/** Problems npm reported that nothing here declares. PURE. */
export function undeclaredProblems(problems, declared = DECLARED_LS_PROBLEMS) {
  return (problems ?? []).map(String).filter((p) => !declared.some((d) => d.match.test(p)));
}

/**
 * Declarations whose NEAR-MISS matches — i.e. that now accept more than they were written for. PURE.
 *
 * The third direction. `undeclaredProblems` asks whether a real problem is covered; `staleDeclarations`
 * asks whether a declaration still applies at all. Neither asks whether it applies NARROWLY, so widening
 * `/^invalid: uuid@/` to `/^invalid:/` passes both and turns a named exception into a permanent hole.
 */
export function overbroadDeclarations(declared = DECLARED_LS_PROBLEMS) {
  return (declared ?? [])
    .filter((d) => typeof d.nearMiss !== "string" || d.match.test(d.nearMiss))
    .map((d) => ({ match: d.match.source, nearMiss: d.nearMiss ?? null }));
}

/** Declarations matching nothing npm reported — the excuse outliving its condition. PURE. */
export function staleDeclarations(problems, declared = DECLARED_LS_PROBLEMS) {
  const reported = (problems ?? []).map(String);
  return declared.filter((d) => !reported.some((p) => d.match.test(p))).map((d) => d.match.source);
}

/** Every production package, deduped by name@version, with what its own metadata says. */

/**
 * The directory a dependency is actually installed in: npm's own `path` when it gave one, then the root
 * `node_modules`, then each workspace's. Returns the first that carries a package.json, and the root
 * candidate when none does — so the caller's read fails exactly as it did before rather than silently
 * resolving somewhere unrelated.
 */
function resolveInstalled(root, name, path) {
  const candidates = [];
  if (path) candidates.push(path);
  candidates.push(join(root, "node_modules", name));
  try {
    const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const w of rootPkg.workspaces ?? []) candidates.push(join(root, w, "node_modules", name));
  } catch { /* no workspaces to search */ }
  for (const c of candidates) {
    try { if (existsSync(join(c, "package.json"))) return c; } catch { /* next */ }
  }
  return join(root, "node_modules", name);
}

export function collect(root = ROOT, tree = npmTree(root)) {
  const overbroad = overbroadDeclarations();
  if (overbroad.length) {
    throw new Error(`${overbroad.length} declaration(s) in DECLARED_LS_PROBLEMS accept more than they were `
      + "written for, so a problem nobody has looked at would pass as declared:\n  "
      + overbroad.map((o) => `/${o.match}/ matches its own near-miss ${JSON.stringify(o.nearMiss)}`).join("\n  ")
      + "\n\nNarrow the matcher, or give the entry a `nearMiss` one step broader that it must NOT match.");
  }
  const undeclared = undeclaredProblems(tree.problems);
  if (undeclared.length) {
    throw new Error(`npm ls reports ${undeclared.length} problem(s) nothing declares, so the tree behind `
      + "this file has not been looked at:\n  " + undeclared.join("\n  ")
      + "\n\nFix the tree, or declare it in DECLARED_LS_PROBLEMS with the reason it is allowed.");
  }
  // ── ONE PACKAGE, SEVERAL NODES, AND ONLY ONE OF THEM CARRIES THE CHILDREN ──────────────────────
  //
  // This walk used to dedupe the TRAVERSAL and the ROWS with one `seen` check: the first time a
  // `name@version` appeared it was recorded and descended into, and every later occurrence was
  // skipped. npm's tree does not cooperate with that. A hoisted package appears more than once, and
  // the occurrences are NOT equivalent — the deduped ones are stubs with no `dependencies` at all,
  // and which one you meet first is an ordering accident.
  //
  // Measured on this tree (tracker issue 115): `ajv@8.20.0` appears twice under
  // `@modelcontextprotocol/sdk` — first as a stub with 0 children, then with 4. The stub was met
  // first, so `ajv` got its row and its ENTIRE SUBTREE was never walked. `fast-uri` is one of those
  // four children, which is how a production dependency came to ship with no licence recorded.
  //
  // So the omission was never about `fast-uri`: it is every transitive dependency of any package
  // whose stub occurrence happens to sort first. Rows still dedupe by `name@version` — a package is
  // attributed once — but DESCENT now follows the occurrence that actually has children.
  const seen = new Map();
  const descended = new Set();
  (function walk(node) {
    for (const [name, d] of Object.entries(node.dependencies ?? {})) {
      const key = `${name}@${d.version}`;
      // Prefer an occurrence that carries a real path: a stub's is often absent, and the path is
      // where the licence text is read from.
      const prior = seen.get(key);
      if (!prior) seen.set(key, { name, version: d.version, path: d.path ?? null });
      else if (!prior.path && d.path) prior.path = d.path;
      // Descend once per package, through the occurrence that has children. `descended` is also the
      // cycle guard — npm can and does emit cyclic trees.
      if (Object.keys(d.dependencies ?? {}).length && !descended.has(key)) { descended.add(key); walk(d); }
    }
  })(tree);

  const OURS = ourNames(root);
  const rows = [];
  for (const { name, version, path } of [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (OURS.has(name)) continue;
    // NOT INSTALLED — an unmet or optional peer that npm lists with neither a version nor a path.
    // It is not distributed, so it carries no attribution obligation; recorded rather than dropped,
    // because a name silently missing from this file is indistinguishable from one never declared.
    if (!version) { rows.push({ name, version: null, installed: false, licence: null, repository: null, textFile: null, text: null }); continue; }
    // WHERE A PACKAGE ACTUALLY IS, not where the root would put it.
    //
    // `npm ls` reports a `path` for most rows and NONE for some — a workspace-local install is one such
    // case. The fallback used to be the root `node_modules` alone, so a dependency installed under a
    // WORKSPACE resolved to a directory that does not exist: no package.json, no licence field, no
    // LICENCE file, and the arm below then reported a perfectly-licensed package as shipping without one.
    //
    // Measured when React moved: react@19.2.8, react-dom@19.2.8 and scheduler@0.27.0 all declare
    // `"license": "MIT"` and ship a LICENSE file, and all three were reported unlicensed purely because
    // npm gave no path and they live in portal-ui/node_modules. That is an ABSENCE read as a finding, on
    // the one guard where a false positive is most expensive: it accuses a dependency of being all
    // rights reserved against a repository that ships AGPL-3.0-only.
    //
    // ✕ THIS DOES NOT WEAKEN THE GUARD. It only looks in more of the places a package is legitimately
    // installed. A package that is genuinely unlicensed is still found and still fails, because it is
    // found and read — the arm's own fixture (`buffers@0.1.1`, no field and no file) is unaffected.
    const dir = resolveInstalled(root, name, path);
    let pkg = {};
    try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { /* recorded below */ }
    let text = null, textFile = null;
    try {
      const f = readdirSync(dir).find((n) => LICENCE_FILE.test(n));
      if (f) { textFile = f; text = readFileSync(join(dir, f), "utf8").trim(); }
    } catch { /* recorded below */ }
    rows.push({ name, version, installed: true, licence: licenceOf(pkg), repository: repoOf(pkg), textFile, text });
  }
  // — `rows: ` makes "no production dependency ships without a licence" pass over nothing, and
  // renders an attributions file claiming the product bundles nothing. Neither is an answer.
  return nonEmpty(rows, "collect(): the production dependency rows npm resolved");
}

export function render(allRows) {
  const notInstalled = allRows.filter((r) => !r.installed);
  const rows = allRows.filter((r) => r.installed);
  const unlicensed = rows.filter((r) => !r.licence);
  const noText = rows.filter((r) => r.licence && !r.text);
  const head = [
    "# Third-party notices",
    "",
    "This product bundles the packages below. Each is listed with the licence its own metadata declares,",
    "and with that licence's text where the package ships one — MIT, BSD and ISC all require a",
    "distributor to reproduce the copyright and permission notice, so reproducing it is the point of this",
    "file rather than a courtesy.",
    "",
    "**Generated — do not edit.** `node scripts/third-party-notices.mjs` rewrites it from the installed",
    "production tree; `--check` fails when it no longer matches. Development dependencies are excluded:",
    "they are not distributed, so they carry no obligation for anyone who installs this.",
    "",
    `${rows.length} packages.`,
    "",
  ];
  if (unlicensed.length) head.push(
    "> **Packages declaring no licence:** " + unlicensed.map((r) => `\`${r.name}@${r.version}\``).join(", ") + ".",
    "> An unlicensed package is not permissively licensed; it is all rights reserved by default. Listed",
    "> here rather than omitted, because an attributions file that silently drops the hard cases is worse",
    "> than none.", "");
  if (notInstalled.length) head.push(
    "> **Declared but NOT INSTALLED, so not distributed and not attributed below:** "
      + notInstalled.map((r) => `\`${r.name}\``).join(", ") + ".",
    "> npm lists these with no version and no path — an unmet or optional peer. Recorded because a name",
    "> silently missing from this file reads the same as one that was never declared.", "");
  if (noText.length) head.push(
    "> **Declaring a licence but shipping no licence file:** " + noText.map((r) => `\`${r.name}@${r.version}\``).join(", ") + ".",
    "> The declaration is reproduced below; there is no notice text to reproduce with it.", "");

  const body = rows.map((r) => {
    const lines = [`## ${r.name}@${r.version}`, "",
      `- **Licence declared:** ${r.licence ? `\`${r.licence}\`` : "**none**"}`];
    if (r.repository) lines.push(`- **Repository:** ${r.repository}`);
    lines.push(`- **Licence file:** ${r.textFile ? `\`${r.textFile}\`` : "none shipped"}`, "");
    if (r.text) lines.push("```", r.text, "```", "");
    return lines.join("\n");
  });
  return [...head, "---", "", ...body].join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

if (isEntrypoint(import.meta.url)) {
  const check = process.argv.includes("--check");
  const next = render(collect());
  if (!check) { writeFileSync(OUTPUT, next); console.log(`third-party-notices: wrote ${OUTPUT}`); process.exit(0); }
  const now = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : null;
  if (now === next) { console.log("third-party-notices: THIRD-PARTY-NOTICES.md matches the installed production tree."); process.exit(0); }
  // ── Refs tracker issue 2073 — THE REFUSAL SAYS HOW TO FIX IT, INCLUDING THE HALF THAT IS FORGOTTEN ──
  //
  // "regenerate with: <script>" was true and insufficient. What reds CI is a PRODUCTION-DEPENDENCY BUMP
  // whose regenerated notices file was not COMMITTED WITH IT, and the committing half is the half that
  // gets missed: a contributor runs the regenerate, sees the check pass locally, pushes the bump without
  // the file, and CI reds on a message that reads as if they had not run anything. It bit CI twice on two
  // heads of one dependabot pull request before anyone opened the failure, and the remedy lived only in a
  // stood-down lane's handover comment.
  console.error("third-party-notices: THIRD-PARTY-NOTICES.md is STALE"
    + (now === null ? " — the file is missing entirely." : " — the production tree has moved under it."));
  console.error("");
  console.error("  This is what a production-dependency change looks like here: the notices file is");
  console.error("  generated from the installed production tree, so moving a dependency moves it too.");
  console.error("");
  console.error("  To fix, from the repository root:");
  console.error("      npm run notices");
  console.error("      git add THIRD-PARTY-NOTICES.md");
  console.error("");
  console.error("  COMMIT IT WITH THE DEPENDENCY CHANGE. Regenerating without committing the file is the");
  console.error("  commonest way to meet this message twice: the check passes locally and CI still reds,");
  console.error("  because CI reads what you pushed.");
  process.exit(1);
}
