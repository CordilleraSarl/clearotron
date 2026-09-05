// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// config-inventory.mjs — WHAT THIS INSTANCE SEARCHES WITH, and what it cannot search with at all.
//
// Two questions, both of which currently require someone to ssh into the box and read an env file:
//
//   "Which engine is running the searches, and who is being billed for them?"
//   "What is wired up, and what is missing?"
//
// ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────────
//
// It is the answer to "why not just put this in flag-snapshot.mjs". That file is STATICALLY imported by
// portal-service, door-gates, dev-portal and the MCP server, and this one statically imports
// driver.config.mjs — the engine's own configuration module, which captures `CLEAROTRON_DATABASE`
// at module top and throws from `requireRegisterProvider()`. Putting these functions in flag-snapshot
// would drag that whole graph into the portal, which deliberately has no engine environment, and the
// failure would arrive at portal boot rather than here.
//
// So the snapshot WRITER imports this (dynamically, from its isMain block, where it already imports
// driver.config for the same reason) and every reader of the snapshot imports none of it.
//
// ── DERIVED FROM THE DRIVER'S OWN TABLES, NEVER A SECOND LIST ───────────────────────────────────────
//
// Every name below comes from `ENGINE_BINARIES`, `PROVIDERS`, `RESEARCH_PROVIDERS` and `SERP_PROVIDERS`,
// and every credential verdict from `missingCredentials` — the one predicate `preflightCredentials`
// uses, so a page cannot say "configured" about an instance the run door will refuse. A hand-kept
// second list is the defect this file is most able to introduce: it would read correct on the day it
// was written and drift silently afterwards, and the whole value of this page is that it is BELIEVED.
//
// ── NAMES AND STATES, NEVER VALUES ──────────────────────────────────────────────────────────────────
//
// This feeds a snapshot that a web service reads and renders. A credential must never reach it. What is
// recorded is whether a required variable is NON-EMPTY and, when it is not, WHAT IT IS CALLED — which is
// the whole of what a reader needs in order to fix it, and is the same thing `preflightCredentials`
// already prints in its refusal. A variable's name is not its value.
//
// The missing names are given in THIS RELEASE'S SPELLING (`currentName`), because the page's only use
// for them is "set this one", and sending an operator to adopt a name that is being retired would be
// worse than saying nothing.

import {
  DEFAULT_ENGINE_ID, ENGINE_BINARIES, PROVIDERS, RESEARCH_PROVIDERS, SERP_PROVIDERS,
  missingCredentials, preflightEngineBinary, providerIdFrom,
} from "./driver.config.mjs";
import { resolveAuthMode } from "./engine/auth.mjs";
import { CASELAW_BRIDGES } from "./engine/mcp/gather-config.mjs";   // — the list that decides what is spawned
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** This release's spelling for each name, so the page never teaches a retired one. */
const shown = (names) => names.map((n) => n);

/**
 * The engine: which one, whose bill, and whether it can actually be spawned.
 *
 * ── THE THROW IS THE MOST VALUABLE ROW ON THE PAGE ──────────────────────────────────────────────────
 *
 * `resolveAuthMode` REFUSES rather than returning when the mode claims API billing and the key is
 * absent, because the alternative is silently billing a subscription the operator thought they had
 * stopped using (engine/auth.mjs's opening argument). A writer that caught that and recorded "unknown"
 * would erase precisely the misconfiguration a staff config page exists to surface, so it is caught and
 * recorded AS ITSELF: mode `api-key`, `apiBilled: false`, and a fault naming the variable to set.
 *
 * `apiBilled` is what the page should believe over `mode` — the two come apart in exactly this case,
 * and only one of them describes who gets the invoice.
 */
