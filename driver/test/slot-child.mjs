#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Child worker for the cross-PROCESS slot-lock tests: acquire → log start → hold → log end →
// release. CHILD_HANG=1 holds forever (the parent SIGKILLs it to test dead-pid reclaim of a REAL
// foreign process). argv: <dir> <cap> <holdMs> <logFile> [tag]
import { appendFileSync } from "node:fs";
import { acquireSlot, releaseSlot } from "../slot-lock.mjs";

const [dir, cap, holdMs, log, tag] = process.argv.slice(2);
const h = await acquireSlot({ dir, cap: Number(cap), pollMs: 15, tag: tag || null });
appendFileSync(log, JSON.stringify({ e: "start", t: Date.now(), pid: process.pid }) + "\n");
if (process.env.CHILD_HANG === "1") {
  setInterval(() => {}, 1000);   // hold the slot until killed
} else {
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  appendFileSync(log, JSON.stringify({ e: "end", t: Date.now(), pid: process.pid }) + "\n");
  releaseSlot(h);
}
