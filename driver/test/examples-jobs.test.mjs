// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// examples/*.json — the job files a first-time reader copies.
//
// An example that no longer validates is worse than no example: it is a working shape, in the repo,
// that the door refuses. These tests hold every example job against BOTH doors it can reach — the
// validator directly, and the enqueue CLI's own assembly path — so a schema change that retires a field
// or renames a product breaks here rather than in somebody's first five minutes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJob, DECLARED_JOB_FIELDS } from "../enqueue-schema.mjs";
import { PRODUCT_IDS } from "../products.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const EXAMPLES = join(REPO, "examples");
const ENQUEUE = join(REPO, "driver", "enqueue.mjs");

const exampleJobs = existsSync(EXAMPLES)
  ? readdirSync(EXAMPLES).filter((f) => f.startsWith("job.") && f.endsWith(".json")).sort()
  : [];

test("there is at least one example job — an empty examples/ is a finding, not a pass", () => {
  assert.ok(exampleJobs.length > 0, `no job.*.json under ${EXAMPLES}`);
});

for (const file of exampleJobs) {
  const path = join(EXAMPLES, file);

  test(`${file} validates clean: ok, classify "run", and no warnings`, () => {
    // Spread-copy: validateJob normalises IN PLACE (jurisdictions, geography, deadline), so a shared
    // object would carry one test's normalisation into the next.
    const v = validateJob({ ...JSON.parse(readFileSync(path, "utf8")) });
    assert.deepEqual(
      { ok: v.ok, classify: v.classify, errors: v.errors, warnings: v.warnings },
      { ok: true, classify: "run", errors: [], warnings: [] },
    );
  });

  test(`${file} declares only fields the intake contract knows`, () => {
    // A field the schema does not declare is silently ignored by every door — so an example carrying one
    // teaches a setting that does nothing.
    const job = JSON.parse(readFileSync(path, "utf8"));
    const undeclared = Object.keys(job).filter((k) => !DECLARED_JOB_FIELDS.includes(k));
    assert.deepEqual(undeclared, [], `undeclared field(s) in ${file}`);
  });

  test(`${file} passes the enqueue CLI's own assembly, not just the validator`, () => {
    // --dry-run runs the real door: file read, flag overlay, validate, classify — and writes nothing.
    const out = execFileSync(process.execPath, [ENQUEUE, "--job", path, "--dry-run"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const res = JSON.parse(out);
    assert.equal(res.ok, true, out);
    assert.equal(res.classify, "run", out);
    assert.equal(res.dryRun, true, out);
  });
}

test("job.euipo.json is EU-only and names a product whose geography admits a region", () => {
  // The file exists to be the free-tier example: EUIPO covers the EU register and nothing else, so an
  // example naming a territory outside it would send a first-time reader at a provider that cannot
  // answer — the failure would surface as an empty register, which reads like a clean result.
  const job = JSON.parse(readFileSync(join(EXAMPLES, "job.euipo.json"), "utf8"));
  assert.deepEqual(job.jurisdictions, ["EU"], "EU and nothing else");
  assert.ok(PRODUCT_IDS.includes(job.product), `product ${job.product} is one of ${PRODUCT_IDS.join(", ")}`);
  assert.equal(job.profileKey, "generic", "rated under the house default, which every install has");
});
