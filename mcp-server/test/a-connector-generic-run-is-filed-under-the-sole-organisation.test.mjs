// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A Generic run started through an ops token is filed under the install's organisation when there is
// exactly one.
//
// The defect: the ops branch of `authorize` passed a Generic job through with no `tenant`, so every
// Generic run a connector started was filed under no organisation. Clearances filters Generic by
// organisation, so with the switcher on Generic those runs were nowhere, while the grouped view listed
// them under a heading that also read Generic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveScope, authorize, mintToken } from "../lib/scope.mjs";
import { buildJob } from "../lib/ops.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "test-secret-sole-organisation";

const dir = mkdtempSync(join(tmpdir(), "sole-org-grants-"));
const grantsFile = (name, tenants) => {
  const p = join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify({ tenants }));
  return p;
};
const ONE = grantsFile("one", { acme: { accounts: ["acme-labs"], users: { "lawyer@acme.example": "*" } } });
const TWO = grantsFile("two", {
  acme: { accounts: ["acme-labs"], users: { "lawyer@acme.example": "*" } },
  globex: { accounts: ["globex-retail"], users: { "counsel@globex.example": "*" } },
});

const withGrants = (path, fn) => {
  const prior = process.env.CLEAROTRON_ACCESS_FILE;
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", path);
  try { return fn(); } finally {
    if (prior === undefined) pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);
    else pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", prior);
  }
};
const ops = () => resolveScope({ innerToken: mintToken({ scope: "ops", sub: "connector-intake" }) });
const ORDER = { markName: "Zentrova", forwarder: "intake", classes: [9] };

test("one organisation: a Generic start_run and plan_run through an ops token carry it", () => withGrants(ONE, () => {
  for (const tool of ["start_run", "plan_run"]) {
    assert.equal(authorize(ops(), tool, ORDER).tenant, "acme", `${tool}: filed under the install's only organisation`);
  }
  // And it reaches the queued job, which is what the pool's meta records as the run's organisation.
  assert.equal(buildJob(authorize(ops(), "start_run", ORDER), { scope: ops() }).tenant, "acme");
}));

test("one organisation: a company run is not given a tenant", () => withGrants(ONE, () => {
  assert.equal(authorize(ops(), "start_run", { ...ORDER, profileKey: "acme-labs" }).tenant, undefined);
}));

test("two organisations: a Generic run is left unplaced rather than guessed", () => withGrants(TWO, () => {
  assert.equal(authorize(ops(), "start_run", ORDER).tenant, undefined);
}));

test("a named tenant passes through unchanged", () => withGrants(TWO, () => {
  assert.equal(authorize(ops(), "start_run", { ...ORDER, tenant: "globex" }).tenant, "globex");
}));

test("no grants file: nothing is stamped", () => withGrants(undefined, () => {
  assert.deepEqual(authorize(ops(), "start_run", ORDER), ORDER);
}));
