// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT FINDING'S REFUSAL IS ROUTED AS THE KNOCKOUT RECORD'S, NOT THE CLEARANCE WRITER'S.
//
// Every refusal of a typed knockout finding carries a `knockout_finding_*` or `knockoutassess_finding_*` token,
// prefixed so that no clearance branch would take it. The gateway's findings branch matched `findings?_` bare,
// found the `finding_` inside those tokens, graded the run's findings.json, a file a knockout run never has,
// and told the model to add the clearance contract's keys. It now takes the clearance writer's tokens only, and
// those, `synthesis_findings_*` among them, route exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { gradedArtifact, correctiveMessage, correctionHint } from "../gateway.mjs";

const RUN = join("/", "run");
const CHUNK = join(RUN, "_driver", "knockout-assess-1.json");
const KNOCKOUT = [`mark "TESTMARK": knockout_finding_net_missing:1 (a finding states its net line)`,
  `mark "TESTMARK": knockoutassess_finding_ordinal:2 (ordinals run 1…N)`];

test("a knockout finding's refusal grades the knockout record and never names findings.json or the clearance keys", () => {
  for (const reason of KNOCKOUT) {
    assert.equal(gradedArtifact(reason, CHUNK), CHUNK, `${reason.split(":")[1]} was graded as another file`);
    const msg = correctiveMessage("Rate this chunk.", 2, `invalid_file:${CHUNK}:${reason}`, CHUNK);
    assert.doesNotMatch(msg, /findings\.json/, "the corrective turn names the clearance writer's file");
    assert.doesNotMatch(msg, /rated_under_framework|coverage_judgment|context_notes/, "the corrective turn asks for the clearance contract's keys");
    assert.ok(msg.includes(reason), "the corrective turn lost the refusal itself");
  }
});

test("a clearance writer's findings refusal routes exactly as before", () => {
  const report = join(RUN, "report.md");
  for (const tok of ["finding_registration_invalid:3 (a registration needs its uri)", "findings_coverage_missing: no coverage", "synthesis_findings_invalid: unparseable"])
    assert.equal(gradedArtifact(tok, report), join(RUN, "findings.json"), `${tok.split(":")[0]} no longer grades findings.json`);
  assert.match(correctionHint(`invalid_file:${report}:finding_registration_invalid:3`), /^findings\.json is a JSON OBJECT/);
});
