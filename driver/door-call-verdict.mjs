// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CALL TO THE OPS DOOR THAT THE DEPLOYMENT CHECK COULD NOT MAKE — "roster resolves" (list_profiles) and
// "ops-MCP reachable" (describe_options). Extracted so it can be driven without a door to call, as
// plan-run-agreement-verdict.mjs was for the third call.
//
// Both rows used to FAIL on every error but an unset door, so the check exited 1, "drifted", when nothing
// had been compared. Measured on pre-prod 0.3.3-beta.0: both rows FAILed on a 401, the door refusing the
// check's own key. On the test box the same door's rate limit (429) refused the third call of a burst of
// checks; that was the plan_run call, and these two go to the same door.
//
// THREE ANSWERS MEAN THE CHECK DID NOT LOOK: a rate limit (429), a refusal of this check's own key (401,
// 403), and a request that got no answer in time. Each is a marked skip, which exits 3. Everything else
// stays a FAIL: a 5xx or a malformed answer is the door answering badly. A door with nothing listening
// at all stays a FAIL too, because whether that is a finding is not settled, and this does not settle it.

/**
 * @param {Error & {status?: number|null, timedOut?: boolean}} e  what the call threw
 * @param {{ asked: string, notCompared: string }} what  the tool asked, and what was therefore not compared
 * @returns {{state: "skip", blocked: true, message: string} | null}  null: report it as the FAIL it was
 */
export function doorCallVerdict(e, { asked, notCompared }) {
  const refused = e?.status === 429 || e?.status === 401 || e?.status === 403 || e?.timedOut === true;
  if (!refused) return null;
  return { state: "skip", blocked: true, message: `could not ask ${asked}, so ${notCompared} — ${String(e?.message ?? e).slice(0, 200)}` };
}
