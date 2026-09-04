// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// list-profiles.test.mjs — the project nesting on the read-face roster (list_profiles).
//
// Imports the REAL `tools` handler from server.mjs. The bottom-of-file isMain guard means importing does
// NOT connect a transport, so calling tools.list_profiles() is a plain function call. Needs the MCP deps
// installed (npm ci — @modelcontextprotocol/sdk / jose), like cf-access / http-handler / delivery-state.
// Profiles/overlays load from the module-relative profiles dir (profiles.mjs PROFILE_DIR), so the first
// shipped overlay aurora/console-ecosystem is the fixture — no temp workspace needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tools } from "../server.mjs";

test("list_profiles: nests each customer's spec-62 projects so intake can resolve a projectKey", () => {
  const out = tools.list_profiles();
  assert.ok(Array.isArray(out.clients), "clients is an array");
  assert.equal(out.genericFallback, "generic");
  assert.ok(!out.clients.some((c) => c.key === "generic"), "the neutral generic profile is never offered as a client");

  // the contract intake relies on: EVERY client carries a projects[] (a no-overlay customer gets [], never
  // undefined — the handler's `byCustomer.get(p.key) ?? []`). Without this, projects[].length reads throw.
  for (const c of out.clients) {
    assert.ok(Array.isArray(c.projects), `client "${c.key}" carries a projects[] array (spec 62)`);
    assert.ok("industry" in c, `client "${c.key}" surfaces industry (null when unset)`);
  }

  const aurora = out.clients.find((c) => c.key === "aurora");
  assert.ok(aurora, "aurora is on the roster");
  const overlay = aurora.projects.find((p) => p.key === "console-ecosystem");
  assert.ok(overlay, "the console-ecosystem overlay is nested under its customer");
  assert.equal(overlay.name, "Console ecosystem", "the display name (projectName) is surfaced for intake, not the slug");
});
