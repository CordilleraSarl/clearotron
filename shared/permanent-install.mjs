// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHERE THIS PROGRAM LIVES, AND WHY NEVER IN NPX'S CACHE.
//
// `npx clearotron install` runs the package from npm's cache, under `_npx/<hash>/`. That directory is
// npm's, not ours: a later `npx clearotron@<newer>` unpacks somewhere else, and a cache clean deletes it.
// Everything the install wired to its own directory went with it — the `clearotron` launcher, and the
// connect line an assistant was registered with — so an assistant kept launching the old server after an
// update, and lost Clearotron without a word after a clean. Owner ruling, 2026-09-11: an install run from
// npx puts the program in a permanent place it owns, the one `npm install -g` would use, and points
// everything there.
//
// THE PLACE IS THE PREFIX `~/.local`. npm puts the package at `~/.local/lib/node_modules/clearotron` and
// its executable in `~/.local/bin`, the directory the launcher already goes in. It needs no root, and it
// is the layout `invocationForm` already recognises as a global install.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globalBinDirFrom } from "./invocation.mjs";

/** The root of THIS install — `<root>/shared/permanent-install.mjs` is this file. */
export const INSTALL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** npx materialises a package under `_npx/` in npm's cache, and nothing else this runs from does. */
export function inNpxCache(dir = INSTALL_DIR) {
  return /[\\/]_npx[\\/]/.test(String(dir ?? ""));
}

/** The prefix an install run from npx moves to. `null` when the environment names no home. */
export function permanentPrefix(env = process.env) {
  const home = String(env?.HOME ?? "").trim();
  return home ? join(home, ".local") : null;
}

/** Where npm puts this package under a prefix: the layout `globalBinDirFrom` reads back. */
export function packageRootUnder(prefix) {
  return join(prefix, "lib", "node_modules", "clearotron");
}

/** The version this install is, from its own manifest. `null` when that cannot be read. */
export function ownVersion(installDir = INSTALL_DIR, read = readFileSync) {
  try { return JSON.parse(read(join(installDir, "package.json"), "utf8")).version ?? null; } catch { return null; }
}

/**
 * The npm dist-tag a version was published under: `0.3.0-beta.5` came from `beta`, `0.3.0` from `latest`.
 * An update follows the channel the install came from, so a verb that means "newer" never moves a beta
 * install onto the stable line, or the reverse.
 */
export function channelOf(version) {
  const pre = /^\d+\.\d+\.\d+-([A-Za-z]+)/.exec(String(version ?? ""))?.[1];
  return pre ? pre.toLowerCase() : "latest";
}

/**
 * What `install` does first when it runs from npx. PURE given its inputs.
 *
 * `null` when there is nothing to move, because this install is not in npx's cache. Otherwise a plan, or
 * `{ skip }` naming why the move cannot be made here: Windows, where no launcher is written either; no
 * home; or a version that cannot be read, since installing some other version would be a silent upgrade.
 */
export function relocationPlan({ installDir = INSTALL_DIR, env = process.env, platform = process.platform, version = ownVersion(installDir) } = {}) {
  if (!inNpxCache(installDir)) return null;
  if (platform === "win32") return { skip: "windows" };
  const prefix = permanentPrefix(env);
  if (!prefix) return { skip: "no-home" };
  if (!version) return { skip: "no-version" };
  const root = packageRootUnder(prefix);
  return {
    prefix, root, version,
    entry: join(root, "bin", "clearotron.mjs"),
    // --prefer-offline: npx has just fetched exactly this version, so npm's cache already holds it.
    npmArgs: ["install", "--global", "--prefix", prefix, "--prefer-offline", "--no-fund", "--no-audit", `clearotron@${version}`],
  };
}

/**
 * Semver order, a prerelease below its release: 0.3.0-beta.5 < 0.3.0-beta.10 < 0.3.0 < 0.3.1. Negative,
 * zero or positive as `a` sorts before, with or after `b`; `null` when either cannot be read as a version.
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? "").trim());
    return m ? { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] } : null;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * WHICH PUBLISHED VERSION AN UPDATE INSTALLS. PURE given the dist-tags npm reports.
 *
 * A beta install follows `beta` AND `latest`, and takes whichever is newer. Following `beta` alone left
 * every beta tester on the last beta once the release went to `latest`, because `beta` is not moved on
 * a stable release. A stable install follows `latest` only, so an update never moves it onto a
 * prerelease. The exact version is installed, so npm cannot resolve the tag to something else between
 * this read and the install.
 *
 * `current` when nothing published is newer than the running version. Tags that cannot be read fall back
 * to the channel's own tag, with `unread` set so the caller can say so.
 */
export function updateTarget({ version, distTags }) {
  const channel = channelOf(version);
  let best = null;
  for (const tag of channel === "latest" ? ["latest"] : [channel, "latest"]) {
    const v = distTags?.[tag];
    if (compareVersions(v, v) !== 0) continue;
    if (!best || compareVersions(v, best.version) > 0) best = { tag, version: v };
  }
  if (!best) return { tag: channel, version: null, spec: channel, current: false, unread: true };
  const newer = compareVersions(best.version, version);
  return { ...best, spec: best.version, current: newer !== null && newer <= 0, unread: false };
}

/** npm's dist-tags for the package, e.g. `{ latest: "0.3.0", beta: "0.3.0-beta.5" }`. `null` when npm cannot answer. */
export function readDistTags(run = spawnSync) {
  const r = run("npm", ["view", "clearotron", "dist-tags", "--json"], { encoding: "utf8", timeout: 60_000 });
  if (r.error || r.status !== 0) return null;
  try {
    const tags = JSON.parse(r.stdout);
    return tags && typeof tags === "object" && !Array.isArray(tags) ? tags : null;
  } catch { return null; }
}

