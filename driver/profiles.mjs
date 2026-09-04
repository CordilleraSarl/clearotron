// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// profiles.mjs — per-customer configuration.
//
// One git-owned JSON file per customer under profiles/ — hand-authored, PR-reviewed, onboarded one
// customer at a time. generic.json is the universal fallback and MUST exist;
// aurora.json reproduces today's behavior exactly (the regression anchor). Every field shipped
// here has working machinery behind it — parked knobs live in profiles/README.md, not in the files.
//
// Resolution is FORWARDER-DOMAIN ONLY: the profile describes WHO ASKS US (the
// account), matched with the exact selectCustomer semantics (phase0.mjs — `===` or dot-suffix).
// job.customer is the free-text APPLICANT — absent on customerUnknown jobs, late-bindable mid-run —
// it never selects a profile; it only activates the self-exclusion seed when it matches the
// profile's customer identity (applicantMatchesProfile below).
//
// The floor and the grid batch size are DERIVED, never stored — two sources of truth is exactly the
// drift the dictate-don't-infer pattern exists to kill.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ORDERABLE_PRODUCTS } from "./search-policy.mjs";
import { envFrom } from "../shared/env-aliases.mjs";   // — a refusal names the name in force

// CLEAROTRON_CUSTOMERS_DIR selects the customer config STORE; the bundled driver/profiles is the
// fallback (and what the offline tests + the shipped demo roster use).
//
// 2026-07-19: this env var was already set in the deployment's .env and this module ignored it, so
// intake and the driver validated against DISJOINT rosters — intake resolved every customer against
// the CONFIG STORE, while this module fell through to the bundled demo roster, which shares not one
// key with it. A job naming a customer intake accepted therefore resolved to `generic` in the
// driver: a delivered run searched 3 house platforms instead of the client's, with NO self-exclusion
// seed and NO customer framework, and nothing said so.
// ── LAYERED SINCE, exactly like the doctrine overlay (driver.config.mjs resolveSkillPath) ──
//
// It used to be WHOLE-STORE REPLACEMENT: env value OR bundled, never both. So "bring your own
// customers" also meant "and copy the Generic default across, or the engine stops" — point
// CLEAROTRON_CUSTOMERS_DIR at your own folder and generic.json vanished, whose absence this module then
// refuses BY NAME two hundred lines below. The refusal was right; the requirement was an avoidable
// step nothing told you about in advance.
//
// Now the overlay wins PER KEY and the bundled set is the fallback, so an EMPTY overlay is a working
// install on Generic defaults rather than a refusal. Safe by construction: with an overlay that holds
// every key this changes nothing, and it changes nothing at all when the env var is unset.
//
// import.meta.url-relative — the driver runs under systemd with an unrelated cwd.
const PROFILES_BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "profiles");
const PROFILES_OVERLAY_DIR = envFrom(process.env, "CLEAROTRON_CUSTOMERS_DIR") ?? null;

// The ONE author of where profiles are WRITTEN. Exported for the write boundary, which must
// protect the store this module actually writes — a second reading of CLEAROTRON_CUSTOMERS_DIR elsewhere
// would be a boundary around a directory nobody uses, the failure that reports a pass.
//
// NARROWED WHAT THIS NAMES, deliberately. Under a layered store "where profiles live" is two
// directories and this value can only be one, so it is now the WRITABLE one — the overlay when set,
// the bundled set otherwise. Anything that needs "everywhere a profile can be READ from" must use
// profilesReadRoots below; taking this one for a read grant would hide the bundled fallback from the
// engine and reproduce the empty-store refusal this issue removed.
export const profilesStoreDir = PROFILES_OVERLAY_DIR ?? PROFILES_BASE_DIR;

/**
 * WHERE THIS PROCESS'S PROFILES ACTUALLY COME FROM, as a receipt.
 *
 * The doctrine tree has had one since — `skills-store`, which distinguishes `no-overlay` from
 * `checkout` and lands in every run's journal. The PROFILE half had no equivalent, and that is the gap
 * a whole day of rounds rode in on: the executing process held none of the store directories, every
 * customer silently resolved to the bundled demo roster, and the assert built to catch exactly that
 * reported `[ ok ]` on every round because it only checked the frozen framework was NON-EMPTY. A
 * bundled demo framework is non-empty.
 *
 * `situation`, mirroring the doctrine tree's vocabulary:
 *   overlay           CLEAROTRON_CUSTOMERS_DIR is set and in force — the live config store
 *   bundled-fallback  it is unset, so profiles come from the driver's own bundled demo roster. A
 *                     WORKING install on Generic defaults, and also what a misconfigured deployment looks
 *                     like. `outcome: pass`, because it is legitimate; the point is that it is SAID.
 *   env-arrived-late  set in the environment NOW but not when this module loaded, so it is NOT in
 *                     force. The resolution below reads a module-load snapshot, and this is the one
 *                     shape where the env and the behaviour disagree — a supervisor started before the
 *                     harness env was exported, which is the incident's own mechanism.
 *
 * ALWAYS A RECEIPT, NEVER A REFUSAL. An unreadable configured overlay already throws by name in
 * `loadProfiles`; this reports and never decides. Bookkeeping that can kill a run is worse than the
 * bookkeeping being absent.
 */
/**
 * How many records in force say they are demo data.
 *
 * The receipt already said WHICH STORE is resolving. That is not the same question as WHAT IS IN IT: a
 * deployment that meant to configure a store and did not gets `bundled-fallback`, and every customer
 * then resolves to invented companies — which is the shape of the delivered-wrong-run this file records
 * above. Counting the marked records is what turns "the fallback is in force" into "the fallback is in
 * force AND it is holding fiction".
 *
 * Best-effort by construction: this is a receipt, and a receipt that throws while explaining a
 * misconfiguration is worse than one that says it could not count.
 */
function demoRecordsInForce() {
  try {
    let n = 0;
    for (const p of loadProfiles({ force: true }).values()) if (p?.demoData === true) n++;
    return n;
  } catch { return null; }
}

export function profileStoreResolution(env = process.env) {
  const live = envFrom(env, "CLEAROTRON_CUSTOMERS_DIR") ?? null;
  const inForce = PROFILES_OVERLAY_DIR;
  const demoRecords = demoRecordsInForce();
  const base = { store: profilesStoreDir, readRoots: [...profilesReadRoots], configured: live, inForce,
    demoRecords, findings: [] };
  if (inForce) {
    return live && live !== inForce
      ? { ...base, situation: "overlay", outcome: "pass",
          findings: ["overlay_env_changed_since_load"],
          detail: `CLEAROTRON_CUSTOMERS_DIR now reads ${live} but ${inForce} is in force — this module captured it at load` }
      : { ...base, situation: "overlay", outcome: "pass", detail: `profiles resolve from the configured store ${inForce}` };
  }
  if (live) {
    return { ...base, situation: "env-arrived-late", outcome: "blocked",
      findings: ["overlay_set_after_module_load"],
      detail: `CLEAROTRON_CUSTOMERS_DIR is set to ${live} in this environment but was NOT set when profiles.mjs loaded, so it is not in force and every customer resolves to the bundled demo roster. Export it before the process starts` };
  }
  return { ...base, situation: "bundled-fallback", outcome: "pass",
    findings: demoRecords ? ["bundled_fallback_holds_demo_records"] : [],
    detail: `CLEAROTRON_CUSTOMERS_DIR is unset — profiles come from the driver's own bundled roster at ${PROFILES_BASE_DIR}`
      + (demoRecords ? `, and ${demoRecords} of those records are marked demo data, so any account resolving here is fiction and a real clearance under it is refused at the wall` : "")
      + `. Legitimate on a generic-defaults install; on a deployment that MEANT to configure a store, this line is the one that says it did not` };
}

/** Every directory a profile can be read from, overlay first, deduped — the read counterpart of
 *  profilesStoreDir, and the shape `skillsGrantRoots` already uses for the doctrine tree. */
