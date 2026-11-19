// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE COVER EMAIL STATES WHAT THE PAGE STATES. The email is composed from the run's report document, as the page is, and
// on three facts it read a different source than the page did:
//   - a clearance whose assessment did not complete: the page rates nothing, and the email rated the run from the verdict
//     record that assessment had left behind;
//   - a clearance with a verdict record older than its derived display fields: the page derives the rating from the record,
//     and the email printed the report's front-matter label;
//   - a Knockout whose lane holds no register counts: the page states the run's saved counts, and the email stated none
//     (a resumed run, whose lane holds counts the page does not, is a-resumed-knockout-emails-the-counts-its-page-states).
// Each case is built on a copy of a demo run and published as the delivery publishes it; nothing here makes a model turn
// or a register call.
//
// SAFETY GUARD: the workspace is pinned before the driver's modules are imported, because the driver config
// freezes its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "cover-email-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __mkdtemp(__join(__tmpdir(), "cover-email-pool-default-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { publishSource, demoChildren } = await import("../demo-container.mjs");
const { republishRun } = await import("../publish/report-registry.mjs");
const { coverNoteInputs, composeCoverNote } = await import("../publish/index.mjs");
const { composeKnockoutCoverNote } = await import("../publish/knockout.mjs");
const { countLine, countsForMark } = await import("../register-count.mjs");
const { paths } = await import("../run-record.mjs");

const demos = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });
const demoWith = (file) => demoChildren(demos).map((name) => join(demos, name)).find((dir) => existsSync(join(dir, "run", file)));

/** A copy of a demo run, changed by `change`, published into a pool of its own. Returns the run, its record and email. */
async function published(demo, change) {
  const root = mkdtempSync(join(tmpdir(), "cover-email-"));
  cpSync(demo, join(root, "sample"), { recursive: true });
  const runDir = join(root, "sample", "run"), pool = join(root, "pool");
  mkdirSync(pool);
  change(runDir);
  const meta = JSON.parse(readFileSync(join(root, "sample", "meta.json"), "utf8"));
  const out = await republishRun({ runId: meta.runId, meta, pool, poolUrl: "", runDir });
  const record = JSON.parse(readFileSync(join(pool, meta.runId, "meta.json"), "utf8"));
  return { runDir, meta, record, out };
}

const clearanceEmail = (runDir) => {
  const cover = coverNoteInputs(runDir);
  return { cover, html: composeCoverNote(cover, { url: "https://reports.example.test/r/", auditFile: "r-audit.xlsx", productName: cover.opts.productName }) };
};
const ratingIn = (html) => html.match(/Overall risk: ([^.<]+)\./)?.[1] ?? null;

test("an assessment that did not complete rates nothing in its cover email, as on its page", async () => {
  const demo = demoWith("report.md");
  const { runDir, record } = await published(demo, (dir) => {
    assert.ok(existsSync(paths(dir).verdict), "premise: the run keeps a verdict record");
    mkdirSync(join(dir, "_driver", "not-completed"), { recursive: true });
    writeFileSync(join(dir, "_driver", "not-completed", "assessment.json"), JSON.stringify({ part: "assessment", stage: "assess", reason: "spent" }));
  });
  assert.equal(record.overall, undefined, "premise: the run record, as the page, states no rating");
  const { cover, html } = clearanceEmail(runDir);
  assert.equal(ratingIn(html), null, "the email rated a run whose assessment did not complete");
  assert.equal(cover.opts.tier, undefined, "the delivery notice's rating would come from the incomplete assessment");
  // The conclusion stands alone, as on a run with no rating.
  const caption = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8")).prose.frontMatter.overall_caption;
  assert.ok(caption && html.includes(caption.slice(0, 40)), "the report's own conclusion left the email");
});

test("an older verdict record's email states the rating the page derives from it, not the front matter's label", async () => {
  const demo = demoWith("report.md");
  const { runDir, record } = await published(demo, (dir) => {
    const v = JSON.parse(readFileSync(paths(dir).verdict, "utf8"));
    // The record as written before it carried its display fields, and a front-matter label the derivation does not give.
    writeFileSync(paths(dir).verdict, JSON.stringify({ ts: v.ts, verdict: v.verdict, reasons: v.reasons, kinds: v.kinds }));
    const md = readFileSync(join(dir, "report.md"), "utf8");
    const label = md.match(/^overall_label: (.+)$/m)?.[1];
    assert.ok(label, "premise: the report states a label");
    writeFileSync(join(dir, "report.md"), md.replace(/^overall_label: .+$/m, `overall_label: ${label === "Moderate" ? "High" : "Moderate"}`));
  });
  assert.ok(record.overall, "premise: the page derives a rating");
  const { cover, html } = clearanceEmail(runDir);
  assert.equal(ratingIn(html), record.overall, "the email's rating is not the page's");
  assert.equal(cover.opts.tier, record.overall, "the delivery notice's rating is not the page's");
  // The reviewer keeps the record as it was written.
  const doc = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8"));
  assert.equal(doc.verdict.written.tier, undefined, "the record as written was rewritten");
});

test("a Knockout email states the page's register counts where the lane holds none", async () => {
  const demo = demoWith("knockout-findings.json");
  assert.ok(demo, "the demo container holds no Knockout");
  const { runDir, out } = await published(demo, () => {});
  const doc = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8"));
  const saved = JSON.parse(readFileSync(paths(runDir).registerCounts, "utf8"));
  const mark = doc.client.findings.marks[0].name;
  const line = countLine(countsForMark(saved, mark));
  assert.ok(line, "premise: the run saved a count for its name");
  assert.deepEqual(doc.client.registerCounts, saved, "premise: the page's counts are the saved record's");
  // A resumed lane handing over no counts of its own.
  const html = composeKnockoutCoverNote(runDir, { findings: doc.client.findings, framework: doc.framework.manifest, overall: doc.verdict.overall,
    reports: out.reports, auditUrl: out.auditUrl, job: {}, registerCounts: null, qcFlags: [], productName: null });
  assert.ok(html.includes(line), "the email left out the counts the page states");
});