export function engineInventory(env = process.env) {
  // THE SAME EXPRESSION AS THE RUN DOOR, character for character (driver.config.mjs:1660,
  // preflightEngineBinary). The obvious rewrite — `String(env.CLEAROTRON_AI ?? "").trim() || DEFAULT` —
  // reads better and disagrees on a whitespace-only value: it falls back to the default while the door
  // resolves `""` and refuses with "that is not an engine". The page would then name a known engine that
  // the run door will not start, which is the one property this whole module is built to hold.
  const id = (env.CLEAROTRON_AI || DEFAULT_ENGINE_ID).trim().toLowerCase();
  const spec = ENGINE_BINARIES[id] ?? null;

  const billing = (() => {
    try {
      const a = resolveAuthMode({ engineName: id, env });
      return { mode: a.mode, apiBilled: a.apiBilled === true, missing: [] };
    } catch {
      // The one state resolveAuthMode throws for. The message carries no value, but it is not copied
      // either — the two variable names are reconstructed from the table so this cannot drift from it.
      return {
        mode: "api-key",
        apiBilled: false,
        missing: spec?.apiKeyEnv ? shown([spec.apiKeyEnv]) : [],
      };
    }
  })();

  // FILESYSTEM ONLY, and it never spawns anything — see preflightEngineBinary's own header for why a
  // `--version` call would be the wrong test. A throw here means the binary cannot be spawned: absent,
  // not executable, a relative path, or native Windows. All four are "this engine cannot run", which is
  // the one bit a page needs; the refusal that names which one belongs at the run door, where it is
  // read by someone who can act on the path it quotes. No path reaches this snapshot.
  const binaryPresent = (() => {
    try { return Boolean(preflightEngineBinary(env).resolved); } catch { return false; }
  })();

  // `vendor`, NOT `label`. The label in that table is the mechanism — "each stage runs as a headless
  // `claude -p` turn" — which is exactly the back-end detail took off this page. The id travels
  // beside it because it is what an operator types into an environment file.
  return { id, vendor: spec?.vendor ?? null, known: Boolean(spec), billing, binaryPresent };
}

/**
 * The three states an install can be in, as far as running a search goes..
 *
 * NAMED, because "no engine" was being reported as an ABSENCE — "install it for a real run", "a real
 * run will refuse" — and a first-time reader cannot tell a deliberate limited mode from a botched
 * install by reading a list of things they are missing. `npm start` on a clean box seeds an example
 * report into the pool, so demo is a product someone can use, not a broken one.
 */
export const ENGINE_MODES = Object.freeze({
  /** Nothing to spawn. The example report and everything around it work; a NEW run refuses. */
  DEMO: "demo",
  /** A binary resolves. Whether it is signed in is unknown, and only a probe turn can know. */
  UNPROVEN: "engine-unproven",
  /** A probe turn completed. This is the ONLY route to this value. */
  READY: "engine-ready",
});

/**
 * Which mode an install is in — DERIVED, never stored, and that is the whole design.
 *
 * A stored flag can disagree with the credentials in both directions and the disagreement is silent.
 * This takes the inventory it is asked about and answers now.
 *
 * READY IS NOT REACHABLE FROM THE FILESYSTEM. `binaryPresent` says a file can be spawned; the engine
 * behind it may be signed out, which passes every filesystem test and fails at the first stage. So a
 * probe RESULT is a separate argument, supplied only by a caller that has just spent one — the portal
 * never can, and must not imply it. Its honest ceiling is telling DEMO from UNPROVEN, which is exactly
 * the distinction that decides whether a Start button should be live.
 *
 * PURE. Anything asserting a mode without an inventory in hand is asserting it from somewhere else.
 */
export function engineMode(inventory, { probe = null } = {}) {
  if (!inventory?.binaryPresent) return ENGINE_MODES.DEMO;
  if (probe && probe.ok === true) return ENGINE_MODES.READY;
  return ENGINE_MODES.UNPROVEN;
}

