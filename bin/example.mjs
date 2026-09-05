#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron demo — show a real clearance report to somebody who has nothing, IN THE REAL PORTAL.
//
//   npx clearotron demo                    replay demo into ~/trademark-demo and open the portal
//   npx clearotron demo --run-dir <dir>    replay a frozen example from somewhere else
//   npx clearotron demo --base <dir>       put the whole demo somewhere else (remove it with one rm -rf)
//   npx clearotron demo --port 9000        serve on another port
//   npx clearotron demo --no-open          do not try to open a browser
//   npm run example -- --once              publish and exit; do not open the portal
//   npm run example -- --once --pool <dir> publish somewhere else; only valid with --once
//
// NO CREDENTIALS, NO MODEL, NO ENGINE. This does not run a clearance. It takes a run that already
// finished and pushes it back through the ordinary publisher — the same publishReport that wrote the
// real thing — into a local pool, then serves that pool over loopback. Everything it touches is a file
// on this machine. That is also why it works anywhere Node does: nothing here spawns a subprocess.
//
// (One caveat on "no subprocess": publishReport stamps the engine's commit via engine-build.mjs, which
// shells out to `git rev-parse`. It is best-effort, catches everything, and the stamp is null off a
// checkout. There is no other spawn on this path.)
//
// THE POOL GUARD IS THE POINT OF THIS FILE'S CAUTION
// `startPortal` and `config.poolRoot` used to default to the PRODUCTION archive (/srv/trademark-archive).
// On a deployed VM, a demo that forgot one option would publish a sample into real client matter and
// then serve that matter over loopback. removed that default — an unset CLEAROTRON_REPORTS_DIR now
// refuses — and NONE OF THE CHECKS BELOW ARE RELAXED BY IT. A demo runs ON deployed VMs, where the
// variable is set and set to the real archive, which is the case a refusal does nothing about. So the
// demo pool is still checked against every root that could be the real one, by realpath and by
// containment, BEFORE anything is written or served — and every path startPortal can fall back on is
// still passed explicitly rather than left to a default.

import "../shared/env-local.mjs";   // step 4 / — FIRST: this program read a
// retired spelling and never reached the alias layer, so an operator who set the name in force
// handed it nothing and the read fell through to a default. Proven both ways from one
// environment: without this import the value is invisible, with it the retired spelling is
// back-filled. Placed above every other import because a side-effecting import runs in order.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { invoke } from "../shared/invocation.mjs";   // — the printed command is resolved once, for the reader who is actually standing there
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { BRAND } from "../shared/brand.mjs";   // — the installer's own name, from the tenant seam
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half
import { isFrozen, demoChildren } from "../driver/demo-container.mjs";   // — one definition of what a frozen demo is, for the player AND the gate

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

import { usageBlock } from "../shared/usage-block.mjs";   // tracker issues 1861/1882
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

if (has("--help") || has("-h")) {
  // — was slice(1, 8): a hand-counted window starting at the licence header.
  console.log(usageBlock(readFileSync(fileURLToPath(import.meta.url), "utf8")));
  process.exit(0);
}

const die = (...lines) => { console.error(`\n${lines.join("\n")}\n`); process.exit(1); };

// ── 1. the frozen demo ────────────────────────────────────────────────────────────────────────────────
//
// — `demo/` IS A CONTAINER, ONE CHILD PER PRODUCT TYPE.
//
// It holds one frozen run per product the engine sells, named by the product's own id, so a reader can
// see what each one actually produces rather than being told. Today that is one child; the other three
// arrive as their runs do, and nothing here changes when they land.
//
// ONE LAYOUT FOR BOTH READERS, WHICH IS WHY IT IS A CONTAINER AND NOT A RUN. `driver/publish/seed-pool.mjs`
// already walked a container — every child holding a meta.json and a run/ — and `bin/start.mjs` seeds the
// portal's archive from it. A bare run directory here would have left that call finding nothing and the
// installed portal serving an empty archive, silently. Same directory, both readers, no second mechanism.
const DEMO_ROOT = join(REPO, "demo");
// The rule lives in `driver/demo-container.mjs` — ONE definition, because it used to be three and they
// disagreed. That file records what a knockout demo carries instead of a report.md, and why this line
// once let `demo/knockout-search` ship and stay unopenable..

