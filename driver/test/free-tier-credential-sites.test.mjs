// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — WHAT THE FREE TIER REQUIRES, ASKED OF EVERY PLACE THAT ANSWERS IT.
//
// WHAT WENT WRONG, TWICE, IN THE SAME SHAPE. "Which credentials does this provider need" is asked in
// more than one place, and the copies drift. driver.config.mjs says so in its own words: fixed the
// half-check in preflightCredentials and left the other site; would have made it a third.
//
// It did, and then fixed two of the three. The one left behind was the MCP server — the SEAT'S
// RUNTIME PATH. On an EU-only box every step of worked: preflight passed, the plan compiled with
// the US split off as a disclosed deferral, the EU entry was executable. Then every register_* tool the
// seat called was refused by driver/engine/mcp/free-tier-server.mjs, so the EU half never ran.
// Everything upstream correct, nothing downstream happening: the least legible way for a fix to fail,
// and no test anywhere would have noticed.
//
// A fourth site is the obvious next failure, so this file does not test the three known ones. It SWEEPS
// the source for anything that gates on USPTO_LOCAL_DB and requires each one to be a site that is
// allowed to. A new gate added anywhere reddens this test until it is listed deliberately.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The vacuity check sits on the WALK'S RESULT, not on each read —. An empty leaf is
// ordinary (`driver/profiles/` is a runtime write target and a deployed box grows one), and guarding
// every recursive read turned that into a throw before a single file was read. Git stores no empty
// directory, so no clone has an empty leaf and CI never saw it.
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".git", "dist", "test", "coverage"].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
};

/**
 * Files allowed to make a decision on USPTO_LOCAL_DB, each with why.
 *
 * The list is the point. Anything NOT here that gates on the variable is either a fourth copy of the
 * free tier's requirement — the defect this file exists for — or a new site whose reason has to be
 * written down before it is added.
 */
const ALLOWED = new Map([
  ["driver/driver.config.mjs",
    "the uspto-local ADAPTER's own guards (it is that provider's credEnv), plus free-tier's record/count "
    + "guards which check the EU pair only"],
  ["driver/engine/mcp/uspto-local-server.mjs",
    "the US-only provider's server: the index IS its credential, so requiring it is correct there"],
  ["driver/engine/mcp/codex-config.mjs", "an env passthrough list, not a gate"],
  ["driver/engine/mcp/gather-config.mjs", "a comment about which variable uspto-local fails on"],
  ["providers/uspto-local/src/core.js", "DEFAULT_DB_ENV — the provider reading its own index path"],
  ["bin/uspto-sync.mjs", "the sync CLI, whose entire job is to build the file the variable names"],
  ["providers/uspto-local/bin/verify-index.mjs",
    "the #547 acceptance harness. It reads the variable as a DEFAULT for its one argument — `verify "
    + "the index this box is configured to search` — and refuses with a usage line when neither is "
    + "given. It gates nothing: it is a reporting tool that never runs inside a clearance"],
  ["bin/onboard.mjs", "the setup wizard, where it is declared OPTIONAL for free-tier"],
  ["driver/engine/mcp/free-tier-server.mjs",
    "names the variable only in the refusal TEXT, to tell an operator it is NOT required. Listed here "
    + "rather than excluded, because the gate itself is pinned precisely by the next test — which reads "
    + "MISSING() alone, so re-adding the check would redden that even though this sweep stays green"],
]);

/**
 * The file with comments removed.
 *
 * The first cut of this sweep matched any MENTION of the variable and flagged five files that only
 * discuss it in prose — including three written by itself to explain why it is not required. A
 * census that fires on its own documentation gets deleted by the next reader, which is worse than not
 * having one. What matters is code that READS the variable or lists it as a requirement.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const SOURCE_ROOTS = [join(ROOT, "driver"), join(ROOT, "providers"), join(ROOT, "bin")];
/** Every source file the sweep reads. `roots` is a parameter so the empty-walk direction can be DRIVEN. */
const sources = (roots = SOURCE_ROOTS) =>
  nonEmpty(roots.flatMap((d) => walk(d)), "the walked source corpus");