/**
 * Every provider a search depends on, each with a CONFIGURED OR MISSING state.
 *
 * ── THE INVENTORY IS THE KNOWN SET, NOT THE CONFIGURED SET ──────────────────────────────────────────
 *
 * This is the whole design rule and it is easy to get backwards. A provider with no credential must
 * appear here as a row saying MISSING. Building the list from what the environment happens to hold
 * would omit it instead — and a page listing two providers looks exactly like a page listing a complete
 * set of two. The absence would be invisible at the one surface whose job is to show it.
 *
 * The register is the exception in shape, not in rule: it is a CHOICE among the adapters rather than a
 * capability each instance either has or lacks, so it is one row naming the selected provider — or
 * naming none, which is itself a missing row and the state a fresh install is in.
 */
export function providerInventory(env = process.env) {
  const rows = [];

  const registerId = providerIdFrom(env);
  const register = registerId ? PROVIDERS[registerId] ?? null : null;
  rows.push({
    key: "register",
    label: "Trademark register",
    provider: registerId,
    providerLabel: register?.label ?? null,
    // A provider id this build does not ship. Distinct from "none selected": one is a typo in an env
    // file, the other is a step never taken, and they are fixed differently.
    known: Boolean(register),
    configured: Boolean(register) && missingCredentials(register, env).length === 0,
    // With no provider selected there is no credential to be missing, and the thing to set is the
    // selector itself. `activeProvider` throws on an unknown id, so that case names the selector too.
    missing: register ? shown(missingCredentials(register, env)) : shown(["CLEAROTRON_DATABASE"]),
  });

  for (const [group, label, table] of [
    ["research", "Common-law and marketplace research", RESEARCH_PROVIDERS],
    ["web", "Open-web search", SERP_PROVIDERS],
  ]) {
    // Looped rather than named, so a second research or search adapter appears here the day it is
    // wired instead of the day somebody remembers this file.
    for (const [id, adapter] of Object.entries(table)) {
      const missing = missingCredentials(adapter, env);
      rows.push({
        key: group,
        label,
        provider: id,
        providerLabel: adapter.label ?? id,
        known: true,
        configured: missing.length === 0,
        missing: shown(missing),
      });
    }
  }

  // ── — AND THE CAPABILITIES NOBODY WAS EVER ASKED ABOUT ────────────────────
  //
  // Appended to the SAME list, so every reader of this inventory gets them with no edit: the config
  // screen renders rows generically, the flag snapshot carries whatever this returns, and the doctor
  // reads the same function. A separate list would be the hand-kept census this issue is about.
  rows.push(...caseLawInventory(env));
  return rows;
}

// ── THE TWO TABLES BELOW SIT ABOVE `caseLawInventory` ON PURPOSE ────────────────────────────────────
//
// `a-capability-is-named-before-the-report-names-it` asserts, over the SOURCE from that function to the
// end of the file, that no URL and no `fetch(` appears — because a doctor that reaches the network hangs
// on a box with no route, and that is a call somebody adds later which nothing offline can observe. A
// URL written in a sentence is not a fetch, but the guard cannot tell the two apart and should not have
// to: loosening it to allow "the harmless kind" of URL is how the check it performs stops meaning
// anything. So the strings live above the line it draws, and the function holds only lookups.

/** What each case-law source is CALLED on a page a person reads. Never the bridge's key alone. */
const CASELAW_LABELS = Object.freeze({
  courtlistener: "CourtListener (US federal case law)",
  legaldatahunter: "Legal Data Hunter (statutes and case law, 108 countries)",
  // Listed with its site like the others. It needs no enrolment, but a reader counting the gaps a
  // report disclosed still wants to be able to open it.
  "eur-lex": "EUR-Lex (EU judgments, https://eur-lex.europa.eu/) — read through the engine's own fetch tool",
});