// --run-dir takes a directory outright. --product names a child. Neither given: the first child, and the
// name is PRINTED below rather than assumed, because "the demo" is about to mean one of several.
const wanted = flag("--product");
const children = demoChildren(DEMO_ROOT);
const sampleDir = resolve(
  flag("--run-dir")
  ?? (wanted ? join(DEMO_ROOT, wanted) : (children[0] ? join(DEMO_ROOT, children[0]) : DEMO_ROOT)),
);
if (!isFrozen(sampleDir)) {
  // AN ABSENCE IS A FINDING, AND IT NAMES WHAT IT LOOKED AT. This exits 1 and always has; tracker issue
  // 2193 reported it exiting 0, which did not reproduce at v0.1.0 or at main's tip. An arm pins it.
  die(
    `demo: no frozen demo at ${sampleDir}`,
    "",
    wanted && !children.includes(wanted)
      ? `There is no demo for product "${wanted}".`
      : "A frozen demo is a directory holding meta.json and its lane's entry file — run/report.md for a\nclearance, run/knockout-findings.json for a knockout — produced by",
    wanted && !children.includes(wanted)
      ? ""
      : "  node scripts/freeze-example-run.mjs --run-dir <a finished run> --out <dir>",
    "",
    children.length
      ? `Products with a demo in this tree: ${children.join(", ")}`
      : `${DEMO_ROOT} holds no product demo at all — this tree shipped without one.`,
    "",
    `Choose one with:  ${invoke("demo")} --product <product-id>`,
    `Or point at any frozen run:  ${invoke("demo")} --run-dir <dir>`,
  );
}
// ── PUBLISH FROM A COPY WHEN THE DEMO IS PART OF THIS TREE (tracker issue 157) ──────────────────────
//
// Publishing writes a receipt into the run directory — deliberately; it records that the publish
// happened, and where the store is read-only it simply does not land. For an archived run that is
// right. `demo/` is not an archived run: it is a TRACKED directory in this repository, so replaying it
// rewrote a committed file's timestamp. A reader who only READ the demo — ran the command the front
// page gives them — then had a dirty checkout and an engine reporting `engineState: dirty`, which is
// the signal they use to decide whether they are running the shipped thing. It is invisible in an
// installed package, where there is no git, so it hit exactly the audience most likely to be
// evaluating the code.
//
// The copy is made when the demo lies inside this tree, whether it was named by `--product` or handed
// over with `--run-dir`: the hazard is that the directory is tracked, not which flag found it. A demo
// somewhere else is somebody's own copy already and is left where it is.
const insideThisTree = (dir) => {
  const root = resolve(REPO);
  return resolve(dir) === root || resolve(dir).startsWith(root + sep);
};
const publishFrom = insideThisTree(sampleDir)
  ? (() => {
      const copy = join(mkdtempSync(join(tmpdir(), "clearotron-demo-")), "sample");
      cpSync(sampleDir, copy, { recursive: true });
      return copy;
    })()
  : sampleDir;

const meta = JSON.parse(readFileSync(join(sampleDir, "meta.json"), "utf8"));
if (!meta?.runId) die(`example: ${join(sampleDir, "meta.json")} names no runId — it is not a frozen example manifest.`);

// ── 2. the pool guard ────────────────────────────────────────────────────────────────────────────────
// Resolve through symlinks. A $HOME that resolves inside the archive is exactly the shape a `===` test
// waves through, and the demo pool may not exist yet — so walk up to the nearest ancestor that does.
const realOf = (p) => {
  let cur = resolve(p);
  for (;;) {
    try { return join(realpathSync(cur), resolve(p).slice(cur.length)); } catch { /* not there yet */ }
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    cur = up;
  }
};
const contains = (parent, child) => parent === child || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

