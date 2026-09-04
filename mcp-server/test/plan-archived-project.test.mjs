// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// plan_run and an ARCHIVED project.
//
// plan_run (#31) is a new door that names a project, and it arrived after the archive change was
// written — so nothing pinned the two together. No production code was needed: every door funnels
// through validateJob, and plan_run folds `!v.ok` into its blockers, so the archived rule reaches it
// for free. This test exists because "correct by construction" is worth exactly as much as the test
// that stops the construction changing underneath it.
//
// Its own file for the same reason the driver's archived test has one: profiles.mjs freezes
// PROFILE_DIR from CLEAROTRON_CUSTOMERS_DIR at module load, so the env must be set before the import
// chain runs, and ESM hoisting rules that out inside plan.test.mjs (which reads the shipped store).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const dir = mkdtempSync(join(tmpdir(), "plan-archived-"));
writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
writeFileSync(join(dir, "acme.json"), JSON.stringify({
  name: "Acme Industrial", matchDomains: ["acme.example"], platforms: ["alibaba.com"],
}));
mkdirSync(join(dir, "projects", "acme"), { recursive: true });
writeFileSync(join(dir, "projects", "acme", "live-one.json"),
  JSON.stringify({ projectName: "Live one", platforms: ["amazon.com"] }));
writeFileSync(join(dir, "projects", "acme", "retired-one.json"),
  JSON.stringify({ archived: true, projectName: "Retired one", platforms: ["walmart.com"] }));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", dir);

// A throwaway workspace so an accidental write would land somewhere visible rather than in a real tree.
const ROOT = mkdtempSync(join(tmpdir(), "plan-archived-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
const QUEUE = join(ROOT, "workspace-clawdi", "studio", "prelim-search", "queue");

const BASE = { forwarder: "ops", markName: "QUEUE PROBE", classes: [9], profileKey: "acme" };
let planRun;
before(async () => { ({ planRun } = await import("../lib/plan.mjs")); });

test("plan_run refuses to preview a run against an ARCHIVED project", () => {
  const p = planRun({ ...BASE, projectKey: "retired-one" });
  assert.equal(p.ok, false);
  assert.equal(p.wouldRun, false, "the preview says plainly that this would not run");
  assert.match(p.blockers.join(" "), /is archived/, "and names the real reason");
  // ARCHIVED and UNKNOWN stay distinct all the way out to the preview: telling someone their project
  // does not exist sends them hunting for a typo that is not there.
  assert.ok(!/no known project/.test(p.blockers.join(" ")), "not reported as a typo");
  assert.match(p.blockers.join(" "), /un-archive the project/, "and says how to proceed");
});

test("plan_run still previews the live sibling, and still writes nothing either way", () => {
  const before_ = existsSync(QUEUE) ? readdirSync(QUEUE).length : 0;
  const live = planRun({ ...BASE, projectKey: "live-one" });
  assert.equal(live.wouldRun, true, "an archived sibling does not taint the live project");
  planRun({ ...BASE, projectKey: "retired-one" });
  const after = existsSync(QUEUE) ? readdirSync(QUEUE).length : 0;
  assert.equal(after, before_, "a blocked preview reserves nothing — it is still free");
});