export const profilesReadRoots = PROFILES_OVERLAY_DIR && PROFILES_OVERLAY_DIR !== PROFILES_BASE_DIR
  ? [PROFILES_OVERLAY_DIR, PROFILES_BASE_DIR]
  : [PROFILES_BASE_DIR];

// 98 = 14 variants × 7 cells — the SHIPPED measured-safe grid batch (the Ember Guard incident
// measured ~105 cells/call as the truncation ceiling; 14-variant batches are the proven budget
// under it). Deriving batch size from this constant reproduces today's ≤14 exactly for the 7-cell
// floor and scales it down for wider platform lists (a 10-platform profile at 14 variants would be
// 140+ cells — precisely the truncation mode that hard-failed the 224-cell call).
export const SAFE_GRID_CELLS = 98;

// A DENSE marketplace profile (long retail URLs + many listings per cell — e.g. beverages/supplements on
// Amazon/GNC/iHerb) makes each grid cell ~5-10x heavier in OUTPUT BYTES than a sparse gaming-store cell, so
// the cell-count budget above (calibrated on sparse stores) overflows the worker's output channel and the
// verbatim stdout transcription truncates mid-JSON (Zephyr KINETIC, 2026-06-14: ~21 dense cells ≈ 20KB cut
// the ledger unparseable). A dense profile gets a much smaller cell budget so each grid call's stdout stays
// well under that ceiling (a 7-platform dense profile ⇒ floor 8 ⇒ batchSize 2 ⇒ ≤16 cells/call). The
// gaming/Aurora budget is unchanged (default density = sparse).
export const DENSE_GRID_CELLS = 16;

// The two values a profile may hold, as a LIST rather than as a phrase repeated at each site.
//
// It is exported because the vocabulary escaped this file once and the escape was silent: both effort
// models were written against `"high"` — the word the staff editor SHOWED for `dense`, never a value any
// profile could carry — so marketplace density was inert in the quote path for as long as it existed
//. The validator below and the tests that check agreement across surfaces all read
// this list; nothing restates it.
export const MARKETPLACE_DENSITIES = Object.freeze(["sparse", "dense"]);

// Per-profile grid cell budget: the sparse budget by default; the much smaller dense budget for byte-heavy
// marketplaces. marketplaceDensity is an explicit profile knob (never inferred) so a future dense customer is
// sized correctly at onboarding, not after a truncation incident.
export function gridCellBudget(profile) {
  return profile?.marketplaceDensity === "dense" ? DENSE_GRID_CELLS : SAFE_GRID_CELLS;
}

// floor = store platforms + the general-web cell (the +1; perplexity-prompts.md: one unrestricted
// web search per variant, platform name "web").
export function derivedFloor(profile) {
  return (profile?.platforms?.length ?? 6) + 1;
}
export function derivedBatchSize(profile) {
  return Math.max(1, Math.floor(gridCellBudget(profile) / derivedFloor(profile)));
}

// The per-entry platform rules as DATA rather than as throws, so every door applies the identical checks
// and phrases the failure in its own register: a profile load DIES (a broken profile bricks every run
// under it), a job CLARIFIES (one request, answerable by asking). Same rules either way — a domain that is
// a foot-gun in a profile is the same foot-gun arriving on a job.
//
// SHAPE stays with the caller deliberately: a profile REQUIRES a non-empty platforms array, while a job's
// platforms are optional and additive. Only the per-entry vocabulary is shared.
export function platformEntryErrors(list, { label = "platforms" } = {}) {
  const errs = [];
  const seen = new Set();
  for (const x of list ?? []) {
    if (typeof x !== "string" || !x.trim()) {
      errs.push(`${label} entry ${JSON.stringify(x)} must be a non-empty store-domain string`);
      continue;
    }
    const d = x.trim().toLowerCase();
    if (d === "web") errs.push(`${label} must not list "web" — the general-web cell is implicit (always swept) and listing it inflates the floor past what any worker can satisfy`);
    else if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) || /\s/.test(d)) errs.push(`${label} entry "${x}" must be a bare store DOMAIN (the grid program domain-restricts to it)`);
    else if (seen.has(d)) errs.push(`${label} entry "${x}" is duplicated — duplicates inflate the floor`);
    seen.add(d);
  }
  return errs;
}

// A run's own platforms folded onto the effective profile. UNION, never replace: the account's
// marketplaces are a client MANDATE (a project overlay already treats them as a floor rather than a
// substitution), so a single request can widen the common-law grid and has no way to narrow it.
//
// Pure, and returns what it ADDED as well as the widened profile, because the caller needs both: the
// profile to freeze (derivedFloor/derivedBatchSize follow platforms, so the grid re-sizes itself) and the
// addition to record. Returns the SAME object when a job adds nothing, so a run without per-run platforms
// freezes byte- and sha-identically to one from before this existed.
export function withRunPlatforms(profile, jobPlatforms) {
  const norm = (x) => String(x).trim().toLowerCase();
  const run = Array.isArray(jobPlatforms) ? jobPlatforms.map(norm).filter(Boolean) : [];
  const have = new Set((profile?.platforms ?? []).map(norm));
  const added = [...new Set(run.filter((d) => !have.has(d)))];
  if (!added.length) return { profile, added };
  // copy — the resolved profile may be a cached object shared with the next run in this process
  return { profile: { ...profile, platforms: [...(profile?.platforms ?? []), ...added] }, added };
}

// F7 — the closed set of profile-file keys (deny-unknown-key). Every key here has a live consumer
// recorded in FIELD_CONSUMERS; an unknown key is a dead knob or a typo and hard-fails at load (the
// loader silently tolerated unknowns before). `minCellsPerVariant`/`batchSize` are intentionally
// absent — they are DERIVED and their presence is a separate, louder error below.
export const KNOWN_PROFILE_KEYS = [
  "name", "matchDomains", "industry", "platforms",
  "defaultClasses", "defaultJurisdictions", "selfExclusionOwners",
  "delivery", "riskAppetite", "marketplaceDensity",
  "frameworkPath", "workedExamplesPath",
  // WHICH OF THE FOUR runs for this account. defaultProduct picks the product when a request names
  // none; allowedRecipes (when present) is the closed menu of searches this account may trigger;
  // jxPolicy carries the native-language deepening posture (declared lanes / escalation / provider
  // stance — spec-B §12 policy, never capability).
  //
  // A PROFILE MAY LEAVE defaultProduct UNSET, and that is not a gap: a clearance that names no product
  // is named by its own resolved TERRITORIES (search-policy.mjs), which is exactly what an account with
  // default territories already means.
  "defaultProduct", "allowedRecipes", "jxPolicy",
  // Per-account ADMISSION CAPS — a client trigger + an unbounded
  // queue was a cost bomb the run-slot cap doesn't stop. Visible, git-tracked profile config (never a
  // hidden env var); enforced at the runner's admission chokepoint for BOTH doors (email + portal).
  "runCaps",
  // THIS RECORD IS FICTION. `demoData: true` marks a profile as demo data, and a
  // real clearance refuses to start under it — at the runner's admission wall, so no door can miss it.
  //
  // It marks PROVENANCE, NOT VISIBILITY. A demo account stays listable, readable and reportable; the
  // demo depends on it. What it stops is spending a client's money and a lawyer's trust on fiction.
  //
  // The failure it exists for is in this file's own record: a process holding none of the store
  // directories resolved every customer to the bundled roster, and a delivered run searched three house
  // platforms instead of the client's. The assert built to catch it PASSED — it checked only that the
  // frozen framework was non-empty, and a bundled demo framework is non-empty.
  "demoData",
];

