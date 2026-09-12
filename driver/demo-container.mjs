// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT COUNTS AS A FROZEN DEMO — one rule, one file.
//
// `demo/` is a container holding one frozen run per product the engine sells, named by the product's own
// id. Three things in this repository decide whether a child in it is usable, and they answered
// DIFFERENTLY:
//
//   bin/example.mjs          the player a stranger runs — demanded meta.json + run/report.md
//   cut/packed-artifact.mjs  the pack gate — learned the knockout shape only because it refused
//   scripts/pack-publishable.mjs  printed the player's old rule in its refusal message
//
// A knockout demo has NO report.md and never will: for that lane the markdown is an OUTPUT of publishing
// rather than an input to it, and `knockout-findings.json` is what the publisher reads as its source. So
// `demo/knockout-search` shipped — in the git tree AND in the npm tarball, all sixteen files including the
// research payloads its receipts door reads — and the player could not list it, choose it, or default to
// it. `--product knockout-search` exited 1 naming only the other three: the product enumerated three while
// the gate counted four.
//
// The defect was not the predicate. The defect was that the predicate existed in more than one place, so
// teaching one site the knockout shape left the others behind — which is exactly what happened, twice, one
// stage apart. This module is the single answer. `cut/` cannot import it (that directory does not travel
// and this one does), so the pack gate restates the disjunction and its own test pins the two together.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

/** The entry file each lane's publisher reads as its source, in the order a child is probed for one. */
export const ENTRY_FILES = Object.freeze(["report.md", "knockout-findings.json"]);

/** The entry file this child actually carries, or null. NULL IS THE ANSWER "no", never "not looked". */
export function entryFile(dir) {
  for (const f of ENTRY_FILES) if (existsSync(join(dir, "run", f))) return f;
  return null;
}

/** A child is frozen when it carries a manifest AND its lane's entry file. Both, or it is not one. */
export function isFrozen(dir) {
  return existsSync(join(dir, "meta.json")) && entryFile(dir) !== null;
}

/**
 * Every frozen child of a container, by product id, sorted so the default is stable across machines.
 * An unreadable container is an empty list rather than a throw: the caller reports the absence itself,
 * naming the directory it looked in, which is a better message than a stack trace.
 */
export function demoChildren(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    .filter((n) => isFrozen(join(root, n)));
}

const why = (e) => e?.code ?? e?.message ?? String(e);
const NOT_FROZEN = "it holds no meta.json and lane entry file, so it is not a frozen demo";

/**
 * EVERY SAMPLE THE CONTAINER HOLDS, the ones that cannot be used NAMED rather than dropped.
 *
 * `demoChildren` answers "which can be replayed" and drops the rest, which is right for a caller choosing
 * one and wrong for a caller replaying all of them. A sample whose directory could not be read vanished,
 * and the demo said "3 demo reports are published and listed — one per product" over a package that ships
 * four (measured on a published beta, 2026-09-11). Here every directory in the container counts: one that
 * cannot be read, or is not a frozen demo, comes back in `unusable` with the reason.
 */
export function demoInventory(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return { children: [], unusable: [] }; }
  const children = [], unusable = [];
  for (const name of entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort()) {
    const dir = join(root, name);
    try { readdirSync(dir); } catch (e) { unusable.push({ name, why: `its directory could not be read (${why(e)})` }); continue; }
    if (isFrozen(dir)) children.push(name);
    else unusable.push({ name, why: NOT_FROZEN });
  }
  return { children, unusable };
}

/**
 * ONE SAMPLE, READ AND COPIED TO PUBLISH FROM — or the reason it could not be. `{ sample }` or `{ name, why }`.
 *
 * A file inside a sample that could not be read made the copy throw, and the uncaught EACCES took all four
 * demos down with a stack trace (measured on a published beta, 2026-09-11). It is returned instead, so the
 * caller replays the others and names this one.
 */
export function prepareSample(dir, { repoRoot, tmp } = {}) {
  const name = basename(dir);
  if (!isFrozen(dir)) return { name, why: NOT_FROZEN };
  const manifest = join(dir, "meta.json");
  let meta;
  try { meta = JSON.parse(readFileSync(manifest, "utf8")); } catch (e) { return { name, why: `its meta.json could not be read (${why(e)})` }; }
  if (!meta?.runId) return { name, why: `${manifest} names no runId, so it is not a frozen demo manifest` };
  try { return { sample: { dir, meta, name, publishFrom: publishSource(dir, { repoRoot, ...(tmp ? { tmp } : {}) }) } }; }
  catch (e) { return { name, why: `it could not be copied to publish from (${why(e)})` }; }
}


/**
 * The directory a frozen demo should be PUBLISHED from — itself, or a copy when it is part of this tree.
 *
 * WHY A COPY AT ALL. Publishing writes a receipt into the run directory. That is deliberate and right
 * for an archived run; `demo/` is a TRACKED directory, so replaying it rewrote a committed file and a
 * reader who only READ the demo came back to a dirty checkout and an engine reporting
 * `engineState: dirty` — the signal they use to decide whether they are running the shipped thing.
 *
 * WHY IT LIVES HERE. There are TWO publishers of the shipped demos, and fixing one left the other. The
 * player replays a child on `--once`; the launcher SEEDS the pool from the whole container on every
 * `--demo` start, which is the path a reader actually takes — and that one went on dirtying the tree
 * after the player stopped. Measured by driving the demo under a wiped home and reading `git status`
 * afterwards, which is the only place the difference shows.
 *
 * A demo somewhere else is somebody's own copy already and is returned unchanged.
 */
