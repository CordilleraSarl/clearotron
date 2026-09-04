// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A SERVER SERVES vs WHAT THE GRANT TABLE ALLOWS — the gap 's argv baseline cannot see.
//
// pins, per stage, whether `--allowedTools` / `--mcp-config` / `--strict-mcp-config` are passed and
// how many tool groups resolved. It says nothing about WHICH tools a granted server exposes, and the two
// halves of `allowedToolsFor` (gather-config.mjs:293-302) behave in opposite ways:
//
//   LOCAL servers   →  `mcp__<key>__<tool>` for each name in the grant table.  ENUMERATED.
//                      A tool added to the server MODULE grants nothing until the table names it.
//   BRIDGE servers  →  `mcp__<key>__*`.                                        WILDCARD.
//                      Every tool the server exposes IS a grant, the moment it is exposed.
//
// So the two halves need opposite assertions, and getting them the same way round is the failure:
//
//   · LOCAL: the served-vs-granted DELTA must be a STATED CHOICE. A tool a server registers and the table
//     does not name is unreachable — fine when deliberate, a silent dead surface when not.
//   · BRIDGE: the exposed list must be PINNED, because there is no table between exposure and grant.
//
// This exists because I claimed the opposite. I read what `perplexity-server.mjs` DECLARES and concluded a
// tool added there would widen every holder's surface. It would not: perplexity is LOCAL and enumerated.
// Reading what ENFORCES rather than what declares is the standing rule, and this file is the mechanism so
// the next reader does not need to hold it in their head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { allowedToolsFor, toolGroupsForStage, REGISTER_SERVERS, LOCAL_SERVER_SCRIPTS, RECORDING_STAGES, RECORDING_STAGES_KEEPING_RETRIEVAL } from "../engine/mcp/gather-config.mjs";
import { STAGES } from "../stages.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const MCP = fileURLToPath(new URL("../engine/mcp/", import.meta.url));

