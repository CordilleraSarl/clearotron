// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// #1761 — A DRAFT RUN'S GREEN MUST NOT BE INHERITED AS "ALREADY VERIFIED".
//
// The chain this guards: a draft PR run reports `success` with the expensive tier's steps SKIPPED; if that
// tree later reaches main, the duplicate-tree skip would inherit that green and skip the tier again, so the
// bundle-freshness gate runs on neither side and nothing is red to point at.
//
// The fix asks the direct question — did the run we are inheriting from actually execute the witness step —
// rather than inferring draft-ness, which is a proxy and whose state can change after the run. That makes
// the WITNESS STEP NAME load-bearing, and a rename would fail safe (always run the tier) while silently
// costing a full tier on every duplicate push. Nobody would notice that, which is what these arms are for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

const witness = () => {
  const m = CI.match(/^\s*TIER_WITNESS_STEP:\s*(.+?)\s*$/m);
  assert.ok(m, "TIER_WITNESS_STEP is gone from ci.yml — the duplicate-skip check has nothing to look for");
  return m[1];
};

test("#1761 the witness step NAMES A REAL STEP — a rename would cost a tier on every duplicate push, silently", () => {
  const name = witness();
  assert.ok(CI.includes(`- name: ${name}`),
    `TIER_WITNESS_STEP is "${name}" but no step in ci.yml is called that. The duplicate-skip check would `
    + "find nothing, fail open, and run the expensive tier on every duplicate push — safe, and a silent cost.");
});

test("#1761 the witness step is GATED ON THE TIER — a step that always runs witnesses nothing", () => {
  const name = witness();
  const at = CI.indexOf(`- name: ${name}`);
  assert.ok(at > 0);
  // The `if:` belongs to this step, so look only as far as the next step in the same list.
  const next = CI.indexOf("\n      - name:", at + 1);
  const block = CI.slice(at, next > 0 ? next : undefined);
  assert.match(block, /if:\s*needs\.changes\.outputs\.run_expensive_tier == 'true'/,
    `"${name}" is not gated on run_expensive_tier, so its conclusion says nothing about whether the tier ran `
    + "— it would report success on a draft run too, and the check would inherit exactly the green it exists to reject");
});

test("#1761 the duplicate branch FAILS OPEN on every unknown, and says which", () => {
  const branch = CI.slice(CI.indexOf('if [ "${EVENT_NAME}" = "push" ] && [ "${DUPLICATE_PUSH}" = "true" ]'));
  const head = branch.slice(0, branch.indexOf("\n          fi"));
  // Two ways of not knowing — the matched run is unidentifiable, or its jobs are unreadable — and both must
  // RUN the tier rather than skip it. The direction is the whole safety argument.
  assert.match(head, /could not be identified — running the expensive tier/);
  assert.match(head, /did not run the expensive tier/);
  const skips = [...head.matchAll(/run_expensive_tier=false/g)].length;
  assert.equal(skips, 1, "the duplicate branch has more than one way to skip the tier — every added path is one that has not been reasoned about");
});

test("#1761 the matched run is actually PLUMBED THROUGH — an output nothing consumes is not a check", () => {
  assert.match(CI, /skipped_by:\s*\$\{\{\s*steps\.skip\.outputs\.skipped_by\s*\}\}/,
    "skip-check no longer publishes which run it matched");
  assert.match(CI, /SKIPPED_BY:\s*\$\{\{\s*needs\.skip-check\.outputs\.skipped_by\s*\}\}/,
    "the decide step is not given the matched run, so its check reads an empty string and fails open forever");
});

test("#1761 the decide job holds `actions: read` — without it the whole check is INERT, and silently", () => {
  // Measured, not assumed: run 32667093055's setup log lists this job's token as contents/metadata/packages
  // read and nothing else. The duplicate check reads the matched run's jobs through the Actions API, so
  // without this scope it 403s every time, takes the fail-open path, and the skip is lost permanently while
  // every surface stays green. That is the most expensive way this change could fail, and the cheapest to pin.
  const at = CI.indexOf("name: Decide whether the expensive tier");
  assert.ok(at > 0, "the decide job was renamed — this arm can no longer find it");
  const block = CI.slice(at, CI.indexOf("\n    steps:", at));
  // #1790 — ANCHORED TO A YAML KEY LINE, because the loose form was satisfied by the COMMENT that
  // explains why the permission is needed. Measured by the e2e lane: delete `actions: read` and leave the
  // prose, and this arm stayed green; delete the prose too and it finally red. The guard was reading its
  // own justification. `^\s*<key>:` cannot match a comment — that line begins with `#`.
  assert.match(block, /^\s*permissions:\s*$/m, "the decide job declares no permissions, so it inherits a default without Actions read");
  assert.match(block, /^\s*actions:\s*read\s*$/m, "the decide job cannot read the Actions API — the duplicate check would 403 and fail open forever");
  // A job-level block REPLACES the default rather than adding to it, so checkout's own need must be restated.
  assert.match(block, /^\s*contents:\s*read\s*$/m, "declaring permissions without contents:read would break the checkout in this job");
});
