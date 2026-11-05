#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// fixture-register-server.mjs — the register tool a fixture run's reading step holds. Same tool, same words, same mint
// and same band as a live run, answered from the job's fixture directory. It reaches no register: a question the
// directory holds no answer for comes back as a failure, never as a zero. Mounted by gather-config when the run says so.
import { serve } from "./stdio-server.mjs";
import { proposeSupplemental } from "./supplemental.mjs";
import { CLARIVATE_PROPOSE_TOOL } from "./clarivate-propose-tool.mjs";
import { capabilitiesFor } from "../../register-capabilities.mjs";
import { fixtureRecordsDir } from "../../register-fixture-marker.mjs";
import { fixtureLister } from "../../register-records.mjs";
import { executeQuestionsWithLister } from "../../knockout-register-read.mjs";

const runDir = process.env.CLEAROTRON_BAND_RUN_DIR || "";
const dir = fixtureRecordsDir(runDir);
if (!dir) {
  process.stderr.write("fixture-register-server: this run declares no fixture directory, and this server reaches no register\n");
  process.exit(1);
}
const lister = fixtureLister(dir);

serve({
  name: "register",
  tools: [{
    name: "register_propose_supplemental",
    ...CLARIVATE_PROPOSE_TOOL,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (a) => proposeSupplemental(a, { kind: "propose_supplemental", recordLog: process.env.CLEAROTRON_REGISTER_RECORD_LOG || null }, {
      executePlan: (params) => executeQuestionsWithLister(lister, params),
      capabilities: capabilitiesFor(process.env.CLEAROTRON_DATABASE),
    }),
  }],
});
