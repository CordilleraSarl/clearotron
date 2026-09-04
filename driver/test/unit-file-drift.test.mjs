// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A UNIT-FILE CHANGE IN GIT NEVER REACHED A BOX, AND NOTHING SAID SO.
//
// The test instance pulled a commit that changed `driver/systemd/prelim-driver.service`. Its LIVE unit
// did not change:
//
//   $ git show HEAD:driver/systemd/prelim-driver.service | grep -c CLEAROTRON_NO_ENV_FILE   → 1
//   $ grep -c CLEAROTRON_NO_ENV_FILE ~/.config/systemd/user/prelim-driver.service            → 0
//
// The box was running new code under an old unit. This is the expensive kind of failure: it fails
// silently AND it fails GREEN — the deploy succeeds, the service starts, the health check passes,
// because the unit that is running is a perfectly valid unit. It is just not the one in the commit.
// Every systemd unit edit in this repo's history has the same property.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unitFileDriftVerdict, unitBody, isTemplateUnit } from "../unit-file-drift.mjs";
import { findUnitFiles, unitFilePath } from "../unit-files.mjs";

const UNIT = "[Unit]\nDescription=x\n\n[Service]\nEnvironment=CLEAROTRON_NO_ENV_FILE=1\nExecStart=/bin/true\n";
const OLD = "[Unit]\nDescription=x\n\n[Service]\nExecStart=/bin/true\n";

test("#646 a live unit that differs from the deployed commit is a FAILURE, and names the unit", () => {
  const v = unitFileDriftVerdict({ units: [
    { unit: "prelim-driver.service", live: OLD, tracked: UNIT, dropIns: [] },
    { unit: "profile-service.service", live: UNIT, tracked: UNIT, dropIns: [] },   // deleted portal-service.service
  ] });
  assert.equal(v.state, "fail");
  assert.deepEqual(v.drifted, ["prelim-driver.service"], "the unit is named — an unnamed drift is not actionable");
  assert.match(v.message, /differ from the commit that is deployed/);
  assert.match(v.message, /daemon-reload/, "…and the message says what to DO, because nothing else will");
});

test("#646 comments and blank lines are not drift", () => {
  // A unit is compared on what systemd acts on. A comment edit that failed this check would teach
  // whoever hit it to stop believing the check.
  const commented = "# a note added on the box\n\n[Unit]\nDescription=x\n\n; another\n[Service]\nEnvironment=CLEAROTRON_NO_ENV_FILE=1\nExecStart=/bin/true\n";
  assert.equal(unitBody(commented), unitBody(UNIT));
  assert.equal(unitFileDriftVerdict({ units: [{ unit: "u.service", live: commented, tracked: UNIT, dropIns: [] }] }).state, "pass");
});

test("#646 a DROP-IN is not drift — it is the sanctioned way a box carries what a repo must not", () => {
  // Secrets and per-host paths belong in `<unit>.d/*.conf`, and this deployment uses them for exactly
  // that. Failing on their presence would make the check unusable on the box it exists to protect.
  const v = unitFileDriftVerdict({ units: [
    { unit: "trademark-portal.service", live: UNIT, tracked: UNIT, dropIns: ["/x/trademark-portal.service.d/secrets.conf"] },
  ] });
  assert.equal(v.state, "pass");
  assert.match(v.message, /drop-ins present on trademark-portal\.service/,
    "…but a reader is told the effective unit is not the tracked file alone");
});

test("#646 COULD NOT LOOK is never a pass — the #395 rule, one layer down", () => {
  const v = unitFileDriftVerdict({ units: [], probe: { ok: false, why: "no XDG_RUNTIME_DIR" } });
  assert.equal(v.state, "skip");
  assert.match(v.message, /no unit file was COMPARED/);
  assert.match(v.message, /failure to look, not a finding about the deployment/);
  // and a unit whose fragment cannot be read is counted, never quietly dropped
  const partial = unitFileDriftVerdict({ units: [
    { unit: "a.service", live: null, tracked: UNIT, dropIns: [] },
    { unit: "b.service", live: UNIT, tracked: UNIT, dropIns: [] },
  ] });
  assert.equal(partial.state, "pass", "what could be compared, was");
  assert.match(partial.message, /1 unit\(s\) had no readable fragment and were NOT compared/,
    "…and what could not be compared is stated, rather than absorbed into the pass");
});

test("#646 nothing comparable is a SKIP, and says how many of each kind it saw", () => {
  const v = unitFileDriftVerdict({ units: [
    { unit: "a.service", live: null, tracked: UNIT, dropIns: [] },
    { unit: "b.service", live: UNIT, tracked: null, dropIns: [] },
  ] });
  assert.equal(v.state, "skip", "an empty comparison is not a clean one");
  assert.match(v.message, /2 unit\(s\) seen, 1 with no readable fragment, 1 with no tracked unit file anywhere in the tree/);
});