// spec 62 — the customer→project split. A project is a SPARSE OVERLAY on its customer: it may re-state the
// operational knobs a distinct engagement legitimately runs differently (its own marketplaces, default
// classes/jurisdictions, sector, delivery, marketplace density, risk posture), but it can NEVER touch the
// customer's IDENTITY or RATING AUTHORITY. PROJECT_KEYS ∪ CUSTOMER_ONLY_KEYS === KNOWN_PROFILE_KEYS (8 + 9 =
// 17), asserted by a unit test, so every future profile field must consciously choose a level.
//   - name / matchDomains / selfExclusionOwners: identity + the self-exclusion seed — a project supplying `name`
//     would make applicantMatchesProfile match the applicant against the PROJECT's name, silently disabling the
//     customer's own-rights exclusion. Out of a project's reach by construction.
//   - frameworkPath / workedExamplesPath: the framework that RATES the matter (doc 50) — rating authority stays
//     whole-customer. (These are also CODE_OWNED_FIELDS in profile-service.mjs — customer-only is that same
//     discipline one level down.)
export const PROJECT_KEYS = [
  "platforms", "defaultClasses", "defaultJurisdictions",
  "marketplaceDensity", "delivery", "riskAppetite", "industry",
  // A project (engagement) may legitimately default to a different PRODUCT than its customer: a launch
  // screening project runs knockouts; the flagship clearance project runs a full search. A product
  // selects machinery, never rating authority — so it is overlayable.
  "defaultProduct",
];
export const CUSTOMER_ONLY_KEYS = [
  "name", "matchDomains", "selfExclusionOwners", "frameworkPath", "workedExamplesPath",
  // Entitlements + deepening posture stay whole-customer: a project must not widen what the account
  // may trigger (allowedRecipes) nor re-declare its jx deepening policy — both are the same
  // rating-authority-adjacent discipline as frameworkPath, one notch out.
  "allowedRecipes", "jxPolicy",
  // Admission caps bind the ACCOUNT: a project widening its own caps would hollow the customer's.
  "runCaps",
  // Provenance binds the ACCOUNT and cannot be overlaid in either direction: a project marking a real
  // customer's run as demo would refuse legitimate work, and a project un-marking a demo customer would
  // let fiction through the wall. Both directions are why this is customer-only.
  "demoData",
];

// F7 — no dead knobs: each profile field names the code that CONSUMES it (file + a specific symbol the
// grep test asserts is present in that file). Necessary-not-sufficient: this proves the
// field is read SOMEWHERE, never that it is read correctly — correctness is gated by the unit tests and
// the live eval, never by this manifest. Keep README's field table in lockstep with this map.
export const FIELD_CONSUMERS = {
  name:                 { file: "profiles.mjs",      symbol: "profile?.name" },            // applicantMatchesProfile
  matchDomains:         { file: "profiles.mjs",      symbol: "p.matchDomains" },           // resolveProfile + overlap guard
  industry:             { file: "stages.mjs",        symbol: "profile?.industry" },        // matter-frame sector context
  platforms:            { file: "stages.mjs",        symbol: "profile.platforms" },        // common-law grid dictation
  defaultClasses:       { file: "stages.mjs",        symbol: "profile.defaultClasses" },   // matter-frame default classes
  defaultJurisdictions: { file: "effective-scope.mjs", symbol: "profile.defaultJurisdictions" }, // matter-frame jurisdictions, via defaultJurisdictionsLine (2160)
  selfExclusionOwners:  { file: "pipeline.mjs",      symbol: "selfExclusionOwners" },      // applicant-gated exclusion seed
  delivery:             { file: "publish/index.mjs", symbol: "delivery" },                 // email table/summary + meta key
  riskAppetite:         { file: "stages.mjs",        symbol: "riskAppetite" },             // curation emphasis posture line
  marketplaceDensity:   { file: "profiles.mjs",      symbol: "marketplaceDensity" },      // gridCellBudget — per-profile grid batch budget
  frameworkPath:        { file: "framework.mjs",     symbol: "profile?.frameworkPath" },        // the framework in force (doc 50) — rates the matter
  workedExamplesPath:   { file: "framework.mjs",     symbol: "profile?.workedExamplesPath" },   // synthesis worked-examples depth-target selection
  defaultProduct:       { file: "search-policy.mjs", symbol: "defaultProduct" },                // product resolution (job → project → customer → the scope)
  allowedRecipes:       { file: "search-policy.mjs", symbol: "allowedRecipes" },                // entitlement gate on the resolved search selection
  jxPolicy:             { file: "pipeline.mjs",      symbol: "jxPolicy" },                      // frozen into the run sidecar for the Stage-1.5 lanes (resume-safe)
  demoData:             { file: "runner.mjs",        symbol: "demoData" },                      // the admission wall refuses a real clearance on demo data
  runCaps:              { file: "runner.mjs",        symbol: "runCaps" },                       // admission caps at claimAndPrep (queued + monthly, both doors)
};

// Per-customer reasoning-skill selection. frameworkPath is the customer's OWN risk framework — under doc 50
// it RATES the matter; absent ⇒ the Generic default rates it (DEFAULT_FRAMEWORK in framework.mjs). Constrained to
// the prelim-search skill dir + a .md suffix so a profile cannot point the synthesis read at an arbitrary
// path. The SHARED doctrine lives identically across the per-customer frameworks; only the examples diverge.
const SKILL_PATH_RE = /^skills\/prelim-search\/[A-Za-z0-9._-]+\.md$/;

// The delivery overlay every run gets. `email` is no longer a choice: every run's mail is a COVER NOTE
// pointing at the report (one report, one shape, per-lawyer client mail drafted by the assistant).
// `privileged` still varies by customer.
//
// — IT IS SILENT ON `privileged`, AND THE SILENCE IS THE POINT. The field is three-state on every
// surface that reads it: true is an extended marking ("Attorney Work Product"), FALSE IS A DELIBERATE
// OFF, and absent is no opinion — which gets the plain "Privileged & Confidential" every legal
// deliverable carries by default. This overlay is what an UNBOUND run and a customer who said nothing
// both fall to, and neither of them has instructed us to strip a confidentiality marking. Saying `false`
// here read as that instruction, which is why a House-default clearance shipped with no line at all.
export const NEUTRAL_DELIVERY = { email: "summary" };

/**
 * The delivery shape this run's email takes: the customer's profile preference, verbatim.
 *
 * The saved search's `extras.emailTable` USED to fold `email:"table"` on top here, and a profile could
 * ask for it directly. Both are retired. The table overlay inlined a second full rendering of the
 * findings into the mail body — for the knockout lane it inlined the INTERNAL variant, putting purple
 * staff notes and the model's register estimate on the wire — and no lint read that surface. It is
 * deleted rather than repaired: a customer who wants their own house format gets it drafted from the
 * run's report-data.json, where a person can see what is being said before it goes.
 *
 * `email:"table"` and `extras.emailTable` remain ACCEPTED at load so archived profiles and saved
 * searches keep validating (a stored recipe must not brick on a shape change it never asked for) — they
 * simply no longer decide anything. `normalizeDelivery` folds the retired word back to "summary" here,
 * at the single point every caller reads, so no downstream branch can resurrect it.
 */
export function deliveryForRun(ctx) {
  return normalizeDelivery(ctx?.profile?.delivery ?? NEUTRAL_DELIVERY);
}

// The retired-word fold, in one place. A profile still carrying `email:"table"` gets the cover note.
export function normalizeDelivery(d) {
  const base = d ?? NEUTRAL_DELIVERY;
  const email = base.email === "table" ? "summary" : base.email;
  // — `privileged: true` is RETIRED and folds to absent, the same move as the `email` line above
  // and for the same reason: the value no longer decides anything. It used to select an extended
  // marking ("· Attorney Work Product"); that suffix is gone, so true and absent render identically and
  // a stored true would claim a distinction the output cannot carry. FALSE IS NOT FOLDED — it is a
  // customer instructing us to strip the confidentiality line, which is still a real instruction and
  // still the only one this field can give.
  const drop = base.privileged === true;
  if (email === base.email && !drop) return base;
  const out = { ...base, email };
  if (drop) delete out.privileged;
  return out;
}


