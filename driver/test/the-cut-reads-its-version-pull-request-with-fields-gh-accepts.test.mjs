// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CUT READS ITS VERSION PULL REQUEST WITH FIELDS GH ACCEPTS.
//
// When a dispatched cut's wait expires, it reads the version pull request to say why it did not merge. It asked
// gh for a `merged` field, which the release runner's gh refuses ("Unknown JSON field"). Every expired wait then
// reported the pull request as unreadable, measured on the 0.5.0-beta.0 cut on 2026-10-21. The read now asks for
// `state` and `mergedAt` and takes either as the answer. gh is injected, so nothing here calls the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readVersionPr } from "../../scripts/release-await-cut.mjs";

// gh as the runner has it: a field it does not know is refused, as gh refuses it.
const KNOWN = new Set(["state", "mergedAt", "mergeable", "statusCheckRollup", "number", "title", "headRefOid"]);
const gh = (answer, asked) => (args) => {
  const fields = String(args[args.indexOf("--json") + 1] ?? "").split(",");
  asked.push(...fields);
  const unknown = fields.find((f) => !KNOWN.has(f));
  if (unknown) { const e = new Error(`Unknown JSON field: "${unknown}"`); e.stderr = `Unknown JSON field: "${unknown}"`; throw e; }
  return JSON.stringify(answer);
};

test("a merged version pull request reads as merged, from fields gh accepts", async () => {
  const asked = [];
  const pr = await readVersionPr(539, { run: gh({ state: "MERGED", mergedAt: "2026-10-21T08:48:54Z", mergeable: "UNKNOWN", statusCheckRollup: [] }, asked) });
  assert.ok(!asked.includes("merged"), `the read asked gh for a field it refuses: ${asked.join(",")}`);
  assert.equal(pr.unread, undefined, `the pull request read as unreadable: ${pr.why}`);
  assert.equal(pr.merged, true);
});

test("an open version pull request reads as open, with its checks and whether it can merge", async () => {
  const pr = await readVersionPr(539, { run: gh({ state: "OPEN", mergedAt: null, mergeable: "MERGEABLE",
    statusCheckRollup: [{ name: "The offline suites", conclusion: "ACTION_REQUIRED" }] }, []) });
  assert.equal(pr.merged, false);
  assert.equal(pr.mergeable, true);
  assert.deepEqual(pr.checks, [{ context: "The offline suites", conclusion: "action_required" }]);
});

test("a read gh refuses still says so, with gh's own words", async () => {
  const pr = await readVersionPr(539, { run: () => { const e = new Error("HTTP 502"); e.stderr = "HTTP 502: Bad Gateway"; throw e; } });
  assert.deepEqual([pr.unread, pr.number, pr.why], [true, 539, "HTTP 502: Bad Gateway"]);
});
