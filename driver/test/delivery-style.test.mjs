// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// delivery.style: an optional per-customer PROSE-STYLE directive on the delivery
// overlay. It tunes the CURATION wording (report-overview/-card) only — presentation, not
// the rating — so it carries the anti-rule guard and must never reach synthesis (where Level/Composite
// are set).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProfiles, DEFAULT_DELIVERY_TEMPLATE, KNOWN_DELIVERY_TEMPLATES } from "../profiles.mjs";
import { STAGES } from "../stages.mjs";

const GENERIC = { name: "House default", platforms: ["amazon.com"] };
function dir(profiles) {
  const d = mkdtempSync(join(tmpdir(), "delstyle-"));
  for (const [k, obj] of Object.entries(profiles)) writeFileSync(join(d, `${k}.json`), JSON.stringify(obj));
  return d;
}

test("delivery.style: a prose string is accepted; unknown delivery key and rule-shaped style are rejected at load", () => {
  const ok = dir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"], delivery: { email: "summary", style: "Plain, direct British English; short paragraphs; lead with the decision." } } });
  assert.doesNotThrow(() => loadProfiles({ dir: ok, force: true }));
  const unknown = dir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"], delivery: { tone: "formal" } } });
  assert.throws(() => loadProfiles({ dir: unknown, force: true }), /not a known delivery key/);
  const ruleShaped = dir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"], delivery: { style: "Rate every look-alike as high risk." } } });
  assert.throws(() => loadProfiles({ dir: ruleShaped, force: true }), /must be CONTEXT|threshold|percentage/);
});

test("delivery.style feeds report-overview (presentation) but NEVER synthesis (the rating); absent ⇒ omitted", () => {
  const P = { narrative: "/r/n.md", registerFindings: "/r/rf.md", commonLaw: "/r/cl.md", placement: "/r/p.md", seniorEyeReview: "/r/le.md", matterContext: "/r/mc.md", report: "/r/report.md", reportOverview: "/r/ro.md", findings: "/r/findings.json", variantManifest: "/r/vm.md" };
  const profile = { delivery: { email: "summary", style: "Warm, plain English; no legalese." } };
  const ro = STAGES["report-overview"].message({ paths: P, job: {}, profile });
  assert.match(ro, /PROSE STYLE/);
  assert.match(ro, /Warm, plain English/);
  const syn = STAGES["synthesis"].message({ paths: P, job: {}, profile });
  assert.doesNotMatch(syn, /PROSE STYLE/, "synthesis (the rating stage) must never receive the style directive");
  // absent ⇒ falsy-omitted (byte-identical to a style-less run)
  assert.doesNotMatch(STAGES["report-overview"].message({ paths: P, job: {}, profile: { delivery: { email: "summary" } } }), /PROSE STYLE/);
});

test("delivery.template: a known variant is accepted; an unknown one is rejected at load; default is 'standard'", () => {
  assert.equal(DEFAULT_DELIVERY_TEMPLATE, "standard");
  assert.ok(KNOWN_DELIVERY_TEMPLATES.includes("standard"));
  const ok = dir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"], delivery: { template: "standard" } } });
  assert.doesNotThrow(() => loadProfiles({ dir: ok, force: true }));
  const bad = dir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"], delivery: { template: "memo" } } });
  assert.throws(() => loadProfiles({ dir: bad, force: true }), /not a known template/);
});

test("no dead knob: the publish path consumes delivery.template (stamped into meta)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pjoin } = await import("node:path");
  const src = readFileSync(pjoin(dirname(fileURLToPath(import.meta.url)), "..", "publish", "index.mjs"), "utf8");
  assert.ok(src.includes("deliv?.template") || src.includes("delivery?.template"), "delivery.template must have a live consumer in the publish path");
});

test("no dead knob: both curation stages (report-overview/-card) consume profile.delivery.style", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pjoin } = await import("node:path");
  const src = readFileSync(pjoin(dirname(fileURLToPath(import.meta.url)), "..", "stages.mjs"), "utf8");
  const hits = (src.match(/profile\?\.delivery\?\.style/g) || []).length;
  // Was 3 until 2026-08-01; `client-summary` was the third and is retired.
  assert.ok(hits >= 2, `expected delivery.style consumed in the 2 curation stages, found ${hits}`);
});
