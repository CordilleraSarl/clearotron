// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// list-profiles-archived.test.mjs — the INTAKE ROSTER filter.
//
// list_profiles is what the intake AI resolves a projectKey against, so a project it cannot see is a
// project it cannot pick. Archiving a project must therefore remove it from this roster — that is the
// mechanism by which "archived" actually stops new work naming it, and it is worth its own file because
// it needs its OWN profiles store rather than the shipped one that list-profiles.test.mjs reads.
//
// The env-then-dynamic-import dance is the _fixture.mjs discipline: profiles.mjs freezes PROFILE_DIR from
// CLEAROTRON_CUSTOMERS_DIR at module load, so ESM hoisting would pin the shipped dir if server.mjs were
// imported statically here. _fixture is imported statically only for CLEAROTRON_WORK_DIR.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "./_fixture.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const dir = mkdtempSync(join(tmpdir(), "mcp-projects-archive-"));
writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
writeFileSync(join(dir, "acme.json"), JSON.stringify({ name: "Acme Industrial", matchDomains: ["acme.example"], platforms: ["alibaba.com"] }));
mkdirSync(join(dir, "projects", "acme"), { recursive: true });
writeFileSync(join(dir, "projects", "acme", "live-one.json"), JSON.stringify({ projectName: "Live one", platforms: ["amazon.com"] }));
writeFileSync(join(dir, "projects", "acme", "retired-one.json"), JSON.stringify({ archived: true, projectName: "Retired one", platforms: ["walmart.com"] }));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", dir);

let tools;
before(async () => { ({ tools } = await import("../server.mjs")); });

test("list_profiles: an ARCHIVED project is not offered to intake; its live sibling still is", () => {
  const acme = tools.list_profiles().clients.find((c) => c.key === "acme");
  assert.ok(acme, "acme is on the roster");
  assert.deepEqual(acme.projects.map((p) => p.key), ["live-one"],
    "the archived project is absent — a name intake cannot see is a name it cannot pick");
  // and the customer itself is untouched: archiving a project retires an engagement, never a client.
  assert.equal(acme.name, "Acme Industrial");
});