// delivery.template (Phase 1): a NAMED deliverable-template variant, validated against this closed registry.
// One variant exists today — "standard" (the current code-composed report); a profile that omits it gets the
// default. The registry is the un-park point: when a real second format is defined, add its name here AND a
// render branch + meta stamp keyed off it (the publish path already records the chosen name in meta.json, so
// the field is a live consumer, not a dead knob). Keeping it a closed enum means a typo'd template name
// hard-fails at load rather than silently rendering the default.
export const DEFAULT_DELIVERY_TEMPLATE = "standard";
export const KNOWN_DELIVERY_TEMPLATES = [DEFAULT_DELIVERY_TEMPLATE];

// F8 — risk appetite is PROSE-POSTURE context that flavours emphasis, never a rule that decides the
// legal rating (settled decision D1; the "never decides" invariance itself is gated by review, not by
// this regex). These patterns reject the numeric/threshold SHAPE of a rule masquerading as appetite
// prose, at load. Conservative-reject + necessary-not-sufficient: they catch the obvious
// numeric forms; a rule phrased in pure prose is a staff lawyer's catch, never this. Reasoning-not-rules: no
// new numeric threshold enters the engine through a profile.
export const APPETITE_THRESHOLD_PATTERNS = [
  [/\d\s*%/, "a percentage"],
  [/[<>≥≤]=?\s*\d|[≥≤]/, "a numeric comparison operator"],
  [/\b(?:above|below|over|under|exceed(?:s|ing)?|at least|at most|more than|less than|greater than|fewer than|no more than|up to)\s+\d/i, "a worded numeric comparison"],
  [/\bthreshold\b/i, 'the word "threshold"'],
  [/\b(?:level|composite)\b[^.]{0,24}?(?:\bor\s+(?:above|higher|worse|more)\b|\+)/i, 'a Level/Composite cutoff ("or above" / "+")'],
  [/\b(?:above|below|over|under|at or above)\s+(?:a\s+)?(?:level|composite)\s*[a-e0-9]/i, 'a Level/Composite cutoff ("above Level C")'],
  [/\b(?:level|composite)\s*[<>≥≤]=?\s*[a-e0-9]/i, "a Level/Composite comparison"],
];

// Throws (offending-pattern-first) when appetite prose carries a numeric-threshold shape.
export function assertAppetitePosture(text, where = "riskAppetite") {
  const s = String(text ?? "");
  for (const [re, why] of APPETITE_THRESHOLD_PATTERNS) {
    const m = s.match(re);
    if (m) throw new Error(`${where}: appetite must be PROSE-POSTURE, not a numeric threshold — found ${why} ("${m[0].trim()}"). Risk appetite flavours emphasis and recommended follow-up; it never decides the rating (D1).`);
  }
}

// ── Context pack (Phase 1, plan §A) — the per-customer "background facts" home ────────────────────────
// A prose document of who the customer is, the concerns/key factors they always care about, marketplace
// priorities, and CURATED prior-matter learnings. Stored as a sibling file `profiles/<key>.context.md`
// (NOT a JSON key — so it is intentionally absent from KNOWN_PROFILE_KEYS / FIELD_CONSUMERS, which govern
// the JSON shape; its consumer is asserted by its own test). Loaded + validated at load time, attached to
// the profile object AFTER validateProfileShape (so the deny-unknown-key gate never sees it), and frozen
// into the run sidecar like delivery/riskAppetite. Fed to the reasoning AS CONTEXT, never as a rule (D1):
// it sharpens which questions to ask and what to surface; it NEVER decides a Level or Composite.
export const CONTEXT_PACK_FILE = (key) => `${key}.context.md`;

// F5 density: the pack is CURATED, not append-only — a large pack dilutes high-value priors (and eats the
// attention budget). Cap it at load with a loud error so it stays dense, mirroring the derived-value guards.
export const CONTEXT_PACK_MAX_CHARS = 8000;

// D1 anti-rule guard for the pack, analogous to assertAppetitePosture but broader: the pack is the one new
// free-text channel feeding the reasoning, so it must not smuggle a decision RULE in as prose. Reuse the F8
// numeric/threshold patterns AND reject imperative rating shapes ("rate X as High", "always block …",
// "if … then Composite …"). Conservative-reject + necessary-not-sufficient: the genuine
// catch for a pure-prose rule is a staff lawyer; this catches the obvious rule SHAPE at authoring time.
// The fix for a rejection is always to rephrase the rule as a CONCERN or a QUESTION (the D1 discipline).
export const CONTEXT_PACK_RULE_PATTERNS = [
  [/\b(?:rate|treat|classify|score|grade|mark|set|assign|cap|floor)\b[^.]{0,40}?\b(?:as|to|at)\b[^.]{0,24}?\b(?:level|composite|high|very high|medium|low|manageable|risk)\b/i, "an imperative rating rule (\"rate … as …\")"],
  [/\b(?:always|never|automatically|by default)\b[^.]{0,30}?\b(?:block|clear|flag|reject|accept|rate|treat|escalat|approv|pass|fail)\w*/i, "an absolute decision rule (\"always/never …\")"],
  [/\bif\b[^.]{0,70}?\bthen\b[^.]{0,40}?\b(?:level|composite|rate|risk|block|clear|reject|accept|high|low|medium)\b/i, "a conditional decision rule (\"if … then …\")"],
];

// Throws (offending-pattern-first / over-budget) when a context pack carries a decision-rule shape or is
// too large. The pack is context-not-rules (D1); size stays bounded for signal density (F5).
// The D1 prose treatment for RECIPE free text (label/notes/standingInstructions): the same anti-rule
// + threshold-language guards the profile prose fields get. Lives HERE (single home beside its two
// components) so every loadRecipes door and the recipe service wire the identical guard.
export function recipeProseGuard(text, where) {
  assertContextPackShape(text, where);
  assertAppetitePosture(text, where);
}

export function assertContextPackShape(text, where = "context pack") {
  const s = String(text ?? "");
  if (s.length > CONTEXT_PACK_MAX_CHARS)
    throw new Error(`${where}: ${s.length} chars exceeds the ${CONTEXT_PACK_MAX_CHARS}-char budget — the pack must stay DENSE (curate / decay old learnings; a big pack dilutes the priors that matter).`);
  for (const [re, why] of [...APPETITE_THRESHOLD_PATTERNS, ...CONTEXT_PACK_RULE_PATTERNS]) {
    const m = s.match(re);
    if (m) throw new Error(`${where}: must be CONTEXT (background facts, concerns, questions), not a decision rule — found ${why} ("${m[0].trim()}"). Per-customer context feeds the reasoning better questions; it never decides a Level/Composite (D1). Rephrase the rule as a concern or a question.`);
  }
}

