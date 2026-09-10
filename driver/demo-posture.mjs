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
import { loadProfiles, loadProjects } from "./profiles.mjs";

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
 * The companies the roster in force actually holds, Generic excepted.
 *
 * ── A READ OF THE ROSTER, NEVER A CONSTANT ────────────────────────────────────────────────────────
 *
 * The line below used to name Demo Brand Owner, "rating under the generic default framework, with its
 * demo project", as a literal, and on 0.3.0-beta.1 it was wrong twice. The demo account rates under a
 * framework of its own, and a demo that had taken a real install's settings served a roster without it
 * while still printing its name. So each fact is read off the loader this process serves from: the
 * name, whether the profile names a framework of its own, how many projects sit under it, and whether it
 * is marked demo data. When the roster changes, the sentence changes with it.
 *
 * `roster` and `projects` are the loader's own Maps, passed by a caller that already holds them and read
 * here otherwise. `null` when the roster cannot be read, which is a different fact from an empty one.
 */
export function demoCompanies({ roster, projects } = {}) {
  try {
    const profiles = roster ?? loadProfiles({ force: true });
    let byProject = projects;
    // Projects that cannot be read are not counted, and a count of zero is never said: the clause is
    // left out rather than stating a number nobody looked at.
    if (!byProject) { try { byProject = loadProjects({ profiles }); } catch { byProject = new Map(); } }
    return [...profiles.values()]
      .filter((p) => p && p.key !== "generic")
      .map((p) => ({
        key: p.key,
        name: String(p.name ?? "").trim() || p.key,
        ownFramework: Boolean(String(p.frameworkPath ?? "").trim()),
        projects: [...byProject.keys()].filter((k) => k.startsWith(`${p.key}/`)).length,
        demoData: p.demoData === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return null; }
}

const describeCompany = (c) =>
  `${c.name}, rating under ${c.ownFramework ? "its own framework" : "the generic default framework"}`
  + (c.projects ? `, with ${c.projects} project${c.projects === 1 ? "" : "s"}` : "");

/**
 * What to say instead of an operator's warning, when this process is part of a demo.
 *
 * ── THE SAME FACTS, AS WHAT THE DEMO *IS* RATHER THAN WHAT THE INSTALL *LACKS* ──────────────────────
 *
 * The shape the owner described: the demo's company, the framework it rates under, its project and its
 * reports. Every one of those is read (`demoCompanies`, `demoReportCount`), never stated. Naming two
 * environment variables and a "config store" tells a first-time visitor that the thing they just
 * started is misconfigured — and this is the output that gets captured for the website.
 *
 * THE CLOSING SENTENCE IS EARNED. "Nothing here is configured against a real customer" is said only
 * when every company on the roster is marked demo data; a company a visitor created in the demo is not,
 * and neither is anything a misconfigured store brought in.
 *
 * NEITHER WARNING IS SILENCED OUTSIDE A DEMO. Both are load-bearing on a real deployment, and the second
 * warns that a page may show synthetic data as though it were a customer's own, which is precisely the
 * class of thing that must stay loud. The defect was the audience, not the content.
 *
 * `null` outside a demo, so a caller that forgets to branch prints its warning rather than nothing.
 */
export function demoPostureLine(env = process.env, { roster, projects } = {}) {
  if (!isDemo(env)) return null;
  const n = demoReportCount(env);
  const reports = n === null
    // The pool could not be read. Say what the demo is and stop, rather than counting something we did
    // not look at — an absence is a finding, and a number invented here is one nobody can check.
    ? "its finished clearance reports"
    : `${n} finished clearance report${n === 1 ? "" : "s"}`;
  const head = `This is ${"`clearotron demo`"}`;
  const companies = demoCompanies({ roster, projects });
  if (companies === null) return `${head}: its roster could not be read, so what it carries is not said here. It has ${reports} ready to open.`;
  if (!companies.length) return `${head}, and its roster holds no company but the generic default. It has ${reports} ready to open.`;
  const carries = companies.length === 1
    ? describeCompany(companies[0])
    : `${companies.slice(0, -1).map(describeCompany).join("; ")}; and ${describeCompany(companies.at(-1))}`;
  const unreal = companies.every((c) => c.demoData)
    ? " Nothing here is configured against a real customer, and nothing needs to be." : "";
  return `${head}: it carries ${carries}, and ${reports} ready to open.${unreal}`;
}