test("nothing new gates on USPTO_LOCAL_DB without being listed here", () => {
  const offenders = [];
  for (const file of sources()) {
    const src = codeOnly(readFileSync(file, "utf8"));
    // Both shapes the real defect took: a direct env read (the MCP server) and a bare string in a
    // requirement list (driver.config's credEnvAlso). Either is a gate.
    if (!/USPTO_LOCAL_DB/.test(src)) continue;
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    // — this named the FILE and nothing else, with no line number either, so
    // every hit began by re-running the same search by hand.
    if (!ALLOWED.has(rel)) {
      const hit = src.split("\n").find((l) => /USPTO_LOCAL_DB/.test(l))?.trim().slice(0, 110) ?? "";
      offenders.push(`${rel}  ${hit}`);
    }
  }
  assert.deepEqual(offenders, [],
    "a file that decides something about USPTO_LOCAL_DB and is not in ALLOWED. If it is a legitimate new "
    + "site, add it WITH ITS REASON. If it is another copy of what the free tier requires, it is the #660 "
    + "defect again: the free tier requires the EU pair only, and the US office is split off at plan "
    + "compile and disclosed.");
});

test("the free tier's MCP server does NOT require the US index", () => {
  // The site that was left behind. Asserted on the source rather than by booting the server, because
  // booting it needs a live stdio transport — and a test that cannot run is a test that does not.
  const src = readFileSync(join(ROOT, "driver", "engine", "mcp", "free-tier-server.mjs"), "utf8");
  const missingFn = src.slice(src.indexOf("const MISSING = ()"), src.indexOf("const guard = "));
  assert.ok(missingFn.length > 0, "MISSING() not found — this census is measuring nothing");
  assert.match(missingFn, /EUIPO_CLIENT_ID/, "the EU pair is still required: no configured member at all is unconfigured, not degraded");
  assert.doesNotMatch(missingFn, /USPTO_LOCAL_DB/,
    "requiring the US index here refuses every register_* tool on an EU-only box, so the EU half never "
    + "runs — with preflight passing and the plan compiling correctly, which is what made it invisible");
});

test("the driver-side guards agree with it", async () => {
  const { PROVIDERS, missingCredentials } = await import("../driver.config.mjs");
  const env = { EUIPO_CLIENT_ID: "id", EUIPO_CLIENT_SECRET: "secret" };   // no USPTO_LOCAL_DB
  assert.deepEqual(missingCredentials(PROVIDERS["free-tier"], env), [],
    "free-tier must be satisfied by the EU pair alone");
  assert.deepEqual(missingCredentials(PROVIDERS["euipo"], env), [],
    "euipo standalone was never supposed to need the US index, and did not");
  assert.deepEqual(missingCredentials(PROVIDERS["uspto-local"], env), ["USPTO_LOCAL_DB"],
    "the US-only provider still requires it: there is nothing else for it to search");
});

test("onboarding offers the US index rather than demanding it", async () => {
  const { PROVIDERS } = await import("../../bin/onboard.mjs");
  const ft = PROVIDERS.find((p) => p.id === "free-tier");
  assert.ok(ft, "free-tier is not offered by the wizard");
  assert.ok(!ft.credentials.includes("USPTO_LOCAL_DB"),
    "the wizard would tell a newcomer to run a 41.5 GB download and a nine-hour build before anything "
    + "runs — on the one configuration that exists so a clearance needs no subscription");
  assert.deepEqual(ft.optionalCredentials, ["USPTO_LOCAL_DB"],
    "and it must still be OFFERED, or a reader never learns the US half is available at all");
});

test("tracker 2018 the walk refuses an empty corpus, and an empty leaf is not one", () => {
  // BOTH DIRECTIONS. A guard moved onto the aggregate and a guard deleted read identically on a healthy
  // tree; only a walk handed an empty tree tells them apart.
  const tmp = mkdtempSync(join(tmpdir(), "b2018-free-tier-"));
  const leaf = join(ROOT, "driver", "profiles", "projects", `b2018-${process.pid}`);
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    assert.throws(() => sources([tmp]), /VACUOUS/,
      "a walk that descended a whole tree and found no file reported a corpus instead of refusing");
    assert.throws(() => sources([]), /VACUOUS/, "no roots at all is not a corpus");

    // …and the leaf that produced: the product writes it, git cannot store it, and it
    // must change nothing.
    const baseline = sources().map((f) => relative(ROOT, f)).sort();
    mkdirSync(leaf, { recursive: true });
    assert.deepEqual(sources().map((f) => relative(ROOT, f)).sort(), baseline,
      "an empty directory under a walked root changed the set of files this sweep reads");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(leaf, { recursive: true, force: true });
  }
});