test("#646 every unit this repo ships, ANYWHERE, is a real file the check can compare against", () => {
  // The check is worth nothing if the tracked side is a path nobody maintains. Read from disk, so a
  // unit added or renamed without its file lands here.: over the whole tree — this used to read
  // driver/systemd/ alone, which is how four tracked unit files went uncompared.
  const { readFileSync } = require("node:fs");
  const root = new URL("../../", import.meta.url).pathname;
  const walk = findUnitFiles(root);
  assert.equal(walk.error, null, `the walk could not read the tree: ${walk.error}`);
  assert.ok(walk.files.length >= 9, `unit files shipped repo-wide: ${walk.files.length}`);
  assert.ok(walk.files.includes("client-mcp.service"), "mcp-server/remote/ is in scope now");
  for (const f of walk.files) {
    const body = unitBody(readFileSync(`${root}${unitFilePath(walk, f)}`, "utf8"));
    assert.ok(body.includes("[Unit]"), `${f} does not look like a unit file`);
    // a unit compared against itself must be clean, or the normaliser is eating something real
    assert.equal(unitFileDriftVerdict({ units: [{ unit: f, live: body, tracked: body, dropIns: [] }] }).state, "pass", f);
  }
});

// ══ — template units differ BY DESIGN, and the difference is reported, never a fault ═══════

const TEMPLATE = "# ── TEMPLATE UNIT ─────────────────────────\n"
  + "# The example.com values below are PLACEHOLDERS a new deployment must replace.\n" + UNIT;
const TEMPLATE_LIVE = TEMPLATE.replace("Description=x", "Description=x real");

test("#685 a TEMPLATE unit whose live copy differs is reported, and never counted as drift", () => {
  // Giving client-mcp and client-mcp-apikey the tracked files they always had ARMS this comparison. Both
  // are banner-marked templates: the live copies carry real CF Access values, the tracked copies carry
  // placeholders, so a byte comparison is red by construction. An instrument that is red on day one is
  // an instrument discounted by day two.
  const v = unitFileDriftVerdict({ units: [
    { unit: "client-mcp.service", live: TEMPLATE_LIVE, tracked: TEMPLATE, dropIns: [] },
    { unit: "prelim-driver.service", live: UNIT, tracked: UNIT, dropIns: [] },
  ] });
  assert.equal(v.state, "pass");
  assert.deepEqual(v.drifted, []);
  assert.deepEqual(v.templated, ["client-mcp.service"]);
  assert.match(v.message, /TEMPLATE unit\(s\) differ as designed/);
  assert.match(v.message, /does not check their contents at all/,
    "a reader must not take this pass as 'the client door's live values were checked'");
});

test("#685 a GENERIC unit that differs is still a FAIL, template or not sitting beside it", () => {
  const v = unitFileDriftVerdict({ units: [
    { unit: "client-mcp.service", live: TEMPLATE_LIVE, tracked: TEMPLATE, dropIns: [] },
    { unit: "prelim-driver.service", live: OLD, tracked: UNIT, dropIns: [] },
  ] });
  assert.equal(v.state, "fail");
  assert.deepEqual(v.drifted, ["prelim-driver.service"], "the exemption is per unit, never a global mute");
  assert.deepEqual(v.templated, ["client-mcp.service"]);
});

test("#685 the banner IN THE FILE is the discriminator, not a second list beside it", () => {
  assert.equal(isTemplateUnit(TEMPLATE), true);
  assert.equal(isTemplateUnit(UNIT), false, "a unit with no banner is generic and is compared");
  assert.equal(isTemplateUnit(null), false);
  // …and the repo's actual templates classify themselves. A list would be free to drift from the files.
  const { readFileSync } = require("node:fs");
  const root = new URL("../../", import.meta.url).pathname;
  const walk = findUnitFiles(root);
  const templates = walk.files.filter((f) => isTemplateUnit(readFileSync(`${root}${unitFilePath(walk, f)}`, "utf8")));
  // — `portal-service.service` and `recipe-service.service` left this census when the owner ruled
  // them deleted (2026-08-14). The census reads the FILES rather than a list precisely so a deletion
  // shows up here as a changed expectation rather than as a silent pass, which is what it just did.
  // — `profile-service.service` LEFT this set when the owner's one-config-per-server-box ruling
  // made it generic. It was a template because it loaded no EnvironmentFile and carried real CF Access
  // values inline; it now takes them from `EnvironmentFile=%h/.env` like every other service, so its
  // live copy is expected to MATCH and a difference there is real drift. The file says so in its own
  // first line, which is what this arm reads — and the expectation moving is the census working: a
  // reclassification shows up here as a changed expectation that someone has to justify, rather than as
  // a unit quietly dropping out of comparison.
  assert.deepEqual(templates.sort(), ["client-mcp-apikey.service", "client-mcp.service"],
    "the banner-marked set, per docs/architecture/05-config-governance.md tier 2");
  assert.ok(!templates.includes("profile-service.service"),
    "generic since #1925: it reads EnvironmentFile=%h/.env, so its live copy must match the tracked one");
  assert.ok(!templates.includes("trademark-artifacts-http.service"),
    "it carries no banner and no placeholder — it defers to the EnvironmentFile, so its live copy is "
    + "expected to MATCH and a difference there is real drift");
});
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
