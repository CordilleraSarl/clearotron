// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// delivery-handoff.mjs — THE DELIVERY PACKET AND ITS HAND-OFF, ONE BUILDER FOR BOTH PRODUCTS.
//
// A clearance (run-delivered.mjs) and a Knockout (pipeline-knockout.mjs) each built the same packet and handed it off the
// same way, in two copies. Each now passes only what is its own: the subject, the email body, the notice text, the report
// links and the verdict. The packet's fields keep the order both wrote, so `_driver/delivery.json` is the file it was.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./driver.config.mjs";
import { note } from "./log.mjs";
import { paths, whatsappRouting } from "./stages.mjs";

/**
 * The self-contained packet the courier sends (the email body HTML is embedded, so the courier needs no path resolution
 * across the archive move). `reports` is a batch's report links, which only a Knockout has; a run with one report passes
 * none and the field is absent. PURE.
 */
export function deliveryPacket({ runId, agent, job, subject, emailBodyHtml, whatsappText, url, reports = undefined, verdict, markName }) {
  return {
    runId, agent,
    forwarder: job.forwarder, forwarderEmail: job.forwarderEmail, msgId: job.msgId,
    conversationId: job.conversationId ?? null,   // reply-lane fallback when msgId is not a Graph id
    subject, emailBodyHtml,
    // — the notice goes to whoever ASKED, with the operator's copy beside it and a stated reason when no number is held.
    ...whatsappRouting(job, agent),
    whatsappText,
    url, ...(reports === undefined ? {} : { reports }),
    verdict, markName,
  };
}

/**
 * Hand a packet off: write it as the run's `_driver/delivery.json` and drop its outbox marker.
 *
 * A NEW send supersedes any previous one: .sent is PER-SEND idempotence, not per-run-lifetime. A run that terminally
 * failed (notice sent → .sent written) and was then resumed to success would otherwise be SKIPPED by clearotron-deliver's
 * .sent guard — the report would never send. The stale failure packet goes too, so the run dir tells exactly one delivery
 * story. The per-channel send receipts are per-SEND state exactly like .sent — a stale email receipt from the superseded
 * send would make clearotron-deliver skip THIS packet's email, so they reset together.
 *
 * Instant delivery: the marker in the fixed outbox wakes the forwarder agent NOW (vs the HEARTBEAT completion-watch, which
 * stays as the backstop). The marker only names the agent to wake; status.sendPending and the run's .sent guard remain the
 * source of truth, so a lost or cleared marker never double-sends nor loses a delivery. Best-effort: a marker-write failure
 * must never break the run (the backstop still delivers).
 */
export function handOffDelivery(runDir, packet) {
  try { rmSync(join(runDir, ".sent")); } catch { /* none */ }
  try { rmSync(paths(runDir).sendReceipts, { force: true }); } catch { /* none */ }
  try { rmSync(paths(runDir).failure); } catch { /* none */ }
  writeFileSync(paths(runDir).delivery, JSON.stringify(packet, null, 2) + "\n");
  note(`delivery: handoff → wrote _driver/delivery.json (the forwarding agent's completion-watch sends email${packet.whatsappTo ? " + WhatsApp" : ""})`);
  try {
    mkdirSync(config.outboxDir, { recursive: true });
    writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${packet.agent}\n`);
    note(`delivery: outbox marker → ${join(config.outboxDir, `${packet.runId}.pending`)} (instant wake)`);
  } catch (e) {
    note(`delivery: outbox marker write skipped (${String(e.message).slice(0, 100)}) — HEARTBEAT backstop still delivers`);
  }
}