// ── — THE DEMO'S BASE, AND WHY `--pool` NARROWED ───────────────────────────
//
// The demo brings up the real portal now, and the portal serves the pool inside its own base directory
// (`installPaths` in bin/start.mjs owns that layout — one place, not two). So the pool is derived from
// the base rather than chosen beside it. `--pool` still means what it always did on the publish-only
// path, and is REFUSED with the portal, because publishing into one directory while serving another is
// a demo that shows a reader an empty archive and says nothing about why.
const demoBase = resolve(flag("--base") ?? join(homedir(), "trademark-demo"));
if (flag("--pool") && !has("--once")) die(
  "demo: --pool is for --once, which publishes and exits.",
  "",
  "The demo serves the portal's own archive, which lives inside its base directory, so a pool chosen",
  "somewhere else would be published to and never served. Move the whole demo instead:",
  `  ${invoke("demo")} --base <dir>`,
);
const poolRoot = realOf(flag("--pool") ?? join(demoBase, "pool"));
// Every root that could be the real archive: the archive itself, whatever this environment configures,
// and the staff-CLI alias that carries the same literal.
//
// THE FIRST ENTRY IS NOT A DEFAULT AND MUST NOT BE DELETED WITH ONE. stopped the code guessing
// this path; it did not move the archive. /srv/trademark-archive is where the deployed engine publishes
// client matter, named here for the same reason driver/production-pool-guard.mjs names it — this list
// answers "could this be somebody's real archive?", which no change to a code default can make false.
const FORBIDDEN = [
  ["/srv/trademark-archive", "the production archive — where the deployed engine publishes client matter"],
  [envFrom(process.env, "CLEAROTRON_REPORTS_DIR"), "CLEAROTRON_REPORTS_DIR — this environment's configured pool"],
  [process.env.CLEAROTRON_STAFF_POOL_ROOT, "CLEAROTRON_STAFF_POOL_ROOT — the staff-page CLI pool"],
].filter(([p]) => p && String(p).trim()).map(([p, why]) => [realOf(p), why]);

for (const [forbidden, why] of FORBIDDEN) {
  if (contains(forbidden, poolRoot)) die(
    `demo: refusing to publish into ${poolRoot}`,
    `That is inside ${forbidden} — ${why}.`,
    "The demo writes a example report; a real pool holds real client matter. Pass --pool <dir> elsewhere.",
  );
  if (contains(poolRoot, forbidden)) die(
    `demo: refusing to serve ${poolRoot}`,
    `It contains ${forbidden} — ${why}.`,
    "Serving it would put real client matter behind the demo's browser link. Pass --pool <dir> narrower.",
  );
}
if (existsSync(poolRoot) && !statSync(poolRoot).isDirectory()) die(`demo: ${poolRoot} exists and is not a directory.`);

// ── 3. replay ────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n  ${BRAND.name} ${BRAND.product.toLowerCase()} — demo\n`);
console.log(`  sample:  ${sampleDir}`);
console.log(`  pool:    ${poolRoot}\n`);

mkdirSync(poolRoot, { recursive: true });
const { republishRun } = await import(join(REPO, "driver", "publish", "report-registry.mjs"));
let published;
try {
  // poolUrl "" on purpose: the report's own link block is for a deployment that serves the pool at a
  // public URL. This one is served from this process, at a port picked below.
  published = await republishRun({ runId: meta.runId, meta, pool: poolRoot, poolUrl: "", runDir: join(publishFrom, "run") });
} catch (e) {
  die(`demo: replaying the sample failed: ${String(e?.message ?? e)}`);
}