/**
 * WHERE A READER GOES TO GET AN ACCOUNT, beside the name they were told to get one for.
 *
 * F16, the case-law half. The owner's words about the register that had the
 * same defect: "I should not have to google for signa and find it (and they are hard to find)." Every
 * other credential this product asks for now carries a URL; these did not, and the remedy sent the
 * reader to `providers/oauth-mcp-bridge/README.md` — a document that DOES carry CourtListener's
 * endpoints, in a shell transcript, five screens down. Being reachable is not the same as being told.
 *
 * ONE TABLE, beside the labels, for the reason the finding gives: a URL kept in the document and not in
 * the registry is a URL that drifts from the registry, which is the failure item 11 already
 * produced once.
 *
 * `null` IS A VALUE HERE AND IT IS NOT A GAP IN THE TABLE. Legal Data Hunter's site appears NOWHERE in
 * this repository — not as a URL, not as a bare domain, in any of the eleven places the source is named
 * (measured 2026-09-05). Writing a plausible one here would be worse than the silence it replaces: the
 * reader would follow it, and an invented domain in a shipping document is a defect nobody can see. So
 * the row says what is true — this build does not record where to enrol — and the remedy sends them to
 * whoever provisioned the bridge instead of to a search engine. That is a finding to raise, not a blank
 * to fill in.
 */
const CASELAW_SITES = Object.freeze({
  courtlistener: "https://www.courtlistener.com/",
  legaldatahunter: null,
});

/**
 * ── — THE LANES A PRODUCT DECLARES IT NEEDS, and whether this box has them ──
 *
 * The owner ran a Full country search on his own install and first heard of case law in the finished
 * report, two and a half hours and real spend later: "Legal data hunter MCP was NOWHERE in setup - and
 * it was NOWHERE in the global config (showing connection) neither was it flagged when selecting the
 * report in the new clearance screen." All three were true.
 *
 * The disclosure in the report is the product working: no report claims "no adverse case law" off a
 * sweep that never dispatched. The defect is that disclosure was the FIRST mention.
 *
 * ── WHAT ADR-0003 SETTLES, AND WHAT IT DOES NOT ─────────────────────────────────────────────────────
 *
 * `bin/onboard.mjs` records the reason there is no case-law entry in the setup wizard: setup is an OAuth
 * flow, not a variable, so there is no token lying around for the wizard to adopt, and offering to adopt
 * one taught a new install to set something that configures nothing. That reasoning is sound and it
 * settles ONE question — do not offer to adopt an ambient key. It does not settle a different one: tell
 * the reader the lane is dark. Those were conflated, and the second had no surface anywhere.
 *
 * ── DERIVED, AND HONEST ABOUT WHAT IT CANNOT SEE ────────────────────────────────────────────────────
 *
 * The bridge sources come from `CASELAW_BRIDGES` — the list that actually decides what gets spawned —
 * so a source added there appears here the same day. Readiness is a FILE READ, never a probe: the bridge
 * refuses to start without `<credsDir>/<server>.json`, so its presence is exactly the difference between
 * "set up" and "not set up", and it is knowable on a box with no route. Whether a configured source
 * ANSWERS is a run-time fact — the owner's own report says `CONNECTION_CLOSED` — and this says so
 * rather than implying a reachable source.
 *
 * NAMES AND STATES, NEVER VALUES, exactly as the rest of this file: the existence of a token file, never
 * a byte of it.
 */