// `sparse` (spec 62): validate a PROJECT OVERLAY rather than a whole customer profile. Under sparse, every
// PROJECT_KEY becomes OPTIONAL (a project states only its deltas) but keeps EVERY guard when present; the
// customer-only knobs are REJECTED (a project may not touch identity/rating authority — the F7 discipline one
// level down); and `projectName` (the overlay's own display name) and `archived` (the retire flag) are the two
// extra allowed keys. Both are overlay META — lifted out before the merge like contextPack, so neither is a
// PROJECT_KEY and neither can ever reach the effective profile. Non-sparse is byte-for-byte the pre-62 behaviour.
function validateProfileShape(key, p, { sparse = false } = {}) {
  const die = (why) => { throw new Error(`profiles/${key}.json: ${why}`); };
  if (!p || typeof p !== "object" || Array.isArray(p)) die("must be a JSON object");
  // F7 deny-unknown-key: an unrecognised key is a dead knob or a typo (silently tolerated before).
  // minCellsPerVariant/batchSize are skipped here so they keep their louder DERIVED-specific error below.
  for (const k of Object.keys(p)) {
    if (k === "minCellsPerVariant" || k === "batchSize") continue;
    if (sparse && (k === "projectName" || k === "archived")) continue;   // overlay-only META, validated below (not profile fields)
    if (sparse && CUSTOMER_ONLY_KEYS.includes(k))
      die(`"${k}" is customer-only — a project overlay may not set it; identity and rating authority stay whole-customer (the same discipline as CODE_OWNED_FIELDS, one level down)`);
    if (!KNOWN_PROFILE_KEYS.includes(k)) die(`unknown key "${k}" — every profile key must have a live consumer (see FIELD_CONSUMERS); a dead knob or typo is rejected at load`);
  }
  if (sparse) {
    // the overlay's own human name (default = slug, applied by loadProjects when omitted); never inherited.
    if (p.projectName != null && (typeof p.projectName !== "string" || !p.projectName.trim()))
      die("projectName must be a non-empty string when present");
    // Retiring a project is a SAVE WITH A FLAG, never a delete — the saved-search design statement
    // (recipe-service.mjs) applied one level up, so the product carries ONE archive concept and not two
    // dialects. Same boolean guard as search-policy.mjs's RECIPE_KEYS check.
    //
    // PRESENT-AND-NOT-A-BOOLEAN is the test, not `!= null`. The looser form let `archived: null` through:
    // the stickiness guard only re-applies the flag when the key is `undefined`, and the loader only lifts
    // `=== true`, so a null slipped past both and silently UN-ARCHIVED the project — defeating the rule
    // that only an explicit `false` may do that. An ambiguous value is refused rather than guessed at.
    if ("archived" in p && typeof p.archived !== "boolean") die("archived must be a boolean");
  } else {
    if (typeof p.name !== "string" || !p.name.trim()) die("name (string) is required");
  }
  // platforms is REQUIRED on a whole profile but OPTIONAL on an overlay; the foot-gun guards below run whenever
  // it is present (a project that re-states its marketplaces must state them just as carefully).
  if (!sparse || p.platforms != null) {
    if (!Array.isArray(p.platforms) || !p.platforms.length || !p.platforms.every((x) => typeof x === "string" && x.trim()))
      die("platforms must be a non-empty array of store-domain strings");
    // a one-character authoring slip here bricks every run under the profile (the floor counts entries
    // verbatim while the grid dedupes) — reject the known foot-guns at load time. Shared with the job
    // doors via platformEntryErrors so a domain rule can never drift between where it is stored and
    // where it is requested.
    const platformErrs = platformEntryErrors(p.platforms);
    if (platformErrs.length) die(platformErrs[0]);
  }
  for (const k of ["matchDomains", "defaultClasses", "defaultJurisdictions", "selfExclusionOwners"]) {
    if (p[k] != null && !Array.isArray(p[k])) die(`${k} must be an array when present`);
  }
  if ("minCellsPerVariant" in p || "batchSize" in p)
    die("minCellsPerVariant/batchSize are DERIVED from platforms — never stored (single source of truth)");
  // delivery overlay (optional; absent ⇒ NEUTRAL_DELIVERY): email family + privileged-header flag + an
  // optional prose-style directive (Phase 1) that tunes the CURATION wording (report-overview/-card/
  // client-summary). style is PRESENTATION only: it shapes tone/phrasing, never the rating — so it carries
  // the same anti-rule guard as riskAppetite (a "style" must not smuggle in a decision rule).
  if (p.delivery != null) {
    const d = p.delivery;
    if (typeof d !== "object" || Array.isArray(d)) die("delivery must be an object { email, privileged, style }");
    for (const dk of Object.keys(d)) if (!["email", "privileged", "style", "template"].includes(dk)) die(`delivery.${dk} is not a known delivery key (email | privileged | style | template)`);
    // "table" is RETIRED but still accepted: an archived profile must not brick on a shape change it
    // never asked for. It is folded to "summary" by normalizeDelivery — accepted, inert, not obeyed.
    if (d.email != null && !["table", "summary"].includes(d.email)) die(`delivery.email must be "summary" (got "${d.email}"; "table" is retired and reads as "summary")`);
    if (d.privileged != null && typeof d.privileged !== "boolean") die("delivery.privileged must be a boolean");
    if (d.style != null) {
      if (typeof d.style !== "string" || !d.style.trim()) die("delivery.style must be a non-empty prose string when present");
      assertContextPackShape(d.style, `profiles/${key}.json delivery.style`);
    }
    if (d.template != null && !KNOWN_DELIVERY_TEMPLATES.includes(d.template))
      die(`delivery.template "${d.template}" is not a known template — one of: ${KNOWN_DELIVERY_TEMPLATES.join(", ")} (absent ⇒ the default "${DEFAULT_DELIVERY_TEMPLATE}")`);
  }
  // riskAppetite (optional, F8): prose-posture only — the anti-threshold guard rejects rule-shaped text.
  if (p.riskAppetite != null) {
    if (typeof p.riskAppetite !== "string" || !p.riskAppetite.trim()) die("riskAppetite must be a non-empty prose string when present");
    assertAppetitePosture(p.riskAppetite, `profiles/${key}.json riskAppetite`);
  }
  // demoData (optional): TRUE or absent, and nothing else. `false` is refused rather than tolerated —
  // a profile that says "I am not demo data" out loud is a profile somebody edited to say it, and the
  // absence is what every real record already carries. One spelling, so a grep for the marker is
  // complete and a reader never wonders whether `false` means unmarked or un-marked-on-purpose.
  if (p.demoData !== undefined && p.demoData !== true)
    die(`demoData must be true when present (got ${JSON.stringify(p.demoData)}) — omit the key for a real account`);
  // marketplaceDensity (optional): "sparse" (default) | "dense". Dense ⇒ a smaller grid cell budget so a
  // byte-heavy marketplace's verbatim stdout transcription fits the worker output channel (gridCellBudget).
  if (p.marketplaceDensity != null && !MARKETPLACE_DENSITIES.includes(p.marketplaceDensity))
    die(`marketplaceDensity must be ${MARKETPLACE_DENSITIES.map((v) => `"${v}"`).join(" or ")} `
      + `(got "${p.marketplaceDensity}")`);
  // frameworkPath / workedExamplesPath (optional, Phase 2): a per-customer reasoning-skill file. Constrained
  // to skills/prelim-search/*.md (no path escape) — a profile selects a SHIPPED skill, never an arbitrary path.
  for (const k of ["frameworkPath", "workedExamplesPath"]) {
    if (p[k] == null) continue;
    if (typeof p[k] !== "string" || !SKILL_PATH_RE.test(p[k]) || p[k].includes(".."))
      die(`${k} must be a path of the form "skills/prelim-search/<file>.md" (got ${JSON.stringify(p[k])})`);
  }
  // defaultProduct (optional): one of the four in the offering, by id. A typo hard-fails at load rather
  // than silently running the wrong-priced product on every job.
  if (p.defaultProduct != null && !ORDERABLE_PRODUCTS.includes(p.defaultProduct))
    die(`defaultProduct "${p.defaultProduct}" names no search we offer — one of: ${ORDERABLE_PRODUCTS.join(", ")}`);
  // allowedRecipes (optional, customer-only): the closed menu of searches this account may trigger —
  // product ids and/or saved-recipe slugs. Slug-shaped entries only; existence against the recipe store is
  // checked at resolution (a recipe can be created after the profile), but a malformed entry is a typo.
  if (p.allowedRecipes != null) {
    if (!Array.isArray(p.allowedRecipes) || !p.allowedRecipes.length) die("allowedRecipes must be a non-empty array when present (absent ⇒ everything allowed)");
    for (const e of p.allowedRecipes) {
      if (typeof e !== "string" || !/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/.test(e))
        die(`allowedRecipes entry ${JSON.stringify(e)} must be a level key or recipe slug (lowercase [a-z0-9-], optionally "customer/slug")`);
    }
  }
  // jxPolicy (optional, customer-only): the Stage-1.5 deepening POSTURE — which lanes are declared on, the
  // escalation stance, the provider stance. Policy selects among BUILT lanes (spec-B §12); it can never
  // define one, so the key set and every enum here is closed.
  if (p.jxPolicy != null) {
    const jx = p.jxPolicy;
    if (typeof jx !== "object" || Array.isArray(jx)) die("jxPolicy must be an object { laneDepth, escalationPolicy, providerStance }");
    else {
      for (const jk of Object.keys(jx)) if (!["laneDepth", "escalationPolicy", "providerStance"].includes(jk)) die(`jxPolicy.${jk} is not a known jxPolicy key (laneDepth | escalationPolicy | providerStance)`);
      if (jx.laneDepth != null) {
        if (typeof jx.laneDepth !== "object" || Array.isArray(jx.laneDepth)) die("jxPolicy.laneDepth must be an object of {lane: \"off\" | \"candidates\" | \"full\"}");
        else for (const [lane, depth] of Object.entries(jx.laneDepth)) {
          if (!/^[a-z]{2}$/.test(lane)) die(`jxPolicy.laneDepth lane "${lane}" must be a 2-letter lane code (e.g. "zh")`);
          if (!["off", "candidates", "full"].includes(depth)) die(`jxPolicy.laneDepth.${lane} must be "off" | "candidates" | "full" (got ${JSON.stringify(depth)})`);
        }
      }
      if (jx.escalationPolicy != null) {
        if (typeof jx.escalationPolicy !== "string" || !jx.escalationPolicy.trim()) die("jxPolicy.escalationPolicy must be a non-empty prose string when present");
        else assertContextPackShape(jx.escalationPolicy, `profiles/${key}.json jxPolicy.escalationPolicy`);
      }
      if (jx.providerStance != null && !["default", "azure-only"].includes(jx.providerStance))
        die(`jxPolicy.providerStance must be "default" or "azure-only" (got ${JSON.stringify(jx.providerStance)})`);
    }
  }
  // runCaps (optional, customer-only, Phase 3b): per-account ADMISSION caps, enforced at the runner's
  // claimAndPrep for every intake door. Closed key set; plain positive integers (numeric limits are
  // fine here — the anti-threshold prose guards bind prose fields, not operational caps).
  if (p.runCaps != null) {
    const rc = p.runCaps;
    if (typeof rc !== "object" || Array.isArray(rc)) die("runCaps must be an object { maxQueued?, dailyRuns?, monthlyRuns? }");
    else {
      for (const rk of Object.keys(rc)) if (!["maxQueued", "dailyRuns", "monthlyRuns"].includes(rk)) die(`runCaps.${rk} is not a known cap (maxQueued | dailyRuns | monthlyRuns)`);
      for (const rk of ["maxQueued", "dailyRuns", "monthlyRuns"]) {
        if (rc[rk] != null && (!Number.isInteger(rc[rk]) || rc[rk] < 1 || rc[rk] > 10000))
          die(`runCaps.${rk} must be an integer 1–10000 (got ${JSON.stringify(rc[rk])})`);
      }
      if (rc.maxQueued == null && rc.dailyRuns == null && rc.monthlyRuns == null) die("runCaps must set at least one cap when present");
    }
  }
}

