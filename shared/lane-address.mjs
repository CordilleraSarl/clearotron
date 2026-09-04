// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lane-address.mjs — the portal's engine-door origin, composed in ONE place.
//
// ── why this exists ─────────────────────────────────────────────────────────────
//
// `PORTAL_MCP_URL` is the origin the portal's MCP client calls for `start_run` and `stop_run`. Exactly
// one thing in this product ever set it: `bin/start.mjs`, from its resolved MCP port. Not the wizard,
// not `render-units.mjs`, not any unit. the deployment env example carries the row EMPTY, with a correct
// sentence saying that empty means the portal makes no ops calls.
//
// So a box installed the documented hosted way had a portal whose Start button had no engine to call,
// and every health surface on it said fine. It cost the owner a 502 on submit and a dead Stop control
// in one morning — one missing value, two symptoms, neither of which looked like an address.
//
// ── COMPOSED, NOT TYPED, AND IN ONE PLACE ────────────────────────────────────────────────────────────
//
// The value is DERIVABLE: it is the loopback origin of a port this product already resolves. A product
// that can compute a value and instead ships an empty row and a true sentence about what empty costs is
// asking a reader to do arithmetic it could have done. So the composition lives here, and both the
// foreground supervisor and the hosted install path call it rather than each writing the expression.
//
// One expression, because the near-miss is specific and has happened: `PORTAL_MCP_URL` is an ORIGIN and
// the portal's client appends `/mcp` itself. A second author writing `.../mcp` produces a doubled path,
// which is a 404 at submit time and nothing wrong anywhere else — the exact silent shape this family of
// defects keeps taking.

/**
 * The engine door's origin for a portal on the same box.
 *
 * LOOPBACK BY CONSTRUCTION. Both processes run on one machine and the door carries an ops key in a
 * header in clear; reaching it from elsewhere is a TLS-terminating proxy's job, not this value's. A
 * deployment that genuinely publishes the door sets the variable by hand and this never overwrites it.
 *
 * @param {{host?: string, port: number}} a
 */
export function mcpOriginFor({ host = "127.0.0.1", port } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`mcpOriginFor: port must be 1–65535, got ${JSON.stringify(port)}`);
  }
  return `http://${host}:${port}`;
}

/**
 * What a server's environment file must carry for the submit lane to work, given resolved ports.
 *
 * ADD-ONLY IS THE CALLER'S JOB and every caller does it: a value an operator put there by hand wins,
 * always. This returns what SHOULD be present, not what to overwrite.
 */
export function laneValuesFor({ host = "127.0.0.1", ports } = {}) {
  return { PORTAL_MCP_URL: mcpOriginFor({ host, port: ports.mcp }) };
}

/**
 * The shape rule for each value above, written into the env file BESIDE the line.
 *
 *. The file this lands in carries `CLEAROTRON_CLIENT_MCP_URL` and
 * `CLEAROTRON_AGENT_MCP_URL` under a neighbouring heading, and those are consumed WHOLE — every fixture
 * sets them with `/mcp` on the end. This one is an origin. A reader filling those by analogy with the
 * line an installer just wrote for them produces an address with no path, which fails as a connector
 * handing clients something that does not answer rather than as a validation error.
 *
 * So the rule travels with the line. A note in a document is a note the copier is not reading.
 */
/**
 * The signing secret the client door refuses to start without — generated if absent, never replaced.
 *
 * Q4, and marked INFERRED on that ruling rather than the owner's words: it
 * follows from settled point 2, because "the client door auto-starts with the product" is unbuildable
 * without a secret and `bin/start.mjs` is the only thing that has ever minted one. I reached the same
 * derivation independently before reading the ruling, so I am building it — but the act is made LOUD
 * at the call site rather than silent, because an installer that begins generating cryptographic
 * material is a posture change the owner has not seen the consequence of in his own words.
 *
 * 32 bytes, matching what `bin/start.mjs` mints, so a box does not end up with two strengths of secret
 * depending on which command reached it first.
 */
export function signingSecretIfAbsent(existing, { randomBytes }) {
  if (String(existing ?? "").trim()) return null;   // never replace: a live secret invalidates every key
  return randomBytes(32).toString("hex");
}

export const LANE_VALUE_NOTES = Object.freeze({
  PORTAL_MCP_URL: "an ORIGIN, no path — the portal's client appends /mcp itself. The CLEAROTRON_*_MCP_URL "
    + "addresses nearby are the opposite: they are used whole and DO carry /mcp.",
});