/**
 * Is this credential file something the bridge could actually use? — tracker issue 173.
 *
 * `existsSync` was the whole test, and a zero-byte file therefore reported as an enrolled case-law
 * source. That is not merely an operator-facing inaccuracy: `driver/case-law-sources.mjs` hands the
 * clearance stage "enrolled on this deployment; if it fails at run time that IS an outage and you
 * report it as one", so a garbage file makes a DELIVERED REPORT disclose an infrastructure outage that
 * never happened, for a source the deployment does not have. That is the exact wrong disclosure
 * case-law-sources.mjs was written to eliminate, reached from the other side.
 *
 * FOUR STATES, BECAUSE THERE ARE FOUR AND NOT TWO:
 *   absent      no file. Never enrolled — the honest, common, fine case.
 *   usable      parses, and carries the refresh token the bridge signs in with.
 *   unusable    present and cannot work: unparseable, or no `tokens.refresh_token`.
 *   unreadable  we could not look — a permission error, an I/O error. NEVER "enrolled" and never
 *               "not set up": an absence of evidence is not evidence of absence, and this check exists
 *               precisely because something invisible was being read as fine.
 *
 * NAMES AND STATES, NEVER VALUES — the rule the rest of this file keeps, kept here. Nothing below
 * prints, logs, returns or interpolates a byte of a token. It asks whether the JSON parses and whether
 * a key is present, which needs no value to leave this function. `expiry` is deliberately NOT a
 * usability test: an expired ACCESS token is the normal resting state of a working credential — the
 * bridge refreshes it on the next call — so failing on it would report every healthy enrolment as
 * broken. The refresh token is what enrolment actually is.
 */
export function credentialState(tokenFile) {
  let raw;
  try {
    if (!existsSync(tokenFile)) return { state: "absent", why: null };
    // A directory where a file is expected reads as present to existsSync and throws on read. That is
    // a could-not-look, not an absence.
    if (statSync(tokenFile).isDirectory()) return { state: "unusable", why: "it is a directory, not a credential file" };
    raw = readFileSync(tokenFile, "utf8");
  } catch (e) {
    return { state: "unreadable", why: `it could not be read (${e.code || e.message})` };
  }
  if (raw.trim() === "") return { state: "unusable", why: "the file is empty" };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { state: "unusable", why: "the file is not valid JSON" }; }
  if (!parsed || typeof parsed !== "object") return { state: "unusable", why: "the file does not hold a credential object" };
  const refresh = parsed.tokens?.refresh_token;
  if (typeof refresh !== "string" || refresh === "") {
    return { state: "unusable", why: "it carries no refresh token, so the bridge cannot sign in" };
  }
  return { state: "usable", why: null };
}

