// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// send-until.mjs — the time after which a plan call sends no further question to the register.
//
// A plan call runs inside a model's turn, and the turn has a deadline. When the call outlasted it, the call and the
// turn ended together, so the unit could not write what the call had answered: on a production run on 2026-10-21 a
// unit's plan search ran into the register's gateway timeouts on every attempt and never wrote its result. The
// driver now hands each turn's tool servers a time to stop sending (CLEAROTRON_GATHER_SEND_UNTIL_MS, set per turn by
// the gateway, ahead of the turn's own deadline by a reserve). Past it, the executor sends no new question and a
// timed-out question is not split again; the call returns what it holds and the turn has the time to write it.
//
// A pure leaf. A call with no time to stop sending, the driver's own dispatches among them, runs as it always did.

/** The gateway's reserve for a turn of `timeoutSec`: a quarter of the turn, and never more than five minutes. */
export const sendReserveMs = (timeoutSec) => Math.min(300_000, Math.max(0, Number(timeoutSec) || 0) * 250);

/** Whether a call given `tctx` is past its time to stop sending. False when it has none. */
export function pastSendUntil(tctx, now = Date.now()) {
  const until = Number(tctx?.sendUntilMs);
  return Number.isFinite(until) && until > 0 && now >= until;
}

/** The call context's time to stop sending, read from the environment a turn's tool server was started with. */
export const sendUntilFromEnv = (env = process.env) => Number(env.CLEAROTRON_GATHER_SEND_UNTIL_MS) || null;