// A new profile key must be a safe slug — it becomes a filename (profiles/<key>.json + <key>.context.md) and
// the resolve/index/sidecar key. Lowercase letters/digits/hyphen only; never "generic" via the create path
// (that fallback is reserved) and never path-traversal.
const PROFILE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
export function assertProfileKey(key) {
  const k = String(key ?? "");
  if (!PROFILE_KEY_RE.test(k)) throw new Error(`profile key "${k}" must be a lowercase slug [a-z0-9-], 2–39 chars (it becomes a filename + the resolve key)`);
}

/** Public validation for the config-edit UI (plan §E): validate a profile OBJECT (not a file) plus its
 *  optional context-pack prose, COLLECTING errors instead of throwing on the first. The service calls this
 *  server-side before any write — it never trusts the client. Reuses the exact load-time guards
 *  (validateProfileShape incl. F7 deny-unknown-key + the F8 appetite guard + delivery/template/style checks,
 *  and assertContextPackShape) so the UI can never persist a profile the driver would later reject. */
export function validateProfileEdit(key, profileObj, contextPack = "", { sparse = false } = {}) {
  const errors = [];
  try { validateProfileShape(String(key), profileObj, { sparse }); } catch (e) { errors.push(String(e.message)); }
  if (contextPack && String(contextPack).trim()) {
    try { assertContextPackShape(String(contextPack), "context pack"); } catch (e) { errors.push(String(e.message)); }
  }
  return { ok: errors.length === 0, errors };
}

let cache = null;

/** Read one directory of profiles/<key>.json → Map(key → profile). No generic requirement and no
 *  matchDomains check here: both are properties of the MERGED roster, not of one layer, and asserting
 *  them per-layer would refuse a base+overlay pair that is perfectly valid once combined. */
function readProfilesLayer(dir) {
  const profiles = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const key = f.replace(/\.json$/, "");
    let p;
    try { p = JSON.parse(readFileSync(join(dir, f), "utf8")); }
    catch (e) { throw new Error(`profiles/${f}: unparseable JSON (${e.message})`); }
    validateProfileShape(key, p);
    // Context pack (Phase 1): a sibling `<key>.context.md`, attached AFTER validateProfileShape so the
    // deny-unknown-key gate (which governs the JSON shape) never sees it. Optional — absent ⇒ no pack.
    // Validated at load (rule-shape + size budget) so a bad pack fails loudly here, like riskAppetite (F8).
    const packPath = join(dir, CONTEXT_PACK_FILE(key));
    const contextPack = existsSync(packPath) ? readFileSync(packPath, "utf8").trim() : "";
    if (contextPack) assertContextPackShape(contextPack, `profiles/${CONTEXT_PACK_FILE(key)}`);
    profiles.set(key, { key, ...p, ...(contextPack ? { contextPack } : {}) });
  }
  return profiles;
}

/** Load every profiles/<key>.json → Map(key → profile), OVERLAY OVER BASE. Hard-fails loudly
 *  on a generic.json missing from BOTH layers (the universal fallback — its absence would mis-profile
 *  EVERY job), on a configured-but-unreadable overlay, and on any matchDomains overlap in the merged
 *  roster (readdir order must never decide a customer). Cached per resolved layer pair.
 *
 *  `dir` names the OVERLAY, not the whole store: passing it keeps the bundled set underneath, which is
 *  what makes an empty store a working install. Pass `dir: null` for the bundled set alone. */
