// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// demo-posture.mjs — is this process part of `clearotron demo`, and what does the demo actually contain?
//
// ── WHY THIS IS A MODULE AND NOT A BOOLEAN IN TWO PLACES ──────────────────
//
// Two boot warnings are written for an operator of a real deployment and printed at a visitor who is
// neither: one about the customer roster, one about the risk-framework overlay. Both are correct about a
// real install and both are meaningless in a demo, and the issue's rule is that the choice is made ONCE,
// where the message is composed, rather than by each caller deciding whether it is in a demo.
//
// The catch that made this a module: THE TWO MESSAGES ARE IN DIFFERENT PROCESSES. The roster warning is
// the MCP door's (`mcp-server/http-server.mjs`); the overlay warning is the portal service's
// (`driver/portal-service.mjs`). `bin/start.mjs` used to tell only the portal it was a demo, so "decide
// once" needed the fact plumbed into a second process before either sentence could be written.
//
// ── ONE NAME, AND IT IS THE HOUSE ONE ───────────────────────────────────────────────────────────────
//
// `PORTAL_DEMO` is retired in favour of `CLEAROTRON_DEMO`. Two names for one fact is how two subsystems
// come to disagree about it, and the old name was already wrong for a process that is not the portal.
// It cost nothing to move: the classification record shows `everSet: []` — no deployment has ever
// carried it — and it is written by `clearotron demo` alone, never by an operator.
//
// STILL SET BY THE LAUNCHER, NEVER READ FROM A `.env`. The child processes run with
// `CLEAROTRON_NO_ENV_FILE=1`, so a stray file can neither put a live install into demo mode nor take a
// demo out of one. Anything but the literal `1` is not a demo.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Literal `1`, and nothing else. A truthy-looking value is not a demo. */
export function isDemo(env = process.env) {
  return env.CLEAROTRON_DEMO === "1";
}

/**
 * How many finished reports this demo actually carries.
 *
 * ── DERIVED, NEVER STATED ───────────────────────────────────────────────────────────────────────────
 *
 * The ruling describes the demo as carrying "four completed clearance reports". It carries one today —
 * the rest are captured against the final build — and a sentence that says four while showing one is
 * exactly the defect the issue was realigned to avoid: it would be read aloud on the website capture.
 *
 * So the number comes off the pool the demo is actually serving. True at one, true at four, and it
 * cannot drift from what the visitor can open. Same rule the composer's coverage sentence follows.
 *
 * Returns `null` when the pool cannot be read at all, which is a different fact from zero and must not
 * render as one: a boot line is not the place to discover a filesystem problem, and a sentence that
 * says "no reports" about an unreadable directory is wrong in the one direction that matters.
 */
export function demoReportCount(env = process.env) {
  const pool = env.CLEAROTRON_REPORTS_DIR;
  if (!pool || !existsSync(pool)) return null;
  try {
    return readdirSync(pool, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "customer" && existsSync(join(pool, e.name, "meta.json")))
      .length;
  } catch { return null; }
}

/**
 * What to say instead of an operator's warning, when this process is part of a demo.
 *
 * ── THE SAME FACTS, AS WHAT THE DEMO *IS* RATHER THAN WHAT THE INSTALL *LACKS* ──────────────────────
 *
 * The ruled shape, from the owner's own description of the demo: Demo Brand Owner, rating under the
 * generic default framework, with its project and its reports. Naming two environment variables and a
 * "config store" tells a first-time visitor that the thing they just started is misconfigured — and
 * this is the output that gets captured for the website.
 *
 * NEITHER WARNING IS SILENCED OUTSIDE A DEMO. Both are load-bearing on a real deployment, and the second
 * warns that a page may show synthetic data as though it were a customer's own, which is precisely the
 * class of thing that must stay loud. The defect was the audience, not the content.
 *
 * `null` outside a demo, so a caller that forgets to branch prints its warning rather than nothing.
 */
export function demoPostureLine(env = process.env) {
  if (!isDemo(env)) return null;
  const n = demoReportCount(env);
  const reports = n === null
    // The pool could not be read. Say what the demo is and stop, rather than counting something we did
    // not look at — an absence is a finding, and a number invented here is one nobody can check.
    ? "its finished clearance reports"
    : `${n} finished clearance report${n === 1 ? "" : "s"}`;
  return `This is ${"`clearotron demo`"}: it carries Demo Brand Owner, rating under the generic default `
    + `framework, with its demo project and ${reports} ready to open. Nothing here is configured against `
    + `a real customer, and nothing needs to be.`;
}
