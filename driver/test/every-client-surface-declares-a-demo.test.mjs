// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives BOTH real publishers and reads what they wrote into the pool
// — THE DEMO MARKING IS A FAMILY PROPERTY, AND PER-INSTANCE FIXES KEPT LOSING TO IT.
//
// Fourth member in one day, every one failing silently toward READS-AS-REAL:
//   · START_RUN_JOB_FIELDS carried a demo flag buildJob never read
//   · freezeProfile dropped demoData, leaving the banner on a roster fallback (2132)
//   · the knockout publisher never asked the question at all (2122)
//   · and report.md on the CLEARANCE path, measured on a delivered capture: report.html carried
//     "Demonstration report" in its hero and report.md carried it zero times, with both files sitting
//     in the same served pool directory. A demo clearance's markdown was byte-identical to a real one's.
//
// So this arm does not check the surface that was just fixed. It PUBLISHES a demo run through each real
// publisher and reads back EVERY FILE THAT LANDED IN THE POOL — a surface added later is covered by
// construction, because nobody has to remember to add it to a list here.
//
// SAFETY, and it is the same trap publish-stamp.test.mjs documents: driver.config reads env at module
// load and its pool-root DEFAULT IS THE REAL ARCHIVE. Pin before the publisher is imported.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   
const ROOT = mkdtempSync(join(tmpdir(), "demo-surfaces-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";   //
const { publishReport } = await import("../publish/index.mjs");
const { publishKnockout } = await import("../publish/knockout.mjs");

// The rendered client surfaces. Anything a reader opens.
const RENDERED = /\.(html|md)$/i;

// ── THE MACHINE SURFACES ARE EXEMPT BY OWNER RULING, NOT BY OVERSIGHT ────────────────────────────
//
// asked for a machine-readable demo flag on report-data.json and was CLOSED on the
// owner's D1 ruling of 2026-09-02, in session: "clearotron demo is demo only, no one will be tricked."
// The VISIBLE banner is the marking. Named here with the ruling so the next reader does not helpfully
// re-open a settled decision — and so this arm cannot be read as having missed them.
const MACHINE_EXEMPT = ["report-data.json", "meta.json"];

const BANNER = /Demonstration report/i;
const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };
const markDoc = (name) => ({
  name, rating: "Medium", bullets: ["Synthetic fixture for the 2134 demo-surface sweep."],
  findings: [{ ordinal: 1, name: "Look-alike listing", owner: "Kurena SA", band: "Medium",
    net: "A listing under a closely similar name is live on a marketplace.", type: "Active Business", evidence: [] }],
});

/** A run dir whose FROZEN SIDECAR carries the marking — the path made load-bearing. */
function runFixture(tag, { demo }) {
  const runDir = join(ROOT, `run-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${tag}`, markName: "KURENA" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, findings: [] }));
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ key: `${tag}-key`, demoData: demo === true }));
  return runDir;
}

/** Publish through a REAL publisher and return every file that landed, with whether it is marked. */
async function surfacesOf(tag, { demo, product, marks = ["KURENA"] }) {
  const runDir = runFixture(tag, { demo });
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0775-2026-09-03-${tag}`;
  const common = { runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test",
    customerKey: `${tag}-key`, skipRegen: true };
  if (product === "clearance") {
    await publishReport({ ...common, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  } else {
    await publishKnockout({ ...common, findings: { marks: marks.map(markDoc) }, framework: FRAMEWORK, overall: "Medium" });
  }
  const dir = join(poolRoot, runId);
  return readdirSync(dir).map((name) => ({
    name, rendered: RENDERED.test(name),
    marked: BANNER.test(readFileSync(join(dir, name), "utf8")),
  }));
}

const CASES = [
  { tag: "clearance", product: "clearance", marks: ["KURENA"] },
  { tag: "knockout-one", product: "knockout", marks: ["KURENA"] },
  { tag: "knockout-many", product: "knockout", marks: ["KURENA", "VELTRIPHEN"] },
];

for (const c of CASES) {
  test(`2134 every RENDERED client surface of a demo ${c.tag} run declares itself`, async () => {
    const files = await surfacesOf(`demo-${c.tag}`, { demo: true, product: c.product, marks: c.marks });
    const rendered = files.filter((f) => f.rendered);
    // FLOOR. A walk that finds nothing reports clean, and "the publisher wrote no surfaces" must never
    // read as "every surface is marked" — the shape this whole family keeps failing in.
    assert.ok(rendered.length >= 2,
      `only ${rendered.length} rendered surface(s) found in the pool (${files.map((f) => f.name).join(", ")}) — `
      + "the publisher did not write, or the enumeration is broken. Either way this arm proved nothing.");
    const unmarked = rendered.filter((f) => !f.marked).map((f) => f.name);
    assert.deepEqual(unmarked, [],
      `these are served to a client and do not say they are a demonstration: ${unmarked.join(", ")}. `
      + "Both surfaces sit in the same pool directory, so an unmarked one is byte-indistinguishable from a real report.");
  });
}

test("2134 the CONTROL — a real run gains no banner on any surface, so the arms above can fail", async () => {
  const files = await surfacesOf("real-clearance", { demo: false, product: "clearance" });
  const rendered = files.filter((f) => f.rendered);
  assert.ok(rendered.length >= 2, "void control — no surfaces to be unmarked");
  const wrongly = rendered.filter((f) => f.marked).map((f) => f.name);
  assert.deepEqual(wrongly, [],
    `a REAL client report claims to be a demonstration: ${wrongly.join(", ")}. A marking invented for a `
    + "real matter is the opposite failure and is worse than the one this issue was raised on.");
});

test("2134 the machine-surface exemption still names files the publisher actually writes", async () => {
  const files = await surfacesOf("exempt-check", { demo: true, product: "clearance" });
  const names = new Set(files.map((f) => f.name));
  const stale = MACHINE_EXEMPT.filter((n) => !names.has(n));
  assert.deepEqual(stale, [],
    `exempt from the demo marking by the 2026-09-02 D1 owner ruling, but no longer written by the `
    + `publisher: ${stale.join(", ")}. An exemption that outlives its subject hides the next surface.`);
});
