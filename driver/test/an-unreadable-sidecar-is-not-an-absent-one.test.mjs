// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-unreadable-sidecar-is-not-an-absent-one.test.mjs — the filings line states which of the two happened.
//
// The page has two sentences and they say different things. A sidecar that is ABSENT means the listing was
// never taken: "The filings behind those counts were not listed on this run." A sidecar that could not be
// READ means it was taken and this run cannot say what it found: "The filings behind the counts could not
// be listed on this run, so nothing here says whether one stands."
//
// The second was written for the lister's own refusal and was unreachable from a republish. The publisher
// loaded the sidecar in a try/catch that set it to null, and null reads as absent — so a run whose filings
// file was present but corrupt published the sentence for a run that never listed anything. The sentence
// was right; the value that selects it was wrong. The load beside it, for the instructed scope, has told
// the two apart with `existsSync` in its catch since it was written.
//
// THE CONTROLS ARE THE POINT. A page that stopped printing either sentence passes the first arm on its
// own, so each arm asserting one sentence also asserts the other is absent, and the last two hold the
// cases that must NOT have changed: the lister's own refusal, and an ordinary readable listing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { publishKnockout } from "../publish/knockout.mjs";

const FW = {
  framework_key: "house-triage",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};
const MARK = { name: "IRONWHISK", rating: "Manageable", basis: "b", factors: ["f"], counterFactors: ["c"], findings: [] };
const COUNTS = { marks: [{ name: "IRONWHISK", counts: { identical: 1, containing: 2, close: 3 } }] };

const ABSENT = "The filings behind those counts were not listed on this run.";
const UNREADABLE = "The filings behind the counts could not be listed on this run, so nothing here says whether one stands.";

const page = (opts) => renderKnockoutHtml({ marks: [MARK], batch: { executiveSummary: "s" } }, FW,
  { runId: "r", overall: "Manageable", identity: { identity: "Knockout search" }, probeRan: true,
    registerCounts: COUNTS, ...opts });

test("a sidecar that could not be READ says so, and does not claim the listing was never taken", () => {
  const html = page({ registerRecords: null, registerRecordsUnreadable: true });
  assert.ok(html.includes(UNREADABLE), "the unreadable sentence never reached the page");
  assert.ok(!html.includes(ABSENT), "the page also claims the filings were never listed, which is the wrong cause");
});

test("CONTROL: a sidecar that is ABSENT still says the listing was never taken", () => {
  // Without this the arm above passes on a renderer that prints the unreadable sentence for everything.
  const html = page({ registerRecords: null, registerRecordsUnreadable: false });
  assert.ok(html.includes(ABSENT), "the absent sentence was lost");
  assert.ok(!html.includes(UNREADABLE), "an absent sidecar is now reported as one that could not be read");
});

test("CONTROL: the lister's own refusal is unchanged, to the byte", () => {
  // The sentence moved to a shared constant. This holds that the branch it came from still returns it.
  const html = page({ registerRecords: { unavailable: "the register refused the listing" } });
  assert.ok(html.includes(UNREADABLE), "the refusal branch stopped returning its sentence");
});

test("CONTROL: an ordinary readable listing prints neither sentence", () => {
  // The case that must not have moved at all: a sidecar that loaded and holds a listing.
  const html = page({
    registerRecords: { marks: [{ name: "IRONWHISK", records: [], cap: 50, capped: false,
      terms: [{ term: "IRONWHISK", basis: "identical", ok: true, fetched: 0 }] }] },
  });
  assert.ok(!html.includes(UNREADABLE), "a readable listing was reported as unreadable");
  assert.ok(!html.includes(ABSENT), "a readable listing was reported as never taken");
});

test("the flag defaults to false, so every existing caller renders as it did", () => {
  // The unit fixtures and both render-check scripts pass no such option. This pins the default.
  const html = page({ registerRecords: null });
  assert.ok(html.includes(ABSENT));
  assert.ok(!html.includes(UNREADABLE));
});

// ── and the VALUE reaches the branch, which is the half the defect was in ───────────────────────────
//
// The arms above pass the flag straight to the renderer, so on their own they prove a branch exists and
// nothing about whether anything sets it. That is the exact shape of the defect: the sentence was right
// and the value that selects it was not. These two publish a real run directory and read the page.

const FRAMEWORK = { framework_key: "house-triage", title: "t",
  bands: [{ label: "Medium", tone: "medium" }, { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };

/** Publish a run whose filings sidecar is written by `write`, and return its page. */
async function publishedPage(write) {
  const root = mkdtempSync(join(tmpdir(), "unreadable-sidecar-"));
  const runDir = mkdtempSync(join(root, "run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "framework.json"), JSON.stringify(FRAMEWORK));
  writeFileSync(driverDir(runDir, "register-counts.json"), JSON.stringify(COUNTS));
  write(runDir);
  const poolRoot = mkdtempSync(join(root, "pool-"));
  const runId = `unreadable-${Math.random().toString(36).slice(2, 8)}`;
  await publishKnockout({
    runId, codename: "fixture", runDir, framework: FRAMEWORK, overall: "Low",
    findings: { marks: [{ name: "IRONWHISK", rating: "Low", bullets: ["Synthetic fixture."], findings: [] }] },
    poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", skipRegen: true,
  });
  return readFileSync(join(poolRoot, runId, "report.html"), "utf8");
}

test("a filings sidecar that is on disk and will not parse publishes the unreadable sentence", async () => {
  const html = await publishedPage((runDir) =>
    writeFileSync(driverDir(runDir, "register-records.json"), "{ this is not json"));
  assert.ok(html.includes(UNREADABLE), "a corrupt sidecar still published the sentence for a listing never taken");
  assert.ok(!html.includes(ABSENT), "and it also claims the filings were never listed");
});

test("CONTROL: with NO filings sidecar on disk, the same publish says the listing was never taken", async () => {
  // The control that makes the arm above about the file's readability and not about the publish path.
  const html = await publishedPage(() => {});
  assert.ok(html.includes(ABSENT), "an absent sidecar lost its sentence");
  assert.ok(!html.includes(UNREADABLE), "an absent sidecar is reported as one that could not be read");
});
