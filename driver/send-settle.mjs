// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// send-settle.mjs — the record that a run's owed send happened: `.sent` in the run folder, `sendPending` cleared on
// status.json, and every outbox marker the send could have been minted under removed. ONE piece of code for every
// sender: the connector's mark_sent, and the route an install configures (notice-delivery.mjs). Two settles that
// differed would leave a run owed by one and told by the other, and a courier added later would tell the person again.
//
// It records a receipt and checks nothing about it: whether the caller holds evidence of the send is the caller's
// question (mark_sent refuses without one), and `via` says which sender wrote it.
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./driver.config.mjs";
import { paths, readJson } from "./run-record.mjs";

/**
 * The packet a run owes a send for: its delivery, or else its failure. `settled` is what a receipt for it means:
 * "delivery" (the report reached the person) or "failure" (the person was told the run did not deliver). Null when
 * the run has neither, so nothing is owed.
 */
export function owedPacket(runDir) {
  const delivery = paths(runDir).delivery;
  if (existsSync(delivery)) return { path: delivery, settled: "delivery" };
  const failure = paths(runDir).failure;
  if (existsSync(failure)) return { path: failure, settled: "failure" };
  return null;
}

/** Whether a run's send is already settled. */
export const sendSettled = (runDir) => existsSync(join(runDir, ".sent"));

// Clear the delivered outbox marker (edge-trigger only; a missing marker is a no-op). Runs on BOTH the
// fresh and the alreadySent paths: the .sent guard is written BEFORE this removal, so a first call
// interrupted (deliver-trigger.sh SIGKILLs the wake at 840s) between the two used to orphan the marker
// forever — the alreadySent early-return then suppressed every retry of this cleanup. Making the
// removal idempotent lets a retried mark_sent finish the cleanup a killed first call left undone.
//
// EVERY FORM THE RUN WAS EVER KNOWN BY, not just one (post-merge audit 2). A pre-change packet carries the
// legacy dateless `<slug>-<codename>` runId while the resolved run's own id is the dated canonical
// `<slug>-<date>-<codename>` — a run delivered on 2026-07-29 still has exactly that pair on disk, its
// _driver/delivery.json naming the dateless form and its status.json the dated one. That is also why
// resolveRun keeps its historical dateless arm (runs.mjs), so both ids reach this function.
// Removing only the packet's form left the OTHER form's marker on disk, and the outbox re-fires on
// whatever is there; worse, the alreadySent early-return repeated the same single-form removal, so no
// retry could ever finish the cleanup — the orphan was permanent. Same dual-form defence rescanOwedRuns
// already applies when it decides a marker is already queued (charter P1 §3): one settle clears every
// name that delivery could have been minted under. Best-effort per form; a missing one is a no-op.
/**
 * Remove every outbox marker a run's send could have been minted under. `run` is { runId, runDir, slug, codename };
 * `askedId` is the id a caller named it by, which may be the legacy dateless form.
 */
export function clearSendMarkers({ run, askedId = null, packetPath }) {
  const packet = (() => { try { return readJson(packetPath); } catch { return {}; } })();
  const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");   // rescanOwedRuns' own marker-name gate
  // The three OBSERVED ids are not the whole set: rescanOwedRuns DERIVES the legacy
  // `<slug>-<codename>` form (outbox-backoff.mjs), and a marker minted under that name is named by
  // none of them when the packet was rewritten with the dated id after its marker was minted. That
  // orphan is not permanent — the courier re-passes the marker's own name next pass — but it costs a
  // RE-SEND, i.e. a duplicate report to the reader, because the deliver skill sends before mark_sent.
  // So derive the same form rescanOwedRuns derives, and the mirror is complete rather than partial.
  const legacy = run.slug && run.codename ? `${run.slug}-${run.codename}` : null;
  const forms = [...new Set([packet.runId, run.runId, askedId, legacy]
    .filter((id) => id != null && String(id).trim() !== "").map(sanitize))];
  // BOTH SUFFIXES, because a failure's marker IS its packet. The delivery lane drops `<id>.pending`;
  // the failure lane writes its packet through the outbox as `<id>.failed.pending`, which the same
  // *.pending watch matches. Clearing only the first left the failure form on disk after a settle, the
  // sweep re-armed off it, and the run stayed owed forever — the permanent SEND PENDING the pipelines'
  // old comment feared, arriving by the one route nobody had named. A missing form is a no-op, as
  // before. (How many were stranded when this was found is a fact about one box on one day; it lives on
  // the issue, not here, because a count in a comment rots and the mechanism does not.)
  for (const id of forms) {
    for (const suffix of [".pending", ".failed.pending"]) {
      try { rmSync(join(config.outboxDir, `${id}${suffix}`), { force: true }); } catch { /* best-effort */ }
    }
  }
}

/**
 * Settle a run's owed send: write `.sent`, clear `sendPending`, remove the markers. Returns `{ alreadySent,
 * statusFlipped }`; a run already settled is left as it is, with its markers cleared again. Throws when nothing is
 * owed. `evidence` is `{ messageId, attestation }`, recorded as given.
 */
export function settleSend({ run, askedId = null, evidence = {}, via }) {
  const owed = owedPacket(run.runDir);
  if (!owed) throw new Error(`run "${run.runId}" has no delivery or failure packet — nothing was pending a send`);
  const sentPath = join(run.runDir, ".sent");
  if (existsSync(sentPath)) {
    clearSendMarkers({ run, askedId, packetPath: owed.path });
    return { alreadySent: true, statusFlipped: null };
  }
  // `settled` names WHICH packet this receipt is for. A .sent beside a failure packet and a .sent beside a
  // delivery mean two different things to anyone reading the run dir afterwards — "the client was told it
  // failed" is not "the client got their report" — and the file used to be silent about which.
  writeFileSync(sentPath, JSON.stringify({
    ts: new Date().toISOString(), messageId: evidence.messageId ?? null, via,
    ...(evidence.attestation ? { attestation: evidence.attestation } : {}),
    settled: owed.settled,
  }, null, 2) + "\n");
  // status.json: sendPending -> false (atomic tmp+rename; a torn read must never lose the flip).
  // A failed flip is NON-FATAL (.sent is the primary store and the rollup now derives from it too) but
  // never silent: the note names it, so a courier transcript shows the sidecar disagreeing.
  let statusFlipped = true;
  try {
    const sp = join(run.runDir, "status.json");
    const status = readJson(sp);
    status.sendPending = false;
    writeFileSync(`${sp}.tmp`, JSON.stringify(status, null, 2) + "\n");
    renameSync(`${sp}.tmp`, sp);
  } catch { statusFlipped = false; /* best-effort — .sent is the primary guard */ }
  clearSendMarkers({ run, askedId, packetPath: owed.path });
  return { alreadySent: false, statusFlipped };
}