export function loadProfiles({ dir, force = false } = {}) {
  // — LAYERING APPLIES ONLY TO THE ENV-RESOLVED STORE, and that boundary is deliberate.
  //
  // `dir` OMITTED => resolve the deployment's store, overlay over base. `dir` PASSED => that directory
  // alone, exactly as before this change. Distinguished on `undefined`, not on falsiness, so an explicit
  // `dir: null` still means "the bundled set alone" and never falls back to the env var.
  //
  // Every explicit caller already knows which directory it means: profile-service.mjs's write-path
  // sites, and the fixtures that build a roster and assert on precisely that roster. Layering those
  // would have widened the contract of three separate set-level guards — the missing-generic guard is
  // asserted in profiles.test.mjs AND profile-service.test.mjs — so that none of them still tested what
  // its name claims, while all of them stayed green.
  const explicit = dir !== undefined;
  const overlay = explicit ? null : PROFILES_OVERLAY_DIR;
  const baseDir = explicit ? (dir || PROFILES_BASE_DIR) : PROFILES_BASE_DIR;
  const cacheKey = `${overlay ?? ""} :: ${baseDir}`;
  if (cache && !force && cache.key === cacheKey) return cache.profiles;

  // FAIL LOUD ON AN UNREADABLE OVERLAY, the same ruling as the doctrine tree's. existsSync() answers
  // false for a permission error exactly as it does for a missing directory, so a config store this
  // process cannot read would silently resolve EVERY customer to the bundled demo roster — swapping a
  // client's platforms, self-exclusion seed and risk framework for Generic defaults with nothing in the
  // log. That is the 2026-07-19 delivered-wrong-run defect arriving by a new road. A
  // configured-but-unreadable store is a deploy fault, not a fallback.
  if (overlay && !existsSync(overlay))
    throw new Error(`profiles_overlay_unreadable:${overlay} (CLEAROTRON_CUSTOMERS_DIR is set but the process cannot see it — every customer would silently fall back to the bundled demo roster)`);

  // THE FALLBACK IS `generic` ALONE, NOT THE WHOLE BUNDLED SET — refuted by two shipped guards, not
  // chosen. driver/test/pool-admin-reassign.test.mjs asserts "with CLEAROTRON_CUSTOMERS_DIR unset it REFUSES
  // rather than validating against the demo roster", and mcp-server's roster boot check counts the
  // configured roster exactly. Layering the whole bundled set underneath a configured store would put
  // aurora/petcary/zephyr into every deployment's roster: a typo'd customer key would be checked
  // against demo fixtures, and a boot check that says "N customers" would count ours among theirs.
  //
  // `generic` is different in kind from the rest of that directory. It is not a demo customer — it is
  // the universal fallback the module REQUIRES by name, the thing every unprofiled job resolves to. That
  // is the one file whose absence makes an empty store a refusal, so that is the only one that falls
  // through. Everything else in a deployment's roster is the deployment's own.
  const profiles = overlay ? readProfilesLayer(overlay) : readProfilesLayer(baseDir);
  if (overlay && !profiles.has("generic")) {
    const base = readProfilesLayer(baseDir);
    if (base.has("generic")) profiles.set("generic", base.get("generic"));
  }

  if (!profiles.has("generic"))
    throw new Error(`profiles/generic.json is REQUIRED (the universal fallback) — found: ${[...profiles.keys()].join(", ") || "none"} in ${[overlay, baseDir].filter(Boolean).join(" over ")}`);
  const claimed = new Map();
  for (const [key, p] of profiles) {
    for (const d of p.matchDomains ?? []) {
      const dl = String(d).toLowerCase();
      if (claimed.has(dl)) throw new Error(`profiles: matchDomains overlap — "${dl}" claimed by both ${claimed.get(dl)} and ${key}`);
      claimed.set(dl, key);
    }
  }
  cache = { key: cacheKey, profiles };
  return profiles;
}

/** Customer→profile resolution. The INTAKE AI (email-loop) resolves WHO the customer is — robust to
 *  misspellings, implicit references, or an explicitly named customer — and stamps the resolved
 *  `job.profileKey`. That judgment wins here, validated against the real roster: this code is the
 *  deterministic floor UNDER the intelligence, never a heuristic that re-guesses it. A forwarder-domain
 *  match is only a fallback HINT when intake left no key; the free-text applicant (`job.customer`) never
 *  selects a profile (a third-party search must never inherit a customer's exclusions). An unknown key ⇒
 *  generic — intake's validateJob hard-clarifies a bad/typo key before any run, so this graceful fallback
 *  only fires on the deleted-profile-mid-flight edge, where generic is the safe default. */
export function resolveProfile(job, { profiles = loadProfiles() } = {}) {
  const key = String(job?.profileKey ?? "").trim();
  if (key && profiles.has(key)) return profiles.get(key);
  // A NAMED-but-unknown key is not a graceful-degradation case, it is a roster mismatch — the two
  // sides disagree about which config store is real, and falling back to `generic` silently strips
  // the client's platforms, their self-exclusion seed and the framework that RATES the matter. That
  // is a wrong deliverable, not a degraded one, and it is exactly what happened on 2026-07-18. Fail
  // loudly: a run that cannot find the customer it was told to use must not invent a different one.
  if (key) {
    const err = new Error(`profile_key_unknown:${key} — the roster is [${[...profiles.keys()].join(", ")}]. `
      + `Refusing to silently fall back to "generic": that would drop the customer's platforms, self-exclusion seed `
      + `and risk framework. Check CLEAROTRON_CUSTOMERS_DIR points at the intended config store.`);
    err.code = "profile_key_unknown";
    throw err;
  }
  const dom = String(job?.forwarderDomain ?? "").toLowerCase();
  for (const [k, p] of profiles) {
    if (k === "generic") continue;
    for (const d of p.matchDomains ?? []) {
      const dl = String(d).toLowerCase();
      if (dom === dl || dom.endsWith(`.${dl}`)) return p;
    }
  }
  return profiles.get("generic");
}

// spec 62 — project overlays live in a `projects/<customer>/` subdirectory that loadProfiles' `.json` glob
// already skips (a directory does not end in ".json"), so the customer loader, its cache and its matchDomains
// overlap guard need no change. Cached separately from the customer roster.
const PROJECTS_SUBDIR = "projects";
let projectCache = null;

/** Load every profiles/projects/<customer>/<slug>.json → Map("<customer>/<slug>" → overlay). Each overlay is
 *  validated in SPARSE mode (PROJECT_KEYS optional, customer-only keys rejected) and carries its lifted-out
 *  `projectName` (default = slug) + optional sibling `<slug>.context.md`. A project directory under an unknown
 *  customer hard-fails (an overlay with no customer to overlay is an authoring error). Absent projects/ dir ⇒
 *  empty map (no migration; existing installs are untouched). */
