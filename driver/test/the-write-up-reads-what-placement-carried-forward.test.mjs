// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITE-UP READS WHAT PLACEMENT CARRIED FORWARD, NOT THE WHOLE BAND.
//
// The register manual's mode lines told the write-up to read the complete merged band through the band tools, where
// the same manual says it reads the candidates placement carried forward. The mode lines now say so too. This holds the
// ruled line in both places and that the old one is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the write-up's mode lines read the candidates placement carried forward and their evidence", () => {
  const manual = flat("SKILL.md");
  assert.ok(manual.includes("read the candidates placement carried forward, and their evidence, through the band tools"));
  assert.ok(manual.includes("Read the candidates placement carried forward, and their evidence, through the band tools"));
  assert.ok(!/read the complete merged band/i.test(manual), "the register manual still tells the write-up to read the whole band");
});