export function publishSource(dir, { repoRoot, tmp = tmpdir() } = {}) {
  const root = resolve(repoRoot ?? "");
  const here = resolve(dir);
  if (!root || !(here === root || here.startsWith(root + sep))) return dir;
  const copy = join(mkdtempSync(join(tmp, "clearotron-demo-")), "sample");
  cpSync(here, copy, { recursive: true });
  return copy;
}

/**
 * THE WHOLE CONTAINER, PUBLISHED FROM — `publishSource`'s rule applied one sample at a time.
 * `{ dir, unusable }`: the directory to publish the container from, and every sample left out, named.
 *
 * The launcher seeds the portal's archive from the whole container, and copied it in one call: one file
 * it could not read failed the copy, and with it every sample, so the archive came up empty over three
 * good ones (driven on a published beta's container, 2026-09-11). Here a sample that cannot be copied is
 * left out and named, and the others are published.
 */
export function publishContainer(root, { repoRoot, tmp = tmpdir() } = {}) {
  const repo = resolve(repoRoot ?? "");
  const here = resolve(root);
  if (!repo || !(here === repo || here.startsWith(repo + sep))) return { dir: root, unusable: demoInventory(root).unusable };
  const copy = join(mkdtempSync(join(tmp, "clearotron-demo-")), "sample");
  mkdirSync(copy, { recursive: true });
  const { children, unusable } = demoInventory(here);
  const left = [...unusable];
  for (const name of children) {
    try { cpSync(join(here, name), join(copy, name), { recursive: true }); }
    catch (e) {
      rmSync(join(copy, name), { recursive: true, force: true });
      left.push({ name, why: `it could not be copied to publish from (${why(e)})` });
    }
  }
  return { dir: copy, unusable: left };
}

/**
 * THE DEMO'S SAMPLE RUNS, WHERE AN ASSISTANT LOOKS FOR RUNS.
 *
 * The demo published its samples as reports and made no run directory, so the connector its own connect
 * line wires listed nothing: an assistant, one of the demo's three faces, had nothing to explore. Each
 * sample's finished `run/` is copied to the layout the connector walks, under the DEMO'S OWN workspace:
 * `<workspace>/workspace-<agent>/studio/prelim-search/<slug>/<date>-<codename>/`. Nothing is written
 * anywhere else, so a real install started afterwards sees none of it (the demo is its own install).
 *
 * Copied, never linked: a connector reading a run may write beside it, and `demo/` is tracked. A run
 * already in place is not copied again, so a visitor's second start changes nothing but its links.
 *
 * ITS REPORT LINKS POINT AT THIS DEMO'S PORTAL. Each sample's `status.json` carried the report URL it was
 * stamped with where it was captured, a test instance's address, and the connector hands a run's `url` to
 * the assistant as-is, so an assistant asked to open a demo report sent the person to that host (measured
 * on a published beta, 2026-09-11). The tracked samples now carry the portal's own route,
 * `/portal/report/<runId>/`, with no host, and each copy here is stamped with `portalOrigin`, the demo
 * portal's address. Stamped on EVERY start, the copies already in place included: `--port` moves the
 * portal, and a copy laid down by an earlier version still carries the old host.
 */
export function seedDemoRuns({ workspace, examplesDir, portalOrigin = null }) {
  const seeded = [], already = [], failed = [];
  for (const name of demoChildren(examplesDir)) {
    const run = join(examplesDir, name, "run");
    let s;
    try { s = JSON.parse(readFileSync(join(run, "status.json"), "utf8")); } catch { continue; }
    if (!s?.slug || !s?.codename || !s?.date) continue;
    const dir = join(workspace, `workspace-${s.agent || "clawdi"}`, "studio", "prelim-search", s.slug, `${s.date}-${s.codename}`);
    if (existsSync(join(dir, "status.json"))) already.push(s.runId);
    else {
      // ONE SAMPLE'S UNREADABLE FILE COSTS THAT SAMPLE ONLY, and is named, never a throw out of the loop.
      try {
        mkdirSync(dirname(dir), { recursive: true });
        cpSync(run, dir, { recursive: true });
      } catch (e) {
        rmSync(dir, { recursive: true, force: true });
        failed.push({ name, why: `its run could not be copied (${why(e)})` });
        continue;
      }
      seeded.push(s.runId);
    }
    if (portalOrigin) stampReportLinks(join(dir, "status.json"), portalOrigin);
  }
  return { seeded, already, failed };
}

/** The portal route that serves a run's report: the one `scanAccountRuns` hands the portal's own list. */
export const reportRoute = (runId) => `/portal/report/${encodeURIComponent(runId)}/`;

/**
 * Point a seeded run's report links at `origin`. A link already on the portal's route keeps its path; any
 * other (the host an older sample carried) becomes the run's own route. Written only when something moved.
 */
export function stampReportLinks(statusFile, origin) {
  let s;
  try { s = JSON.parse(readFileSync(statusFile, "utf8")); } catch { return false; }
  if (!s?.runId) return false;
  const base = String(origin).replace(/\/+$/, "");
  const local = (url) => {
    const path = String(url ?? "").replace(/^https?:\/\/[^/]+/, "");
    return `${base}${path.startsWith("/portal/report/") ? path : reportRoute(s.runId)}`;
  };
  const next = { ...s, url: local(s.url) };
  if (Array.isArray(s.reports)) next.reports = s.reports.map((r) => (r && typeof r === "object" ? { ...r, url: local(r.url) } : r));
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (text === `${JSON.stringify(s, null, 2)}\n`) return false;
  writeFileSync(statusFile, text);
  return true;
}
