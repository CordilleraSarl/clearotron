// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// regen-surfaces.test.mjs — regenSurfaces re-renders the staff pages (quality hub / run-status) into the
// pool, shared by publishReport AND pool-admin so any pool-mutation path leaves the same on-disk result as
// a full publish. The page is BEST-EFFORT: the status-page module is NOT shipped in this
// product (deferred — see the Phase-1 port decision; revisit as a Phase-4 quality subsystem), so on a bare
// install regenSurfaces must degrade to a clean no-op — never a throw, never partial residue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenSurfaces } from "../publish/index.mjs";

test("regenSurfaces on a bare pool without the status-page harness: clean no-op, never a throw", async () => {
  const pool = mkdtempSync(join(tmpdir(), "regen-"));
  await regenSurfaces(pool);   // bare pool, no page modules shipped
  assert.deepEqual(readdirSync(pool), [], "no partial staff-page residue without the quality harness");
});
