// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// bin/example.mjs — the zero-credential replay.
//
// The demo's promise is that somebody with no keys, no model access and no engine sees a real report.
// Its risk is the other half: `startPortal` and `config.poolRoot` both default to the PRODUCTION archive,
// so a demo that forgot an option would publish a sample into real client matter and then serve it. These
// tests hold both halves — the replay works from a stripped environment, and every route into a real pool
// is refused before anything is written.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DEMO = join(REPO, "bin", "example.mjs");
const FREEZE = join(REPO, "scripts", "freeze-example-run.mjs");

const REPORT_MD = `---
type: prelim-clearance
matter: TMP8439
title: PROJECT AQUAPLUS
client: Zephyr Beverages
use: codename
classes: 9, 41
run: 2026-01-01 · euipo + common-law
overall_label: Low
overall_badge: l2
overall_caption: synthetic fixture
coverage_line: Classes 9 and 41: searched · registers: EU
rated_under: House default · house default framework
---

# Actions
### Checks we ran — what we found
- Synthetic use-check: none found ([src](https://x.example)).

# Coverage
Synthetic coverage panel.

# Methodology
Synthetic methodology paragraph.

# Marks

## Example Holdings BV — PROJECT AQUAPLUS, EU
- ord: 1
- open: false
- net: Synthetic net line for the fixture.
- tier: 1
- label: Level A · Composite 1 · Clear
- group: off-field
- source: Register
### Full detail
- Synthetic filing detail.
- Source: [Provider · card1](#)

# Reasoned negatives

None.
`;

/** A frozen example, built the way the shipping one is built: a real run through the freeze tool. */
function makeSample() {
  const root = mkdtempSync(join(tmpdir(), "demo-"));
  const runDir = join(root, "archive", "2026-01", "tmp8439-aquaplus", "2026-01-01-synthetic-fixture");
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "report.md"), REPORT_MD);
  writeFileSync(join(runDir, "audit.md"), "---\n---\n\n# Findings\n\n# Negative Results\n\n# Audit Trail\n");
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ markName: "AQUAPLUS" }));
  writeFileSync(join(runDir, ".delivered"), "ok\n");
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ profileKey: "generic" }));
  const sample = join(root, "sample");
  execFileSync(process.execPath, [FREEZE, "--run-dir", runDir, "--out", sample, "--force"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_DATABASE: process.env.CLEAROTRON_DATABASE || "corsearch" }),
  });
  return { root, sample, runId: "tmp8439-aquaplus-2026-01-01-synthetic-fixture" };
}

/** Run the demo with the ambient environment STRIPPED — the only way to prove no credential was used
 *  rather than merely observing that none happened to be needed. */
