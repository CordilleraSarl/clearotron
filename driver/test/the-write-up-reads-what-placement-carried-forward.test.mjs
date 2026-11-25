// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITE-UP READS WHAT PLACEMENT CARRIED FORWARD, NOT THE WHOLE BAND.
//
// The register manual's mode lines told the write-up to read the complete merged band through the band tools, where
// the same manual says it reads the candidates placement carried forward. The shared manual no longer has mode lines:
// each mode's session is described in its own file. This holds the line in the write-up's own manual, and that no
// register manual tells it to read the whole band.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DIGEST_SENTENCES } from "./ruled-sentences-digest.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the write-up's session reads the candidates placement carried forward and their evidence", () => {
  assert.ok(flat("digest.md").includes(DIGEST_SENTENCES.workerReadsTheCandidatesPlacementCarried));
  for (const f of ["SKILL.md", "unit.md", "digest.md"])
    assert.ok(!/read the complete merged band/i.test(flat(f)), `${f} still tells the write-up to read the whole band`);
});
