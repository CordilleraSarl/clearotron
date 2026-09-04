// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// outbox.mjs — THE event seam (Phase 2 delivery contract). It was "the handoff-mode seam" while a second
// mode existed; deleted that mode, so this is not a mode's seam, it is the contract. The driver
// never sends anything: every requester-facing event — delivered, run-failed, intake-rejected,
// duplicate-skipped, late-bind-ack, pre-run-failed — is written here as one SELF-CONTAINED JSON packet the integrator
// consumes (routing keys + human-ready text embedded; no path resolution into run dirs required).
// A `.path`-style watcher on config.outboxDir gets an instant wake; a periodic sweep is the backstop.
// Packet schema + lifecycle: docs/DELIVERY.md.

import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { config } from "./driver.config.mjs";
import { note } from "./log.mjs";

// Write one event packet as <name>.pending (atomic tmp+rename — a watcher never sees a half-written
// packet). BEST-EFFORT BY DESIGN: an event is a report about work already recorded elsewhere (queue
// markers, run sentinels, status.json), so a packet-write failure must never break or mask the path
// that reports it — callers append the returned path (or the failure) to their audit trail and move on.
// Returns the packet path, or null on failure.
export function writeOutboxPacket(name, packet) {
  try {
    mkdirSync(config.outboxDir, { recursive: true });
    const dest = join(config.outboxDir, `${name}.pending`);
    writeFileSync(`${dest}.tmp`, JSON.stringify({ ts: new Date().toISOString(), ...packet }, null, 2) + "\n");
    renameSync(`${dest}.tmp`, dest);
    note(`outbox: event packet → ${dest}`);
    return dest;
  } catch (e) {
    note(`outbox: packet write FAILED for ${name} (non-fatal): ${e?.message ?? e}`);
    return null;
  }
}