function runDemo(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [DEMO, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { HOME: env.HOME ?? tmpdir(), PATH: "/usr/bin:/bin", ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("a frozen example replays into a demo pool with NO credentials in the environment at all", () => {
  const { root, sample, runId } = makeSample();
  const pool = join(root, "demo", "pool");
  const r = runDemo(["--run-dir", sample, "--pool", pool, "--once"]);
  assert.equal(r.code, 0, r.out);
  // A real report, not a placeholder: the baked HTML, its markdown, and the archive index beside it.
  assert.ok(existsSync(join(pool, runId, "report.html")), `report.html published: ${r.out}`);
  assert.ok(existsSync(join(pool, runId, "meta.json")), "meta.json published");
  assert.ok(existsSync(join(pool, "index.html")), "the pool index regenerated");
  const html = readFileSync(join(pool, runId, "report.html"), "utf8");
  assert.ok(html.length > 10000, `the report is a rendered document, not a stub (${html.length} bytes)`);
  assert.match(html, /PROJECT AQUAPLUS/, "the mark reaches the rendered report");
  // The label is not a footnote — it is on the terminal before the browser opens.
  assert.match(r.out, /no keys, no model calls/, r.out);
  assert.match(r.out, /example, not advice/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test("the demo refuses a pool inside the production archive, before it writes anything", () => {
  const { root, sample } = makeSample();
  const r = runDemo(["--run-dir", sample, "--pool", "/srv/trademark-archive/demo", "--once"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refusing to publish/, r.out);
  assert.match(r.out, /production archive/, r.out);
  assert.ok(!existsSync("/srv/trademark-archive/demo"), "nothing was created under the archive");
  rmSync(root, { recursive: true, force: true });
});

test("the demo refuses a pool inside whatever CLEAROTRON_REPORTS_DIR names on THIS machine", () => {
  // The code default is not the only real pool. A deployment's configured one is just as real, and on a
  // VM it is the one that actually holds the matter.
  const { root, sample } = makeSample();
  const configured = join(root, "configured-pool");
  const r = runDemo(["--run-dir", sample, "--pool", join(configured, "demo"), "--once"], { CLEAROTRON_REPORTS_DIR: configured });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /CLEAROTRON_REPORTS_DIR/, r.out);
  assert.ok(!existsSync(join(configured, "demo")), "nothing was created under the configured pool");
  rmSync(root, { recursive: true, force: true });
});

test("the demo refuses to SERVE a directory that contains a real pool, not only to write into one", () => {
  // The inverse containment. `--pool /srv` writes somewhere harmless and then hands the browser a tree
  // with the whole archive under it — a leak an equality check waves straight through.
  const { root, sample } = makeSample();
  const configured = join(root, "outer", "configured-pool");
  mkdirSync(configured, { recursive: true });
  const r = runDemo(["--run-dir", sample, "--pool", join(root, "outer"), "--once"], { CLEAROTRON_REPORTS_DIR: configured });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refusing to serve/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test("a $HOME symlinked into a real pool does not get past the guard", () => {
  // realpath, not string equality. This is the shape that defeats `===`.
  const { root, sample } = makeSample();
  const configured = join(root, "configured-pool");
  mkdirSync(join(configured, "home"), { recursive: true });
  const link = join(root, "home-link");
  execFileSync("ln", ["-s", join(configured, "home"), link]);
  // Default pool is $HOME/trademark-demo/pool — which, through the link, lands inside the real pool.
  const r = runDemo(["--run-dir", sample, "--once"], { HOME: link, CLEAROTRON_REPORTS_DIR: configured });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refusing to publish/, r.out);
  assert.ok(!existsSync(join(configured, "home", "trademark-demo")), "nothing was created through the symlink");
  rmSync(root, { recursive: true, force: true });
});

test("a missing frozen demo says what a frozen demo is and how to make one", () => {
  // An absent artifact must read as an absence with a next step, not as a stack trace.
  // — the noun is "demo" throughout now, on the owner's one-term ruling, and the
  // message names the products this tree actually has rather than only the path it could not open.
  const r = runDemo(["--run-dir", join(tmpdir(), "definitely-not-a-sample-dir"), "--once"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no frozen demo at/, r.out);
  assert.match(r.out, /freeze-example-run\.mjs/, r.out);
  assert.match(r.out, /Products with a demo in this tree:/, r.out);
});

// ── the demo shows a new reader everything the package ships ──────────────────────
//
// `npx clearotron demo` replayed `children[0]` and stopped. The package ships one finished report per
// product; a first-time reader met one of them, with nothing on screen saying the other three existed.
// The owner's ruling is that they auto-load: a demo reachable only by someone who already knows to ask
// for it is not shipped.
//
// DRIVEN THROUGH THE REAL COMMAND, with the environment stripped, because the defect was in what the
// command chooses rather than in what any function returns.

test("277 the demo publishes every product the package ships, not just the first", () => {
  const pool = join(mkdtempSync(join(tmpdir(), "demo-all-")), "pool");
  const r = runDemo(["--pool", pool, "--once"]);
  assert.equal(r.code, 0, `the demo exited ${r.code}:\n${r.out}`);

  // The expected count comes from the shipped container, so a fifth demo landing does not need this arm
  // edited — and cannot pass it by accident either.
  const shipped = readdirSync(join(REPO, "demo"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(REPO, "demo", d.name, "meta.json"))).length;
  assert.ok(shipped >= 4, `the tree ships ${shipped} demo(s); this arm is about there being several`);

  const published = (r.out.match(/^\s*published: /gm) ?? []).length;
  assert.equal(published, shipped,
    `${shipped} demo(s) ship and the command published ${published}. Before this it published one and `
    + `said nothing about the rest.\n${r.out}`);

  // AND IT SAYS SO. A reader who cannot see a count cannot tell four from one, which is how three
  // missing demos went unnoticed on a first-run screen.
  assert.match(r.out, new RegExp(`${shipped} demo reports are published and listed`),
    `the command published ${shipped} and never said how many\n${r.out}`);
});

test("277 --product still narrows to one, because asking for one is a real thing to want", () => {
  const pool = join(mkdtempSync(join(tmpdir(), "demo-one-")), "pool");
  const r = runDemo(["--product", "knockout-search", "--pool", pool, "--once"]);
  assert.equal(r.code, 0, `the demo exited ${r.code}:\n${r.out}`);
  const published = (r.out.match(/^\s*published: /gm) ?? []).length;
  assert.equal(published, 1, `--product published ${published} demos instead of the one asked for\n${r.out}`);
  assert.match(r.out, /knockout/, `--product published something other than the product named\n${r.out}`);
});