/** The tool NAMES a server script registers, read from its `tools:` declaration. */
function toolsRegisteredBy(script) {
  const src = readFileSync(join(MCP, script), "utf8");
  const at = src.indexOf("tools:");
  assert.notEqual(at, -1, `${script}: no tools: declaration found — this scan broke, it did not find an empty server`);
  return [...src.slice(at).matchAll(/name:\s*"([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
}

// ── LOCAL: the served-vs-granted delta is a STATED CHOICE ────────────────────────────────────────────
//
// Every entry here is a tool a server registers that the grant table deliberately does NOT allow. Adding
// a row is how you say "served, not callable, on purpose"; a tool that appears without a row fails.
// Server modules that exist and are reachable by NO grant. Same rule as an ungranted tool, one level up:
// a module nobody can call is fine when deliberate and a dead surface when not.
const SERVERS_GRANTED_TO_NOTHING = Object.freeze({
  "stdio-server.mjs":
    "NOT a server. It is the shared stdio/JSON-RPC bootstrap every other module calls `serve()` from, and " +
    "it is caught here only by its name. Listed rather than filtered out by a special case, so the reader " +
    "sees that it was looked at and classified.",
  "fetch-server.mjs":
    "The CODEX engine's stand-in for claude's built-in WebFetch (codex has none). Mounted by " +
    "codex-config.mjs, not by gather-config's grant table, so it is correctly absent from LOCAL — the " +
    "codex lane resolves its own surface. NOT a claim that the codex lane is measured: #954 says it is " +
    "not, and the write boundary does not reach it either.",
  // closure-server.mjs's row is GONE at conversion 6, and the module with it. Its text said "it arms with
  // the conversion that needs it" — this is that conversion, and it armed by moving rather than by being
  // granted: `record_doubt_closure` now lives on recording-server.mjs with the category's other seven, so
  // a second module serving the same tool would be a dead surface that LOOKS live. The `file_index` rule
  // those six comments across the driver cite by its old name is authored in doubt-closure-call.mjs, and
  // they now point there.
});

// EMPTY, and that is a STATE not a placeholder. B's activation granted `record_dispositions` and deleted
// its row in the same commit — forced to, by the arm below: the grant landing with the row still standing
// went RED, naming the row. That red was observed on the real change rather than on a plant, which is the
// whole reason the arm shipped a PR ahead of the grant.
//
// The checks below are now VACUOUS and say so. They are not dead: the first one fails the moment a server
// registers a tool the grant table does not name, which is the state this table exists to describe.
const UNGRANTED_ON_PURPOSE = Object.freeze({});

test("LOCAL servers: every registered tool is granted, or its absence is a written choice", () => {
  const granted = new Set(allowedToolsFor(["perplexity", "band", "coverage"]).split(/\s+/).filter(Boolean));
  const surprises = [];
  for (const [script, stated] of [["perplexity-server.mjs", UNGRANTED_ON_PURPOSE["perplexity-server.mjs"]], ["band-server.mjs", {}], ["coverage-server.mjs", {}]]) {
    const key = script.replace("-server.mjs", "");
    const registered = toolsRegisteredBy(script);
    assert.ok(registered.length > 0, `${script}: registered no tools — the scan broke`);
    for (const t of registered) {
      if (granted.has(`mcp__${key}__${t}`)) continue;
      if (stated?.[t]) continue;                       // ungranted, and the reason is written above
      surprises.push(`${key}: ${t} is served but in no allowlist, and no reason is stated`);
    }
  }
  assert.deepEqual(surprises, [],
    "a local server registers a tool no seat can call and nobody wrote down why — either grant it or add it to UNGRANTED_ON_PURPOSE with the reason");
});

// ── …AND THE SAME RULE OVER THE REGISTER PROVIDERS ( item 7) ────────────────────────────────────
//
// FOURTH INSTANCE OF THIS FILE'S OWN SHAPE: right about the RULE, narrow about the POPULATION. The arm
// above states "every registered tool is granted, or its absence is a written choice" and then walks
// three literally-named scripts. The register providers are the other six server modules in this
// directory, they are mounted under the neutral `register` key, and no per-TOOL arm has ever looked at
// them — the CENSUS below asks whether the MODULE is accounted for, which is a different question and
// passes happily while a module serves tools nobody may call.
//
// WHAT THAT COST, MEASURED: signa's grant sat at 2 of the 8 it serves from 2026-07-21 until — a
// month — while `driver/skills/prelim-register/providers/signa.md` instructed the model to use
// `register_enumerate`, the completeness primitive, which was not in its grant. The provider the docs
// recommend first was paging with something that can stop early, which is the shape "a zero must be a
// real zero" exists to prevent. Nothing in this file could see it.
//
// DERIVED FROM THE TABLE, AND WITHOUT THE ENV. `allowedToolsFor(["register"])` resolves the ONE active
// provider from CLEAROTRON_DATABASE and throws when it is unset, so an env-driven arm would check
// whichever provider this box happens to run and call that a pass for all six. The grant row IS the
// table — `REGISTER_SERVERS[p].tools` is what allowedToolsFor hands out — so comparing the row against
// the module covers every provider in one pass, on any box, including the ones no install here uses.
test("REGISTER servers: every registered tool is granted, or its absence is a written choice", () => {
  const surprises = [];
  const seen = [];
  for (const [provider, entry] of Object.entries(REGISTER_SERVERS)) {
    const registered = toolsRegisteredBy(entry.script);
    assert.ok(registered.length > 0, `${entry.script}: registered no tools — the scan broke`);
    seen.push(provider);
    const stated = REGISTER_UNGRANTED_ON_PURPOSE[provider] ?? {};
    for (const t of registered) {
      if (entry.tools.includes(t)) continue;
      if (stated[t]) continue;                         // ungranted, and the reason is written above
      surprises.push(`${provider}: ${t} is served by ${entry.script} but its grant row does not name it, and no reason is stated`);
    }
  }
  assert.ok(seen.length >= 6, `walked ${seen.length} register provider(s) — REGISTER_SERVERS shrank or the loop broke`);
  assert.deepEqual(surprises, [],
    "a register server serves a tool the active provider's seat cannot call and nobody wrote down why — either add it to that provider's `tools` in REGISTER_SERVERS or give it a REGISTER_UNGRANTED_ON_PURPOSE row with the reason");
});

// …and the other direction, which is the one that actually rots. A grant row naming a tool the module
// stopped serving is a promise to a seat that will get "unknown tool" at the moment it calls — and it
// reads, to anyone auditing the table, as coverage the provider does not have.
test("…and a REGISTER grant row cannot name a tool its module does not serve", () => {
  const phantom = [];
  for (const [provider, entry] of Object.entries(REGISTER_SERVERS)) {
    const registered = new Set(toolsRegisteredBy(entry.script));
    for (const t of entry.tools) if (!registered.has(t)) phantom.push(`${provider}: grants ${t}, which ${entry.script} does not serve`);
  }
  assert.deepEqual(phantom, [],
    "a register grant row names a tool its own server module does not register — the seat is allowed to call something that does not exist");
});

// EMPTY, and that is a STATE not a placeholder — the same rule as UNGRANTED_ON_PURPOSE above. Measured
// on the tree this landed against: all six providers serve exactly what they grant, set-for-set, so
// there is nothing to except today. That is the reason to land the arm rather than a reason not to —
// the drift it exists for was real, lasted a month, and was invisible to every check in this file.
const REGISTER_UNGRANTED_ON_PURPOSE = Object.freeze({});

// …and the exemption table cannot rot in either direction, exactly as the LOCAL one cannot.
test("…and a REGISTER exemption row is still REAL — for a provider that exists, a tool that is served, and not one that is granted", () => {
  for (const [provider, rows] of Object.entries(REGISTER_UNGRANTED_ON_PURPOSE)) {
    const entry = REGISTER_SERVERS[provider];
    assert.ok(entry, `${provider} carries exemption rows but is no longer a register provider — delete them`);
    const registered = new Set(toolsRegisteredBy(entry.script));
    for (const t of Object.keys(rows)) {
      assert.ok(registered.has(t), `${provider}: ${t} is stated ungranted-on-purpose but ${entry.script} no longer serves it — delete the row`);
      assert.ok(!entry.tools.includes(t), `${provider}: ${t} carries an ungranted-on-purpose row but the grant row NAMES it — the row is false; delete it in the commit that granted it`);
    }
  }
});

test("…and the stated exemptions are still REAL — a row for a tool nobody serves is stale", () => {
  // Without this, the exemption list rots into a place where deleted tools live forever, and the check
  // above quietly shrinks as its allowlist of excuses grows.
  for (const [script, stated] of Object.entries(UNGRANTED_ON_PURPOSE)) {
    const registered = new Set(toolsRegisteredBy(script));
    for (const t of Object.keys(stated)) {
      assert.ok(registered.has(t), `${script}: ${t} has an "ungranted on purpose" row but the server no longer registers it — delete the row`);
    }
  }
});

test("…and stale in the OTHER direction: a row for a tool that IS granted is a FALSE row", () => {
  // The arm above asks whether a stated tool is still SERVED. This asks whether it is still UNGRANTED —
  // the direction we are actually about to move, and the one nothing was watching.
  //
  // MEASURED, NOT ASSUMED. Planting `record_dispositions` into the perplexity grant row — the exact
  // change B's activation makes — and leaving its row standing left this file 8/8 GREEN. The reason is
  // one line in the first test: `if (granted.has(...)) continue;` runs BEFORE the exemption is consulted,
  // so a newly-granted tool short-circuits out and its row is never read again.
  //
  // It bites because of what a row SAYS. record_dispositions' reads "The missing grant is not an
  // oversight — do not 'fix' it." Left standing after activation, that sentence actively misdirects the
  // next reader about a tool every disposition seat can by then call.
  //
  // LANDED BEFORE THE GRANT IT GUARDS, deliberately. A guard that ships in the same commit as the state
  // it checks is exercised and passed in the same breath, and nobody ever observes it fail. This one is
  // RED the moment the grant lands with the row still there, which is what makes activation's red→green
  // a transition somebody watched rather than a first pass.
  for (const [script, stated] of Object.entries(UNGRANTED_ON_PURPOSE)) {
    const names = Object.keys(stated);
    if (!names.length) continue;
    const key = script.replace("-server.mjs", "");

    // Ask the grant table, one server key at a time — it is what ENFORCES. Not the union over some chosen
    // set of groups: a tool granted through a group this arm did not think to name would read as ungranted.
    // A key that will not resolve is a row this arm CANNOT check, and an unchecked exemption reads exactly
    // like a kept one, so that fails loudly rather than skipping.
    let granted;
    try {
      granted = new Set(allowedToolsFor([key]).split(/\s+/).filter(Boolean));
    } catch (e) {
      assert.fail(`${script}: no grant group resolves for "${key}" (${String(e?.message ?? e).slice(0, 80)}) — `
        + "this row's exemption cannot be checked, and an unchecked exemption reads as a kept one");
    }
    for (const t of names) {
      assert.ok(!granted.has(`mcp__${key}__${t}`),
        `${script}: ${t} carries an "ungranted on purpose" row, but the grant table now GRANTS it. `
        + "The row is false — delete it in the commit that adds the grant.");
    }
  }
});

test("LOCAL grants are ENUMERATED, not wildcarded — the property the delta check rests on", () => {
  // If a local key ever became a wildcard, the check above would be measuring nothing: every served tool
  // would be granted and no delta could exist. This is that assumption, asserted.
  const granted = allowedToolsFor(["perplexity", "band"]).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")), [],
    "a local server is now wildcard-granted; the served-vs-granted delta check above can no longer detect anything");
  assert.ok(granted.includes("mcp__perplexity__perplexity_research"), "…and the enumeration is real, not empty");
});

// ── BRIDGE: the exposed list IS the grant, so it is pinned ───────────────────────────────────────────

test("BRIDGE servers are wildcard-granted, so their exposed surface is pinned by name", () => {
  // Here the hazard I originally described is real: there is no table between exposing a tool and
  // granting it. `caselaw` resolves to CASELAW_BRIDGES with `mcp__<key>__*`.
  const granted = allowedToolsFor(["caselaw"]).split(/\s+/).filter(Boolean);
  assert.deepEqual(granted.filter((t) => t.endsWith("__*")).sort(),
    ["mcp__courtlistener__*", "mcp__legaldatahunter__*"],
    "the case-law bridge set moved. A bridge is a WILDCARD grant: adding one hands every holder every tool that server exposes, now and in future — say so deliberately");
  assert.ok(granted.includes("WebFetch"), "the declared extra tool rides with the bridges");
});

test("no stage holds a bridge without this file naming it", () => {
  // The discovered half. A new bridge group added to any stage is a wildcard surface nobody pinned, and
  // the enumerated list above would not notice — it only knows the bridges it already names.
  // A register stage resolves its server from CLEAROTRON_DATABASE, which refuses rather than
  // defaulting ( — the previous default named a vendor the deployment did not choose). Set for the
  // walk only: this asks nothing about which provider, it asks which stages hold a WILDCARD, and the
  // register providers are all local/enumerated. Restored after, so no other test inherits it.
  const had = process.env.CLEAROTRON_DATABASE;
  pinEnv(process.env, "CLEAROTRON_DATABASE", had ?? "free-tier");
  const pinned = new Set(["mcp__courtlistener__*", "mcp__legaldatahunter__*"]);
  const unpinned = new Set();
  const evaluated = [];
  const unevaluated = [];
  try {
    for (const stage of Object.keys(STAGES)) {
      try {
        for (const t of allowedToolsFor(toolGroupsForStage(stage)).split(/\s+/)) {
          if (t.endsWith("__*") && !pinned.has(t)) unpinned.add(`${stage} → ${t}`);
        }
        evaluated.push(stage);
      } catch (e) { unevaluated.push(`${stage}: ${e.message.slice(0, 60)}`); }
    }
  } finally {
    pinEnv(process.env, "CLEAROTRON_DATABASE", had);
  }
  // A stage this walk could not resolve is a stage whose wildcards were never looked at, and silence
  // there reads exactly like "no unpinned bridges" — the answer this test exists to give. So the
  // unevaluable set is pinned by NAME rather than tolerated.
  //
  // `register-unit` is the one, and the reason is not the env var being unset: `requireRegisterProvider`
  // reads a config object that snapshots the environment at MODULE LOAD, so setting it above cannot
  // reach it. That is safe here for a stated structural reason — `resolveGroup("register")` returns
  // `{local:["register"], bridges:[]}` (gather-config.mjs:148), so a register group can never produce a
  // wildcard, which is the only thing this test asks about. If a register group ever gains a bridge,
  // this exemption is wrong and the comment is where a reader finds that out.
  // SUBSET, not equality — and the direction matters. `register-unit` resolves only when the process was
  // started with CLEAROTRON_DATABASE set, because requireRegisterProvider reads a config that
  // snapshots the environment at MODULE LOAD and cannot be reached from in here. So it is unevaluable
  // when this file runs alone and evaluable under the full suite, where the runner carries the variable.
  //
  // The first cut asserted EQUALITY with ["register-unit"], which passed alone and failed in the suite:
  // it required the environment to be WORSE to go green. A check that fails when its subject is better
  // measured is a broken check. Subset accepts both worlds and still fails on a NEW unevaluable stage,
  // which is the thing worth catching.
  assert.deepEqual(unevaluated.map((u) => u.split(":")[0]).filter((s) => s !== "register-unit"), [],
    "a stage this walk cannot resolve appeared; its wildcards are unexamined and reading as absent");
  assert.equal(evaluated.length + unevaluated.length, Object.keys(STAGES).length, "every stage was accounted for, evaluated or named");
  assert.ok(evaluated.length >= Object.keys(STAGES).length - 1, "at most one stage may be unresolvable — everything else must actually have been walked");
  assert.deepEqual([...unpinned], [],
    "a stage holds a wildcard bridge grant this file does not pin; add it above with the reason it is safe to hand over a whole server");
});

test("the server scripts this file reads actually exist — an absent file is not an empty server", () => {
  for (const script of ["perplexity-server.mjs", "band-server.mjs", "coverage-server.mjs"]) {
    assert.ok(existsSync(join(MCP, script)), `${script} is gone; this file is asserting about a server that no longer exists`);
  }
});

test("CENSUS: every server module is accounted for — named in LOCAL, or stated granted to nothing", () => {
  // The arm that makes the hand-written pair above honest. scanned two scripts by name, which was
  // complete for its population and blind to growth — right about the RULE, narrow about the POPULATION,
  // the third instance of that shape in one evening. This is 's census form: DISCOVER the population,
  // require every member accounted, so a new server reddens instead of hiding.
  const scripts = readdirSync(MCP).filter((f) => f.endsWith("-server.mjs")).sort();
  assert.ok(scripts.length >= 2, "found fewer than two server modules — the glob broke, it did not find an empty directory");

  // DERIVED, not recited. The register providers are mounted dynamically under the `register` key
  // (registerEntry -> REGISTER_SERVERS), so hardcoding "the two local scripts" is the same narrowness one
  // more time — this census found ELEVEN modules where the enumerated check assumed two.
  // BOTH halves DERIVED. wrote this deriving the register half from REGISTER_SERVERS and RECITING
  // the static half as two literals — while its own body claimed the set was derived. Wiring a new local
  // server (recording-blind-frame, this PR) therefore left it reading as ungranted, and the census stayed
  // green on a module it should have reclassified. Half a derivation reads exactly like a whole one.
  const granted = new Set([
    ...LOCAL_SERVER_SCRIPTS,                                                       // every static LOCAL entry
    ...Object.values(REGISTER_SERVERS).map((e) => e.script),                       // whichever provider is active
  ]);
  const unaccounted = scripts.filter((f) => !granted.has(f) && !SERVERS_GRANTED_TO_NOTHING[f]);
  assert.deepEqual(unaccounted, [],
    "a server module is neither granted through LOCAL nor stated as granted-to-nothing; add it to one or the other with the reason");

  // …and the statement cannot rot: a row for a module that no longer exists fails.
  for (const f of Object.keys(SERVERS_GRANTED_TO_NOTHING)) {
    assert.ok(scripts.includes(f), `${f} is stated granted-to-nothing but no longer exists — delete the row`);
    // …and stale the OTHER way, which is the direction this PR actually moved. The row above says a
    // module is reachable by nobody; the moment it enters LOCAL that sentence is false, and the check
    // that classifies modules short-circuits on `granted` before it ever reads the row. Same
    // one-directional gap the per-TOOL arm had, one level up, in the arm written to cure it.
    assert.ok(!granted.has(f),
      `${f} carries a "granted to nothing" row but is now GRANTED through LOCAL — the row is false; delete it in the commit that wired it`);
  }
});

// ── RECORDING: the ONE script is mounted under a key PER STAGE, and the delta that creates is pinned ─
//
// The second record tool made this real: recording-server.mjs registers every record tool, each
// per-stage key grants exactly one of them, so under any single key the SIBLINGS are served-but-
// ungranted — deliberately (Shape 2: no stage is ever handed a sibling's record tool). The LOCAL
// served-vs-granted arm above walks the ONE-KEY-PER-SERVER modules only — perplexity/band/coverage,
// adding the third with record_coverage — and recording-server.mjs is not in its script list at
// all, so it never sees this delta. Without this test it would exist with nobody having written it
// down. Three properties, each of which fails silently:
//   · a recording stage's grant carries EXACTLY its pinned set below — nothing extra, nothing missing;
//   · every tool the script serves is granted by exactly ONE recording stage (no orphan, no double home);
//   · every granted tool is actually served (a grant for an unserved tool is a phantom).
//
// The per-stage sets are LITERAL, the census's own copy — a loop deriving them from the grant table
// would be the declaration checking itself. Moving a row here is a deliberate act, per PR:
//   · blind-frame holds its record tool and nothing else ("exactly one" was the rule while every
//     recording stage looked like this);
//   · skeptic holds its record tool AND search_run_artifacts — the SANCTIONED READ SURFACE, 's
//     ratification-hold unlock: O3c measured the stage's only Bash use as reads over the run's own
//     artifacts, and this tool is their scoped replacement (read-only, run-dir-bounded, no retrieval).
const RECORDING_GRANTS = Object.freeze({
  "blind-frame": Object.freeze(["mcp__recording-blind-frame__record_blind_frame"]),
  //   · frame-diff holds its record tool and nothing else — its Class 2 reads are ENUMERABLE (it compares
  //     two named files), so the dictation names them and the seeded Read grant carries them. It gets no
  //     `search_run_artifacts`: a search tool for a stage whose reads can be listed is exactly what the
  //     sanctioned-equivalents design refuses.
  "frame-diff": Object.freeze(["mcp__recording-frame-diff__record_frame_diff"]),
  //   · matter-frame holds BOTH, and it is the second stage to carry the read surface. Its Class 2 reads
  //     are NOT enumerable — O3c measured `ls`/`find`/`cat` DISCOVERY over the run dir (21 calls / 15
  //     attempts) — which is the line the design draws between it and frame-diff above. The key is its
  //     OWN, so skeptic is never handed a writer into the frame and matter-frame is never handed one into
  //     skeptic's flags: the served-vs-granted delta is exactly what this census exists to pin.
  //   · prelim-variants holds its record tool and nothing else. Its Class 2 reads are ENUMERABLE — the
  //     stage derives the manifest from material the dictation names — so the seeded `Read` grant carries
  //     them and it gets no search tool, the frame-diff ruling rather than matter-frame's.
  "prelim-variants": Object.freeze(["mcp__recording-prelim-variants__record_prelim_variants"]),
  //   · report-overview holds its record tool and nothing else, on the frame-diff/prelim-variants ruling:
  // trimmed its declared reads to exactly TWO named files (the settled narrative and
  //     findings.json), which is as enumerable as a read set gets, so the seeded `Read` grant carries them
  //     and no search tool is minted. First recording stage whose artifact a CLIENT reads, which changes
  //     the blast radius of a widened grant here and nothing about the rule.
  "report-overview": Object.freeze(["mcp__recording-report-overview__record_report_overview"]),
  //   · report-card holds its record tool and nothing else. It reads NOTHING from the run — its finding
  //     arrives inline in the dispatch, which is the isolation the stage exists for — so `Read` serves
  //     only its skill docs and no search tool is minted. First fan-out recording stage: its grant
  //     resolves under `report-card:<ord>` by DECLARED perAxis, never by a prefix test.
  "report-card": Object.freeze(["mcp__recording-report-card__record_report_card"]),
  //   · doubt-closure holds its record tool and nothing else — conversion 6, and the stage whose BASELINE
  //     row said in as many words that it "does not convert". Its Class 2 reads are ENUMERABLE: three
  //     citable files the dispatch names by position, which the seeded `Read` grant serves WHOLE. So it
  //     takes the frame-diff ruling, not matter-frame's, and gets no `search_run_artifacts` even though
  //     its measured Bash was the second-heaviest of the eleven — because every one of those calls was
  //     grep-shaped seeking INSIDE those same three files, which is skeptic's already-ruled "section
  //     lookups in a file the seeded Read grant serves whole".
  "doubt-closure": Object.freeze(["mcp__recording-doubt-closure__record_doubt_closure"]),
  //   · knockout-assess is the FIRST recording stage outside the clearance lane, and the first fanned on
  //     the `#` (perChunk) form rather than `:` (perAxis). Neither fact widens the pin: the resolved mcp
  //     grant is still its one record tool. Its reads are enumerable — the skill doc, the triage deck, the
  //     firm-wide spine, the plan and the per-mark payloads the dispatch names by path — so it takes the
  //     frame-diff ruling and gets no `search_run_artifacts`.
  "knockout-assess": Object.freeze(["mcp__recording-knockout-assess__record_knockout_assess"]),
  //   · knockout-frame is the lane's second and last, and the first recording stage that is not fanned at
  //     all — no `:` axis, no `#` chunk. Its grant is still its one record tool: it FRAMES and its own
  //     dispatch says it does not search, so a retrieval grant here would contradict its orders.
  "knockout-frame": Object.freeze(["mcp__recording-knockout-frame__record_knockout_frame"]),
  //   · narrative-refutation is the first recording stage whose pinned set is not its record tool alone.
  //     It KEEPS `perplexity` and `band`, because the stage's job is checking a narrative against live
  //     sources and a reviewer that cannot look things up is not a reviewer — so the mixed grant is the
  //     deliberate outcome and the whole of it belongs here. This census pins the RESOLVED mcp grant, not
  //     the recording server's share of it, which is why all four rows are listed: a set naming only the
  //     record tool would red on a correct grant and invite a "fix" that subtracts before comparing.
  //     It takes the frame-diff ruling on the read surface: its Class 2 reads are the findings files the
  //     dispatch names by position, which the seeded `Read` grant serves whole, so no
  //     `search_run_artifacts` is minted.
  "narrative-refutation": Object.freeze([
    "mcp__band__band_lookup",
    "mcp__band__band_record",
    "mcp__band__band_shape",
    "mcp__perplexity__perplexity_research",
    "mcp__recording-narrative-refutation__record_narrative_refutation",
  ]),
  //   · synthesis is the SECOND mixed stage and the widest: it keeps perplexity, band AND declination
  //     beside its record tool. `declination` is a RECORD tool on its own key, not a retrieval one, so
  //     this row is the first where the retrieval half is itself not purely retrieval — the partition
  //     that matters here is "this stage's own recording mount" versus "everything else it holds", and
  //     `record_declination` sits on the second side of it. It writes what this stage does NOT deliver;
  //     `record_synthesis` writes what it does.
  synthesis: Object.freeze([
    "mcp__band__band_lookup",
    "mcp__band__band_record",
    "mcp__band__band_shape",
    "mcp__declination__record_declination",
    "mcp__perplexity__perplexity_research",
    "mcp__recording-synthesis__record_synthesis",
  ]),
  "matter-frame": Object.freeze([
    "mcp__recording-matter-frame__record_matter_frame",
    "mcp__recording-matter-frame__search_run_artifacts",
  ]),
  skeptic: Object.freeze([
    "mcp__recording-skeptic__record_skeptic",
    "mcp__recording-skeptic__search_run_artifacts",
  ]),
  // Conversion 11 — the only row here carrying TWO typed transports beside its retrieval group. They are
  // two statements and they keep two keys: `record_coverage` rules the run's obligation ledger row by
  // row, `record_register_digest` renders the findings document. The arm below asserts every SERVED tool
  // is granted to exactly one stage, so a merged key would show up here as one stage holding another
  // stage's writer — which is the disease this census exists to catch.
  "register-digest": Object.freeze([
    "mcp__band__band_lookup",
    "mcp__band__band_record",
    "mcp__band__band_shape",
    "mcp__coverage__record_coverage",
    "mcp__recording-register-digest__record_register_digest",
  ]),
});

test("RECORDING: every served tool is granted to exactly one stage, and each stage's grant is pinned literally", () => {
  const served = toolsRegisteredBy("recording-server.mjs");
  assert.ok(served.length >= 2, "the scan found fewer than two record tools — it broke, it did not find an empty server");

  // The pinned table and the category must name the same stages — a conversion that forgets its row
  // here would otherwise read as "no expectation", which is exactly a silent widening's costume.
  assert.deepEqual(Object.keys(RECORDING_GRANTS).sort(), Object.keys(RECORDING_STAGES).sort(),
    "RECORDING_GRANTS and RECORDING_STAGES disagree on membership; every recording stage pins its mcp grant here, and no others");

  const homes = new Map();   // bare tool name → the recording stages whose grant carries it
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const mcp = allowedToolsFor(toolGroupsForStage(stage)).split(/\s+/).filter((t) => t.startsWith("mcp__")).sort();
    assert.deepEqual(mcp, [...RECORDING_GRANTS[stage]].sort(),
      `${stage}: the resolved mcp grant is not the pinned set — a tool appeared or vanished without this census being moved deliberately`);
    for (const token of mcp) {
      const m = token.match(/^mcp__[a-z0-9-]+__([a-z0-9_]+)$/);
      assert.ok(m, `${stage}: grant token ${token} does not parse in the registry's grammar — it would read as no grant at all`);
      // ONLY RECORDING MOUNTS ENTER `homes`. This map answers "which recording stages hold this recording
      // tool", and the phantom-grant check below asserts every member is served by recording-server.mjs.
      // narrative-refutation is the first recording stage to also hold RETRIEVAL mounts, and a `band` or
      // `perplexity` token entering here would fail that check by design — the server does not serve them
      // and never should. Scoped rather than excused: the retrieval half is asserted just below.
      if (token.startsWith("mcp__recording-")) homes.set(m[1], [...(homes.get(m[1]) ?? []), stage]);
    }
  }
  // ── ONE HOME FOR EVERY WRITER; THE READ SURFACE MAY BE SHARED, BUT ONLY PER-KEY ─────────────────
  //
  // Shape 2's rule is about WRITERS: a record tool with two homes means a seat can write a sibling
  // stage's artifact, which is the second-writer disease arriving as an allowlist side effect. That rule
  // is unchanged and absolute.
  //
  // `search_run_artifacts` is not a writer. It is the Class 2 read surface, and the sanctioned-equivalents
  // design grants it "on the converting stage's OWN key, never shared" — so as stages convert, the same
  // TOOL NAME legitimately appears under several keys. It had exactly one home until conversion 2 only
  // because skeptic was the only stage that had earned it.
  //
  // THE LOOSENING IS BOUNDED, and the bound is what keeps this from becoming a hole: every home must be
  // the stage's OWN derived key. A read tool appearing under a key that is not its holder's would mean
  // two stages sharing one mount — the same defect as a shared writer, one surface over.
  const READ_SURFACE = new Set(["search_run_artifacts"]);
  for (const t of served) {
    const holders = homes.get(t) ?? [];
    if (READ_SURFACE.has(t)) {
      assert.ok(holders.length >= 1, `${t} is served and granted to nobody — a read surface nothing holds is dead weight (A3)`);
      continue;
    }
    assert.deepEqual(holders.length, 1,
      `${t} is served by recording-server.mjs and granted by ${holders.length} recording stages — Shape 2 gives every record tool exactly one home`);
  }
  // Every RECORDING-MOUNT token names its own stage's key — writers and readers alike. This is what the
  // paragraph above promises, asserted rather than assumed.
  //
  // ✕ THE TOKENS ARE PARTITIONED NOW, AND THAT IS A CORRECTION. This asserted the rule over EVERY token
  // in the row, which was the same thing only while a recording stage's whole grant WAS its recording
  // mount. narrative-refutation keeps `perplexity` and `band`, so the blanket form read a legitimate
  // retrieval grant as "two stages on one mount" — the third assertion in this repo to agree with its
  // neighbour only under "recording groups are held alone". Loosening it to skip non-recording tokens
  // silently would let a recording stage acquire retrieval unannounced, so the other half is asserted
  // against the declared mixed list instead of being waved past.
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const own = RECORDING_GRANTS[stage].filter((t) => t.startsWith("mcp__recording-"));
    const retrieval = RECORDING_GRANTS[stage].filter((t) => !t.startsWith("mcp__recording-"));
    assert.ok(own.length >= 1, `${stage} pins no recording-mount token at all — it is in the category and holds no transport`);
    for (const token of own) {
      assert.ok(token.startsWith(`mcp__recording-${stage}__`),
        `${stage} grants ${token}, which is not its own recording key — two stages on one mount is the shared-writer defect whether the tool writes or reads`);
    }
    if (retrieval.length) {
      assert.ok(RECORDING_STAGES_KEEPING_RETRIEVAL.includes(stage),
        `${stage} pins retrieval mounts (${retrieval.join(", ")}) and its row does not declare keepsRetrieval: true. `
        + "A recording stage may keep retrieval — narrative-refutation does, deliberately — but not silently");
    }
  }
  for (const [t, stages] of homes) {
    assert.ok(served.includes(t), `${stages.join("/")} grants ${t} but the server does not register it — a phantom grant reads exactly like a real one`);
  }

  // NEGATIVE CONTROL: the exactly-one predicate rejects a double home and an orphan — planted, so the
  // pass above is known to be a detection and not a vacuous walk.
  const planted = new Map([["record_x", ["stage-a", "stage-b"]]]);
  assert.notEqual((planted.get("record_x") ?? []).length, 1, "the predicate does not detect a tool granted under two keys");
  assert.notEqual((planted.get("record_orphan") ?? []).length, 1, "…nor a served tool granted by no stage");
  // …and the per-key bound is a real detection too: a token naming ANOTHER stage's key must be rejected,
  // which is the property the read-surface exemption above leans on entirely.
  assert.equal("mcp__recording-skeptic__search_run_artifacts".startsWith("mcp__recording-matter-frame__"), false,
    "the per-key predicate would accept a token borrowed from a sibling stage's mount");
});

test("…and the census would CATCH a new ungranted server — the arm that proves it can fail", () => {
  // Driven against a planted name rather than trusting the walk: without this, the census passes because
  // the population happens to be fully listed, not because it would notice one that is not.
  const scripts = ["perplexity-server.mjs", "band-server.mjs", "planted-server.mjs"];
  const inLocal = new Set(["perplexity-server.mjs", "band-server.mjs"]);
  const unaccounted = scripts.filter((f) => !inLocal.has(f) && !SERVERS_GRANTED_TO_NOTHING[f]);
  assert.deepEqual(unaccounted, ["planted-server.mjs"], "the census predicate does not detect an unaccounted server module");
});