export function loadProjects({ dir, profiles, force = false } = {}) {
  //: LAYERED THE SAME WAY AS THE CUSTOMER ROSTER, and that is a call this issue did not settle.
  // Overlaying customers but not their projects would leave a split-brain store — a customer resolved
  // from the overlay whose project overlays still came from the bundled demo tree. The plain reading of
  // "the config store is overlaid" is that everything IN it is, so projects follow. Base first, overlay
  // last, so a project key present in both resolves to the deployment's own.
  // — same boundary as loadProfiles: layered only when the store is resolved from the env.
  // An explicit `dir` is one tree, so profile-service.mjs's project reads and the fixtures that build a
  // projects/ tree keep asserting on exactly the tree they built. It also keeps the "a project under an
  // unknown customer hard-fails" check running against the same roster it always did — merged rosters
  // would have let a project under a BUNDLED customer key validate where it used to throw.
  const explicit = dir !== undefined;
  const overlay = explicit ? null : PROFILES_OVERLAY_DIR;
  const baseDir = explicit ? (dir || PROFILES_BASE_DIR) : PROFILES_BASE_DIR;
  // — THE OVERLAY REPLACES THE PROJECT TREE, it does not stack on it, and this must match what
  // loadProfiles does or the two disagree about which customers exist. loadProfiles falls back to
  // `generic` ALONE, so a configured roster holds the deployment's own customers and nothing of ours.
  // Reading OUR projects/ underneath it would then hand this loop project directories named for
  // bundled customers that are no longer in the roster — and the "a project must live under a known
  // customer" check throws for every one of them. Same store, same rule: configured wins outright.
  const roots = overlay ? [overlay] : [baseDir];
  const cacheKey = roots.join(" ");
  if (projectCache && !force && projectCache.key === cacheKey) return projectCache.projects;
  const projects = new Map();
  const roster = profiles ?? loadProfiles({ dir, force });
  for (const root of roots) {
  const projDir = join(root, PROJECTS_SUBDIR);
  if (!existsSync(projDir)) continue;
  for (const ent of readdirSync(projDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;   // only <customer>/ subdirs participate; a stray file is ignored
    const ck = ent.name;
    if (!roster.has(ck))
      throw new Error(`profiles/projects/${ck}/: no customer profile "${ck}" — a project must live under a known customer (add profiles/${ck}.json first)`);
    const cdir = join(projDir, ck);
    for (const f of readdirSync(cdir).filter((n) => n.endsWith(".json")).sort()) {
      const slug = f.replace(/\.json$/, "");
      assertProfileKey(slug);
      const rel = `projects/${ck}/${slug}`;   // becomes the validator's error prefix + the fully-qualified key
      let o;
      try { o = JSON.parse(readFileSync(join(cdir, f), "utf8")); }
      catch (e) { throw new Error(`profiles/${rel}.json: unparseable JSON (${e.message})`); }
      validateProfileShape(rel, o, { sparse: true });
      // sibling <slug>.context.md — attached AFTER validation like the customer pack; the project's own
      // background/competitive context, guarded by the same rule-shape + size budget.
      const packPath = join(cdir, CONTEXT_PACK_FILE(slug));
      const contextPack = existsSync(packPath) ? readFileSync(packPath, "utf8").trim() : "";
      if (contextPack) assertContextPackShape(contextPack, `profiles/${rel}.context.md`);
      // lift the display name AND the archive flag OUT of the field set — both are overlay META, never
      // merged into the effective profile (PROJECT_KEYS is the merge contract and neither is in it)
      const { projectName: rawName, archived: rawArchived, ...fields } = o;
      projects.set(`${ck}/${slug}`, {
        projectKey: slug, customerKey: ck,
        projectName: (typeof rawName === "string" && rawName.trim()) ? rawName.trim() : slug,
        // PRESENT ONLY WHEN TRUE, like a recipe's own file: an always-present `archived:false` would ride
        // the editor's draft back on every save and turn a partial save into a silent UN-archive — the
        // exact omission-is-not-consent hole the service-side stickiness exists to close. Absence here is
        // what makes an EXPLICIT archived:false the only thing that un-archives.
        ...(rawArchived === true ? { archived: true } : {}),
        ...fields,
        ...(contextPack ? { contextPack } : {}),
      });
    }
  }
  }
  projectCache = { key: cacheKey, projects };
  return projects;
}

/** spec 62 — resolve the EFFECTIVE profile for a run: the customer profile with its project overlay merged
 *  per-field (project → customer → house), plus an `origins` map naming where each PROJECT_KEY's effective value
 *  came from ("project" | "customer" | "house"; "house" = absent at both levels ⇒ code applies its own default —
 *  NEUTRAL_DELIVERY / marketplaceDensity→sparse / DEFAULT_FRAMEWORK). Returns { profile, projectKey, projectName,
 *  origins }. No job.projectKey, or a key naming no project under the resolved customer (intake's validateJob
 *  clarifies an unknown key before any spend, so this only fires on the deleted-mid-flight edge) ⇒ the customer
 *  profile unchanged and origins null, so freezeProfile stays byte-identical to a pre-62 run. `profile.key` stays
 *  the CUSTOMER key throughout — a project never becomes the resolved customer, and identity/self-exclusion read
 *  the whole-customer `name` unchanged. */
export function resolveEffectiveProfile(job, { profiles = loadProfiles(), projects } = {}) {
  const customer = resolveProfile(job, { profiles });
  const projKey = String(job?.projectKey ?? "").trim();
  if (!projKey) return { profile: customer, projectKey: null, projectName: null, origins: null };
  const roster = projects ?? loadProjects({ profiles });
  const overlay = roster.get(`${customer.key}/${projKey}`);
  if (!overlay) return { profile: customer, projectKey: null, projectName: null, origins: null };
  const profile = { ...customer };
  const origins = {};
  for (const f of PROJECT_KEYS) {
    // `!= null`, not `!== undefined`: the sparse validator tests presence with `!= null` throughout, so
    // an overlay key written as an explicit null passed validation and then threaded this gap — masking
    // the customer's configured value with null while `origins` claimed the project had set it, and for
    // `platforms` reaching the union spread below as a TypeError that parked every job for that project
    // behind an opaque "resolution errored" clarify. Absent and null both mean "this overlay says
    // nothing about that field".
    if (overlay[f] != null) {
      // `platforms` UNIONS; every other project key replaces.
      //
      // The customer's platforms are CLIENT-MANDATED — the account asked for those marketplaces to be
      // searched, and a project may add to that instruction but never revoke it. Replace semantics meant a
      // project that stated its own marketplaces silently DELETED the customer's: the Aurora Interactive account
      // names 7 games storefronts, its console-ecosystem project names 9 mostly-retail sites, and every run
      // of that project searched the 9 — dropping store.epicgames.com, itch.io, apps.microsoft.com and
      // mobygames.com. The report still read as clean coverage, because the sweep faithfully covered the
      // list it was handed. Both lists are wanted and both are reasoned: the customer's cover the software
      // side, the project's cover the console-accessory retail surface its context pack argues for.
      //
      // Replace stays correct for the other keys — classes, jurisdictions, delivery, risk posture and depth
      // legitimately DIFFER per engagement rather than accumulating. Only `platforms` is an instruction the
      // account gave that an engagement has no standing to withdraw.
      //
      // A project that genuinely needs to exclude a customer platform must say so explicitly with its own
      // key; it must never be the silent side effect of listing your own.
      if (f === "platforms") {
        const merged = [...new Set([...(customer[f] ?? []), ...overlay[f]])];
        profile[f] = merged;
        origins[f] = (customer[f]?.length && overlay[f].length) ? "customer+project" : (overlay[f].length ? "project" : "customer");
      } else {
        profile[f] = overlay[f]; origins[f] = "project";
      }
    }
    else if (customer[f] !== undefined) { origins[f] = "customer"; }   // value already carried by the spread
    else { origins[f] = "house"; }
  }
  if (overlay.contextPack) profile.contextPack = overlay.contextPack;   // the project's own background wins when present
  // — THE ORIGINS RIDE ON THE PROFILE, not only beside it.
  //
  // `resolveEffectiveScope` decides whether to tell an approver "this project" or "the account's default
  // classes" by reading `profile.origins`. It was returned HERE as a sibling and no caller bridged the
  // two — checked on origin/main: run-quote.mjs:59, resolve-request.mjs:44,47 and scope-rules.mjs:107
  // all pass the profile alone. So both `=== "project"` tests were permanently false and the whole
  // FROM.project branch was dead code: a project that REPLACES its customer's classes ran on the
  // project's list and told the approver those were the account's defaults. The number was right; the
  // reason given for it was wrong, and it pointed at the wrong place to go and change it.
  //
  // Attached here rather than threaded through four call sites because this is the one place that KNOWS
  // — every caller that resolves a profile now carries its provenance whether or not it thought to ask,
  // and 's hand-bridge at the §B2 door (`{...profile, origins }`) becomes a no-op rather than the
  // only correct call site. The sibling stays in the return for the callers that read it directly.
  return { profile: { ...profile, origins }, projectKey: overlay.projectKey, projectName: overlay.projectName, origins };
}

/** The self-exclusion gate: a profile's selfExclusionOwners[]
 *  may only inject when the job's APPLICANT is the profile's customer — an aurora-interactive.example-forwarded
 *  search for a third-party applicant must NOT classify Aurora-owned conflicts as own rights
 *  (that would delete true conflicts from a delivered clearance). Word-boundary containment of the
 *  profile name in the applicant string ("Aurora Interactive" ⊂ "Aurora Interactive Ltd"), never fuzzy. */
export function applicantMatchesProfile(profile, customer) {
  const n = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const c = n(customer);
  const p = n(profile?.name);
  if (!c || !p) return false;
  return c === p || c.startsWith(`${p} `) || c.endsWith(` ${p}`) || c.includes(` ${p} `);
}
