// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// trigger-lane.mjs — does the portal's Start button actually reach the engine on this box?
//
// ── the incident (owner, 2026-09-02) ─────────────────────────────────────────────────────────────────
//
// The owner hit a 502 submitting a clearance, and EVERY health surface on that box was green: the
// engine probe, live-surface-check, the portal's own health endpoint, and a boot log printing
// "trigger lane: ops token…" on the token's presence alone. The lane was dead because
// `PORTAL_MCP_URL` was never set there.
//
// ── AND THE CAUSE IS STRUCTURAL, not that box's mistake ──────────────────────────────────────────────
//
// `bin/start.mjs` is the ONLY thing in this product that ever sets `PORTAL_MCP_URL` — it derives the
// origin from the resolved MCP port and hands it to the portal child, and under `--background` writes
// the same union into `%h/.env` for the units. Nothing else does: not `bin/onboard.mjs`, not
// `driver/systemd/render-units.mjs`, not `.env.example`, not any shipped unit file.
//
// So a box installed the DOCUMENTED HOSTED WAY — wizard, then `render-units.mjs --apply` — gets a
// portal whose trigger lane is unwired, and every check it can run says it is fine. A box that runs
// `clearotron start` is wired. That is the whole difference, and no health surface looked at it.
//
// ── THE CLASS ────────────────────────────────────────────────────────────────────────────────────────
//
// A health check that does not walk the client's own path certifies a dead product. Presence of a
// credential is not a wired lane; a listener answering is not a lane either. The only evidence that
// counts is the hop itself.

/** The posture decides what an absent value MEANS, which is why it is an input rather than a guess. */
import { challengeVerdict, blockedByAccessChallenge, challengeNote } from "./mcp-challenge.mjs";   // — F57
export const HOSTED = "hosted";
export const SUPERVISED = "supervised";

/**
 * @param {object} a
 * @param {string|null}  a.url      PORTAL_MCP_URL as the portal will read it — an ORIGIN, never .../mcp
 * @param {boolean}      a.hasToken whether an ops token is present. Presence only; never its value.
 * @param {string}       a.posture  HOSTED when units are installed, SUPERVISED when start supervises
 * @param {{ok: boolean, status?: number|null, error?: string|null}|null} a.probe  the hop, or null
 */
/**
 * `invoke` is how a reader on THIS box types the verb — "", "npx ", or an absolute path to the shim
 *. It is passed in rather than resolved here because this module is pure, and
 * because a command printed without it is command-not-found in the terminal the reader is sitting in:
 * doctor's own guard runs every command doctor prints, and it caught this one.
 */
export function triggerLaneVerdict({ url = null, hasToken = false, verbs = null, posture = SUPERVISED, probe = null, invoke = "" } = {}) {
  const startCmd = `${invoke}clearotron start`;
  const raw = String(url ?? "").trim();

  if (!raw) {
    // ON A HOSTED BOX THIS IS THE INCIDENT. Units read %h/.env and nothing on the documented hosted
    // path writes this name, so absent here is the exact state the owner's 502 came from.
    if (posture === HOSTED) {
      return { state: "fail",
        message: "PORTAL_MCP_URL is not set for the units, so the portal's Start button has no engine to "
          + "call — a clearance submitted here returns 502 while every other check passes. Nothing on the "
          + `documented hosted path writes it: \`${startCmd} --background\` is the only thing that `
          + "does. Set it in the env file the units read, to the engine door's own origin." };
    }
    // AND ON A SUPERVISED BOX IT IS NORMAL. `start` derives the value and hands it to the portal child;
    // it never enters the operator's shell, so reading it here says nothing about a running portal.
    // Reporting this as a fault would red every laptop and teach a reader to skim the hosted case.
    return { state: "info",
      message: `PORTAL_MCP_URL is not in this environment, which is expected — \`${startCmd}\` derives `
        + "it and hands it to the portal it supervises. This says nothing about a portal already running." };
  }

  // BOTH DIRECTIONS, OR THE INSTALL IS NOT HEALTHY (owner, 2026-09-02, on finding "Stop now" unavailable
  // against his own running clearance). A lane that can start a run and cannot stop it is not a working
  // lane — it is a client committed to a run they cannot recall, and the refusal arrives from upstream
  // looking like an engine fault. The token is VERB-scoped, so this is a real and separable state:
  // `bin/start.mjs` mints ["start_run", "stop_run"], and a token minted by hand — which is what a box
  // that bypasses `clearotron start` has — may carry neither, one, or a widened full-ops claim.
  //
  // `verbs: null` means the claim is absent, which is FULL OPS rather than none. Reading an absent claim
  // as "cannot stop" would red every uncapped token, and reading it as "can" is correct: unscoped is the
  // widest posture, not the narrowest. The narrowness is a separate concern with its own warning.
  if (Array.isArray(verbs) && !verbs.includes("stop_run")) {
    return { state: "fail",
      message: `the ops token's verbs are [${verbs.join(", ")}] and do not include stop_run, so a client `
        + "can START a run from the portal and cannot STOP it — every Stop and every queued-job Cancel "
        + `fails as an upstream refusal. Re-mint with \`--verbs ${[...new Set([...verbs, "stop_run"])].join(",")}\`.` };
  }

  // A CREDENTIAL IS NOT A LANE. The boot line that made the incident invisible printed on the token's
  // presence alone; asserting the same thing here would reproduce it one surface further along.
  if (!hasToken) {
    return { state: "fail",
      message: `PORTAL_MCP_URL is ${raw} and no ops token is set, so the lane is half-wired: the portal `
        + "knows where to call and cannot authenticate. The Start button fails at the door." };
  }

  let parsed;
  try { parsed = new URL(raw); }
  catch { return { state: "fail", message: `PORTAL_MCP_URL is not a URL: ${raw}` }; }
  // AN ORIGIN, NOT AN ENDPOINT. The portal's client appends `/mcp` itself, so a value carrying it
  // produces `/mcp/mcp` — a 404 at submit time and nothing wrong anywhere else.
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { state: "fail",
      message: `PORTAL_MCP_URL carries a path (${parsed.pathname}) and must be an ORIGIN — the portal's `
        + "client appends /mcp itself, so this becomes a double path at submit time and nothing else notices." };
  }

  if (!probe) {
    return { state: "unprobed",
      message: `${raw} is configured with a token and NOBODY WALKED THE HOP. Configuration is what every `
        + "surface that missed the incident already checked; only the hop is evidence." };
  }
  // THE SAME BLINDNESS THE CLIENT CONNECTOR HAD ( — F57). F57 names the client
  // door; its own measurement covers BOTH MCP hostnames, and this lane is the other one. A 302 is under
  // 500, so a Cloudflare-Access browser challenge in front of the submit lane reads as an answering
  // lane while no assistant can reach it — which is this module's founding incident with a new cause.
  const challenge = challengeVerdict(probe);
  if (challenge.blocked) return { state: "fail", message: blockedByAccessChallenge(raw, probe.status) };
  if (probe.ok) {
    return { state: "pass",
      message: `the trigger lane answers at ${raw}${probe.status ? ` (${probe.status})` : ""}${challengeNote(challenge)}` };
  }
  const why = probe.error ? probe.error : `it answered ${probe.status}`;
  return { state: "fail",
    message: `${raw} is configured and the engine door DOES NOT ANSWER — ${why}. This is the submit lane: `
      + "a clearance ordered from the portal returns 502 while the portal's own health endpoint stays 200." };
}