/**
 * How a packaged install updates itself: the same npm command, at the prefix it lives under, to the
 * version `updateTarget` picks. `null` for a layout this cannot name — a checkout, npx's cache, or a
 * package that is not under `<prefix>/lib/node_modules` — and npm is not asked anything then.
 */
export function packagedUpdate({ installDir = INSTALL_DIR, version = ownVersion(installDir), distTags } = {}) {
  if (inNpxCache(installDir)) return null;
  const bin = globalBinDirFrom(installDir);
  if (!bin) return null;
  const prefix = dirname(bin);
  const target = updateTarget({ version, distTags: distTags === undefined ? readDistTags() : distTags });
  return {
    prefix, installed: version, ...target,
    npmArgs: ["install", "--global", "--prefix", prefix, "--no-fund", "--no-audit", `clearotron@${target.spec}`],
  };
}

/**
 * The install root a connect line should name. The running root, unless that is npx's cache and the
 * permanent install exists, in which case the permanent one: an assistant registered against the cache
 * loses Clearotron when the cache is cleaned, which is the defect this file exists to end.
 */
export function stableInstallRoot({ installRoot = INSTALL_DIR, env = process.env, exists = existsSync } = {}) {
  if (!inNpxCache(installRoot)) return installRoot;
  const has = (root) => !!root && exists(join(root, "mcp-server", "server.mjs"));
  // A DEMO'S OWN COPY FIRST: it is this version, and it lives inside the demo's base. The demo's children
  // are handed `CLEAROTRON_DEMO=1` and their workspace, `<base>/workspace`, which is how they find it.
  const work = String(env?.CLEAROTRON_WORK_DIR ?? "").trim();
  const demoRoot = env?.CLEAROTRON_DEMO === "1" && work ? packageRootUnder(demoProgramPrefix(dirname(work))) : null;
  if (has(demoRoot)) return demoRoot;
  const prefix = permanentPrefix(env);
  const root = prefix ? packageRootUnder(prefix) : null;
  return has(root) ? root : installRoot;
}

/**
 * WHERE A DEMO RUN FROM NPX KEEPS ITS OWN COPY OF THE PROGRAM: inside the demo's base, never `~/.local`.
 *
 * `npx clearotron demo` ran from npm's cache like `install` did, so the connect line it printed launched
 * the connector from `_npx/<hash>/`, which npm deletes when it cleans up (measured on a published beta,
 * 2026-09-11). The install's answer, a copy under `~/.local`, would leave a trace of the demo outside the
 * demo's directory; this copy lives in `<base>/program`, so removing the demo is still one directory.
 */
export function demoProgramPrefix(base) {
  return join(base, "program");
}

/**
 * What `demo` does about its program. PURE given its inputs. `null` outside npx's cache; `{ skip }` on
 * Windows, where npm's global layout differs, or with an unreadable version; otherwise a plan whose
 * `current` says the copy is already this version, so a second start runs no npm at all.
 */
export function demoProgramPlan({ base, installDir = INSTALL_DIR, platform = process.platform, version = ownVersion(installDir), exists = existsSync, read = readFileSync } = {}) {
  if (!inNpxCache(installDir)) return null;
  if (platform === "win32") return { skip: "windows" };
  if (!version) return { skip: "no-version" };
  const prefix = demoProgramPrefix(base);
  const root = packageRootUnder(prefix);
  const current = exists(join(root, "mcp-server", "server.mjs")) && ownVersion(root, read) === version;
  return {
    prefix, root, version, current,
    npmArgs: ["install", "--global", "--prefix", prefix, "--prefer-offline", "--no-fund", "--no-audit", `clearotron@${version}`],
  };
}

/**
 * Lays the demo's copy down when it is missing or another version, and returns its root; `null` when there
 * is no copy to use (not run from npx, or a copy that could not be made). It never stops the demo: if npm
 * fails, the demo runs from npx's cache as before and says what that costs. `demoProgramPlan` decides;
 * this is the one place that acts on it, for `demo` and for a `start --demo` run from npx.
 */
export function ensureDemoProgram({ base, say, env = process.env, run = spawnSync, exists = existsSync, plan = demoProgramPlan({ base }) }) {
  if (plan?.current) return plan.root;
  if (!plan || plan.skip) return null;
  say(`  program        copying clearotron ${plan.version} into ${plan.prefix}, so the commands below and your assistant's connection survive npm cleaning its cache`);
  // The npm that launched this, when npm says which: no second npm is guessed at.
  const npmCli = env.npm_execpath;
  const opts = { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 180_000 };
  const r = npmCli && exists(npmCli) ? run(process.execPath, [npmCli, ...plan.npmArgs], opts) : run("npm", plan.npmArgs, opts);
  if (r.status === 0 && exists(join(plan.root, "mcp-server", "server.mjs"))) return plan.root;
  const why = r.error ? r.error.message : String(r.stderr ?? "").trim().split("\n").pop() || `npm exited ${r.status}`;
  say(`  program        could not be copied (${why}). The commands and the connect line below run from npm's temporary`);
  say("                 cache, so they stop working when npm cleans it; start the demo again to retry.");
  return null;
}

/**
 * The environment a demo's services get when they run from the demo's copy. What makes their printed
 * commands name the copy is running from it: `invocationPrefix` answers from the running install. npm's
 * marks of an npx arrival (`npm_command=exec` among them) and the npx path the dispatcher hands down
 * describe a process npm started, which the copy is not, so they are taken off, as `install` takes them
 * off when it moves out of the cache.
 */
export function demoProgramEnv(env = process.env) {
  const out = { ...env };
  for (const k of ["npm_command", "npm_lifecycle_event", "npm_execpath", "CLEAROTRON_INVOKED_AS"]) delete out[k];
  return out;
}