export function caseLawInventory(env = process.env) {
  const credsDir = env.OAUTH_BRIDGE_CREDS_DIR || join(homedir(), ".config", "trademark-oauth-mcp");
  const rows = CASELAW_BRIDGES.map((id) => {
    const tokenFile = join(credsDir, `${id}.json`);
    const credential = credentialState(tokenFile);
    const configured = credential.state === "usable";
    return {
      key: "caselaw",
      label: "Case law and oppositions",
      provider: id,
      providerLabel: CASELAW_LABELS[id] ?? id,
      known: true,
      // ── WHICH ROWS ARE AN ANSWER TO "IS THE LANE DARK" ──────────────────────────────────────────
      //
      // Not every case-law row is one, and reading `configured` alone gets this exactly backwards:
      // EUR-Lex needs no enrolment and is therefore always `configured: true`, so "any configured
      // case-law source" would report every deployment as ready and the composer's warning would never
      // fire on the box it was written for. `enrolment` is what separates a source somebody has to sign
      // in to from one that is simply part of the build.
      enrolment: "oauth",
      configured,
      // THE THIRD STATE, WHICH `configured` CANNOT HOLD (tracker issue 173). `configured` is a boolean
      // and the world has three cases in it: never enrolled, enrolled and usable, enrolled and NOT
      // usable. Collapsing the third into either of the others is the defect — into the first it
      // reads as "not set up" and hides a credential the operator believes in; into the second it
      // instructs the report to disclose an OUTAGE for a source this deployment does not really have.
      credential,
      // NOT a variable to set, and saying "set OAUTH_BRIDGE_CREDS_DIR" would be the exact defect
      // ADR-0003 refused: a name that configures nothing. The missing thing is a one-time sign-in.
      missing: [],
      // NAMES THE ENROLMENT THAT ACTUALLY EXISTS. There is no `login` command in this repo — the bridge
      // is enrolled by the documented one-time OAuth exchange in providers/oauth-mcp-bridge/README.md,
      // which ends by writing the file named here. A printed command that does not exist is its own
      // defect, and it is the one this row would most easily introduce.
      // A PRESENT-BUT-BROKEN CREDENTIAL IS NOT "NOT SET UP", AND SAYING SO SENDS THE OPERATOR THE
      // WRONG WAY. They did the one-time sign-in; telling them to do it again without saying what is
      // wrong with the file they already have is how the last hour of this gets spent.
      remedy: configured
        ? null
        : credential.state === "unusable"
        ? `Enrolled, but the credential cannot be used: ${credential.why}. The file is ${tokenFile}. `
          + `Re-run the one-time OAuth sign-in in providers/oauth-mcp-bridge/README.md to replace it. `
          + `Until then this source is treated as one this deployment does NOT have, and a report `
          + `discloses the gap rather than blaming an outage.`
        : credential.state === "unreadable"
        ? `Could not be checked: ${credential.why}. The file is ${tokenFile}. This is not a report that `
          + `the source is missing and not that it works — fix the permissions or the disk error and `
          + `run this again.`
        : `Not set up. It is a one-time OAuth sign-in rather than a variable to set: `
          + (CASELAW_SITES[id]
              ? `create an account at ${CASELAW_SITES[id]}, then follow `
              : `this build records no site to create an account at — ask whoever provisioned the `
                + `bridge for it rather than searching, then follow `)
          + `providers/oauth-mcp-bridge/README.md, which ends by writing ${tokenFile}. Until then a `
          + `Full country search still runs, and its report discloses the case-law gap instead of `
          + `reporting no adverse case law.`,
    };
  });

  // EUR-Lex reads through the engine's own fetch tool, so there is nothing to configure and nothing that
  // can be missing. It is LISTED anyway: a reader counting case-law sources against a report that named
  // four gaps must be able to find all four here, and a lane that is absent from this page is
  // indistinguishable from one nobody has heard of. 's fifth criterion.
  rows.push({
    key: "caselaw", label: "Case law and oppositions", provider: "eur-lex",
    providerLabel: CASELAW_LABELS["eur-lex"],
    known: true, enrolment: "built-in", configured: true, missing: [],
    remedy: null,
  });

  // ── THE TWO THE REPORT NAMED AND THIS BUILD DOES NOT SHIP ────────────────────────────────────────
  //
  // "no EUIPO Boards-of-Appeal source" and "WebSearch unavailable this session" were the other two gaps
  // in the same report, and the issue asks for the same treatment. They get it, and the treatment is to
  // say what is TRUE of each rather than to invent a switch:
  //
  //   · the Boards of Appeal have no adapter in this build. That is a release fact, not a setting, and
  //     an operator can do nothing about it — which is precisely what they need to be told before they
  //     spend two hours discovering it from a report.
  //   · WebSearch is the engine's own tool. Whether it answers is decided per session by the engine, so
  //     no deployment check can promise it. Recorded as a capability with a stated limit rather than as
  //     a green tick this file cannot honestly give.
  rows.push({
    key: "caselaw", label: "Case law and oppositions", provider: "euipo-boards-of-appeal",
    providerLabel: "EUIPO Boards of Appeal", known: false, enrolment: "absent", configured: false, missing: [],
    remedy: "Not part of this build. There is no adapter for it, so no setting turns it on and a report "
      + "covering the EU discloses it as a gap. Nothing to fix on this box.",
  });
  rows.push({
    key: "web", label: "Open-web search", provider: "engine-websearch",
    providerLabel: "The engine's own web search", known: true, enrolment: "built-in", configured: true, missing: [],
    remedy: "Provided by the engine, not by this deployment, and it can be unavailable for a single "
      + "session. A run that loses it discloses the gap rather than reporting a clean sweep.",
  });
  return rows;
}

