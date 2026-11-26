// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// web-research-upgrade.mjs — the web-research setting an installation upgraded from before it existed is given, once.
//
// An installation that names no web-research service has chosen none, and its clearances are refused until it chooses
// (web-research.mjs). One upgraded from before the setting existed did choose, in effect: every clearance it ran
// searched the web with Perplexity, the only service there was. So the upgrade writes that service once, as a setting the
// operator can read and change, and says it did. It is never inferred from a key: a key is set on installations that
// never searched, and missing on ones that did.
//
// THE EVIDENCE IS THE INSTALLATION'S OWN RECORD OF RESEARCH THAT RAN, run by run, live and archived:
//   · a research question or grid the Perplexity research server answered, from the run's call log, a replay excluded;
//   · a Knockout's web sweep that Perplexity completed, from the run's sweep ledger.
// What does not count: a key; an order refused before it ran, which searched nothing; a Knockout whose web half was
// skipped or failed; a fixture or an injected sweep; a demo, whose runs live in their own folder and never in an
// installation's workspace.
//
// WHERE THE RECORD CANNOT SETTLE IT, NOTHING IS WRITTEN and setup asks: a run that searched with its own AI program's
// web search, or recorded that no service was chosen, says the installation's service was not always Perplexity, and an
// installation with no research on record has nothing to carry forward.
import { existsSync, readFileSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";
import { readRunChoices } from "./engine/run-choices.mjs";
import { SEARCH_RECORDS_FILE } from "./engine/mcp/own-search.mjs";
import { walkRuns } from "./portal-runs.mjs";
import { researchCall } from "./research-records.mjs";
import { paths } from "./run-record.mjs";
import { WEB_RESEARCH_SETTING } from "./web-research-names.mjs";

const rows = (file) => {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return []; }
  return text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

/**
 * What one run's records say about the service its web research ran on: "other" for research on, or a record of,
 * anything but Perplexity; "perplexity" for research Perplexity completed and nothing else; null for no research on
 * record. IMPURE (reads).
 */
export function researchOnRecord(runDir) {
  const rec = readRunChoices(runDir);
  if ((rec.state === "recorded" && Object.hasOwn(rec, "research") && rec.research !== "perplexity")
    || existsSync(driverDir(runDir, SEARCH_RECORDS_FILE))) return "other";
  const P = paths(runDir);
  const ran = rows(P.readingLog).some((row) => {
    const call = researchCall(row);
    return call?.known === true && call.ok === true && call.replay === false && call.service === "perplexity";
  }) || rows(P.knockoutSweep).some((row) => row?.ok === true && row?.executor === "perplexity");
  return ran ? "perplexity" : null;
}

/**
 * The setting to write once on an upgraded installation, from its runs' records: `{ add: { CLEAROTRON_WEB_RESEARCH:
 * "perplexity" }, runs }` where research ran on Perplexity and nothing else is on record, else `{ add: null, why }`, `why`
 * one of "chosen" (the installation names a service, valid or not: its choice stands), "mixed" (a run's research was not
 * Perplexity's), "none" (no research on record). `runDirs` are every run's folder. PURE but for the reads.
 */
export function webResearchToAdd(env, runDirs) {
  if (String(env?.[WEB_RESEARCH_SETTING] ?? "").trim() !== "") return { add: null, why: "chosen" };
  let runs = 0;
  for (const dir of runDirs) {
    const on = researchOnRecord(dir);
    if (on === "other") return { add: null, why: "mixed" };
    if (on === "perplexity") runs++;
  }
  return runs ? { add: { [WEB_RESEARCH_SETTING]: "perplexity" }, runs } : { add: null, why: "none" };
}

/** Every run's folder under an installation's workspace, live and archived. IMPURE (reads). */
export function installationRunDirs(workspaceRoot) {
  return walkRuns({ workspaceRoot, archive: true, orders: false }).runs.map((r) => r.dir);
}

/** The line written above the setting, so a reader of the settings file sees where it came from. */
export const UPGRADE_NOTE = "Who runs a clearance's web research: perplexity, as every clearance on this installation did before the setting existed. Added once on upgrade; change it with `npx clearotron install`.";