// THE LABEL. The reader is about to look at a document that reads like advice about a real mark. It is
// not, and the demo says so before the browser opens rather than in a footnote nobody reaches.
console.log("  Real engine output for the fictional mark VENQORI — captured 2026-08-11 against the");
console.log("  production EU register, replayed locally: no keys, no model calls, no register queried.");
console.log("  Every number, band and citation below was produced by that real run and is being");
console.log("  re-rendered from its artifacts. It is an example, not advice.\n");
// NAMES THE POPULATION. This printed "13 finding(s)" beside a report showing
// twelve, in the first sentence a reader meets. The number is not wrong — it comes from the audit
// spine (`driver/publish/audit-from-spine.mjs`, `counts.findings`), which counts every finding the run
// recorded, including ones the report correctly drops. Two populations, one label, and the label was
// the one the reader was about to check. So the label says which.
// EACH LANE'S PUBLISHER REPORTS ITS OWN NUMBER, AND THEY ARE NOT THE SAME NUMBER.
//
// The clearance branch returns `counts.findings` — every finding in the run's audit spine. The knockout
// branch returns no `counts` at all; it returns `receipts`, whose `findings` counts the findings whose
// citations the publisher traced to the run's own held evidence. That is a subset by definition, so it
// is printed in its own words rather than mapped onto the clearance sentence. They happen to agree on
// the demo in this tree, which is one member of a class and proves nothing about the metric.
//
// The third branch is the point: a lane whose publisher reports no count says so. This line printed a
// bare "?" to the knockout — a could-not-look wearing the costume of a number.
const spine =
  Number.isFinite(published.counts?.findings)
    ? `${published.counts.findings} finding(s) recorded in the run's audit spine; the report shows
             the ones it retains`
    : Number.isFinite(published.receipts?.findings)
      ? `${published.receipts.findings} finding(s) with citations traced to this run's own held
             evidence, on ${published.receipts.citing}/${published.receipts.marks} mark(s)`
      : `this lane's publisher reported no finding count — the report itself is the record`;
console.log(`  published: ${published.runId}  (${spine})`);

if (has("--once")) {
  console.log(`\n  report: ${join(poolRoot, meta.runId, "report.html")}`);
  //, criterion 5 — SAY WHAT WAS CREATED, ON EVERY PATH THAT CREATES SOMETHING.
  //
  // The portal path below prints this and `--once` did not, so the one invocation a reader is most
  // likely to try first — publish and exit, no browser — left a directory in their home with nothing
  // naming it. Found by driving it under a sandboxed HOME rather than by reading: the early exit sits
  // eighteen lines above the line that says it.
  //
  // NAMES WHAT WAS ACTUALLY CREATED, not a constant. With `--pool` the base is never made, so printing
  // the base there would tell a reader to remove a directory that does not exist and leave the one that
  // does — worse than silence, because it reads as an answer.
  const created = flag("--pool") ? poolRoot : demoBase;
  console.log(`  Removing it later is one directory:  rm -rf ${created}\n`);
  process.exit(0);
}

// ── 4. hand over to the real portal ──────────────────────────────────────────────────────────────────
//
//. This used to serve driver/dev-portal.mjs, whose own first paragraph says it
// is not the product and not how you start it: a loopback pool browser, accurate in its name and wrong
// as the thing a first-time reader is shown. Everything the website shows a visitor — ordering, the
// product picker, a finished report in the portal — is the REAL portal, so a demo that opened anything
// else taught a newcomer that the screenshots were of something they cannot reach.
//
// ONE SUPERVISOR, NOT A SECOND ONE. bin/start.mjs already starts the portal and the engine door, and it
// has a `--demo` posture: its own data directory, nothing persisted to <repo>/.env, and the Start
// control greyed with the reason at it. Re-implementing that here is how there came to be two portals
// in the first place, so this hands over rather than copies. The dev cockpit keeps its job as a
// contributor tool; it simply stops being what `demo` opens.
const startArgs = ["--demo", "--base", demoBase];
if (flag("--port")) startArgs.push("--port", flag("--port"));
if (has("--no-open")) startArgs.push("--no-open");

console.log(`  Removing this demo later is one directory:  rm -rf ${demoBase}`);
console.log("");

const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), ...startArgs], {
  cwd: REPO, stdio: ["ignore", "inherit", "inherit"],
});
child.on("error", (e) => die(`demo: could not start the portal: ${String(e?.message ?? e)}`));
// Its exit code is the demo's. A supervisor that swallowed a child's refusal would report a demo that
// is up when nothing is listening.
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
// Ctrl-C reaches the child through the shared terminal; this process waits for it to finish tearing
// down rather than exiting first and orphaning it.
process.on("SIGINT", () => {});
