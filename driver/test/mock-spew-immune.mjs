#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// SIGTERM-immune stdout SPEWER for the exec maxBuffer-overflow tests: ignores SIGTERM (the crash-loop
// log-spew / debug-output pathology) and writes junk to stdout at max rate forever — only the group
// SIGKILL escalation can stop it. Writes its pid to MOCK_SPEW_PIDFILE so the test can assert death.
import { writeFileSync } from "node:fs";

process.on("SIGTERM", () => {});
if (process.env.MOCK_SPEW_PIDFILE) writeFileSync(process.env.MOCK_SPEW_PIDFILE, String(process.pid));

const chunk = "x".repeat(64 * 1024);
const spew = () => { while (process.stdout.write(chunk)) { /* fill the pipe until backpressure */ } };
process.stdout.on("drain", spew);
spew();
setInterval(() => {}, 1 << 30);
