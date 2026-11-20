// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-attachments.mjs — what a run freezes beside itself before its searches, and a resume reads back verbatim: the
// profile, the framework in force, the search policy, and the register plan with the house-element answer it reads.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { stopsWithTheRun } from "./cancel.mjs";
import { config } from "./driver.config.mjs";
import { narrowingMarkets, resolveTerritories } from "./effective-scope.mjs";
import { registerAdapter } from "./engine/run-choices.mjs";
import { attachFrameworkMethod, FROZEN_METHOD_FILE, methodPathFor } from "./framework-method.mjs";
import { DEFAULT_FRAMEWORK, frameworkFor, loadFrameworkManifest, manifestPathFor, parseFrameworkManifest } from "./framework.mjs";
import { canonicalJurisdictionCode } from "./jurisdiction-codes.mjs";
import { zhScopeDepthNotes } from "./jx-lanes.mjs";
import { note, runLog } from "./log.mjs";
import { frameHouseElementCandidate, frameIdentifiedClassRows, lastAcceptedMatterFrame, withFrameClasses } from "./matter-frame-record.mjs";
import { derivedBatchSize, derivedFloor, NEUTRAL_DELIVERY, recipeProseGuard, resolveEffectiveProfile, resolveProfile, withRunPlatforms } from "./profiles.mjs";
import { noteAdapter } from "./provider-calls.mjs";
import { instructedOrder } from "./record-goods.mjs";
import { compileRegisterPlan, excludeHouseElement, feasibilityMessages, fullyDeferredAxes, HOUSE_ELEMENT_RECEIPT, mintSupplementalQid, parseRegisterPlan, resolvePlanAgainstStore, resolveRegions as resolvePlanRegions, validatePlanFeasibility, variantTermIssue, verifyHouseElementOwnership } from "./register-plan.mjs";
import { resolveRecordExecutor } from "./register-records.mjs";
import { registerCapabilities, registerUnavailableOffices } from "./register-unreachable.mjs";
import { StageFailure } from "./run-outcome.mjs";
import { atomicWrite } from "./run-record.mjs";
import { inScopeClassList, registerJurisdictions } from "./run-scope.mjs";
import { depthFor, gateResolvedPolicy, isRegisterOnly, loadRecipes, productKeyOf, resolveSearchPolicy } from "./search-policy.mjs";
import { paths } from "./stages.mjs";
import { parseVariantManifestModel } from "./variant-manifest-model.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── WS-B: the run's frozen profile + the sidecar spine ──────────────────────────────────────────────
// Resolve the customer profile ONCE and freeze it into _driver/profile.json (temp+rename, BEFORE any
// validated stage). Resume / --experiment load FROM the sidecar — a profiles/ edit between
// run and resume must never change a live run's floor or platform grid mid-flight; validators read
// the same file (verify.mjs readRunProfile), which also makes concurrent runs' floors physically
// isolated (the WS-C boundary). write=false (reconstructCtx) reads without minting a sidecar into an
// existing run dir.
// The exact subset of the resolved profile frozen into the run sidecar (_driver/profile.json). Exported so
// the freeze contract is unit-testable (the bug this guards: a per-customer field configured in a profile
// but DROPPED here is silently never applied — the stages read the frozen copy, not the raw profile).
export function freezeProfile(p, project = null) {   // @internal
  const frozen = {
    profileKey: p.key,
    name: p.name,
    industry: p.industry ?? "",
    platforms: p.platforms,
    minCellsPerVariant: derivedFloor(p),
    batchSize: derivedBatchSize(p),
    defaultClasses: p.defaultClasses ?? [],
    defaultJurisdictions: p.defaultJurisdictions ?? [],
    selfExclusionOwners: p.selfExclusionOwners ?? [],
    // WS-B delivery overlay + F8 appetite — frozen into the sidecar so publish/render/email select the
    // customer's variant from the same immutable source the rest of the run reads (resume-safe).
    delivery: p.delivery ?? NEUTRAL_DELIVERY,
    riskAppetite: p.riskAppetite ?? "",
    // Phase 1: per-customer context pack (background facts) — frozen like riskAppetite so a pack edited
    // between run and resume can never change a live run mid-flight. Fed to delivery curation as CONTEXT
    // (emphasis only, D1); absent ⇒ "" ⇒ falsy-omitted in the stage message (byte-identical to no pack).
    contextPack: p.contextPack ?? "",
    // — THE DEMO MARKING IS FROZEN, and until now it was not.
    //
    // This function is an allow-list, and `demoData` was not on it. So the frozen sidecar NEVER carried
    // the flag, `resolveDemoData`'s sidecar branch was DEAD on every run, and the demonstration banner
    // hung entirely on the roster re-read — whose catch answers `false` when the roster cannot be read.
    // A republish, an archive re-render, a renamed profile or a missing env therefore renders a DEMO
    // REPORT AS REAL: invented mark, real register basis, published URL, no disclaimer.
    //
    // THE FAILURE DIRECTION WAS REASONED WRONG WHEN THE RESOLVER WAS WRITTEN, and I wrote it. Its header
    // argues that unreadable evidence yielding `false` is safe because "a marking is never invented for a
    // report nobody proved is a demo". For a marking that says THIS IS FICTION, not-marking is the unsafe
    // direction — it is the exact defect 2122 was raised on. Freezing the flag is what makes the safe
    // reading available at all: the sidecar is written once, from the roster, while it IS readable.
    //
    // `=== true` and nothing looser, matching demoRunShape and buildJob: a truthy string must not be able
    // to declare a real client matter fiction. Absent stays absent — this cannot MARK a run the roster
    // never called a demo, only preserve one it did.
    demoData: p.demoData === true,
    // BUGFIX 2026-06-19: per-customer reasoning-skill SELECTION must be frozen too. It was missing here, so
    // frameworkFor()/workedExamplesFor() (stages.mjs) read the frozen ctx.profile, found no path, and silently
    // fell back to the firm-neutral DEFAULT for EVERY run — the profiles' configured frameworks
    // were never applied. RAW value (NOT `?? ""`): absent ⇒ undefined ⇒ JSON drops it ⇒ frameworkFor falls back
    // to DEFAULT; an empty string would NOT trigger the `?? DEFAULT` and would break the read.
    frameworkPath: p.frameworkPath,
    workedExamplesPath: p.workedExamplesPath,
    // Search spine: the account's DEFAULT PRODUCT, the entitlement menu and the jx deepening POSTURE
    // freeze with the profile so a resume can never re-decide them from an edited profiles/ state.
    // CONDITIONAL SPREAD, not a raw assignment (review 2026-07-17): `key: undefined` creates an OWN
    // property that Object.keys/profileShaOf still see (canonicalJson renders it "null"), which would
    // silently change EVERY pre-spine profile's sha — the spread keeps absent keys truly absent, so
    // profiles without them freeze byte- AND sha-identically to a pre-spine sidecar.
    //
    // `defaultProduct` REPLACES `defaultSearchLevel` HERE, and the omission was load-bearing:
    // deleted defaultSearchLevel from KNOWN_PROFILE_KEYS but this line was never repointed, so the
    // frozen profile carried the account's default product NOWHERE — and attachSearchPolicy, which
    // resolves off this frozen sidecar and nothing else, could never see it. An account whose profile
    // says "every search here is a Knockout search" froze a clearance derived from its territories
    // instead. No profile can still carry `defaultSearchLevel` (profiles.mjs refuses it as an unknown
    // key), so under the conditional spread no existing sidecar's bytes or sha change.
    ...(p.defaultProduct !== undefined ? { defaultProduct: p.defaultProduct } : {}),
    ...(p.allowedRecipes !== undefined ? { allowedRecipes: p.allowedRecipes } : {}),
    ...(p.jxPolicy !== undefined ? { jxPolicy: p.jxPolicy } : {}),
  };
  // spec 62 — when the run is under a PROJECT, record which project rated it and the per-field origin map,
  // added AFTER the 14-field base so a NO-PROJECT freeze stays byte-identical to a pre-62 sidecar (the
  // regression anchor and every existing run's profileSha are preserved; profileShaOf sorts keys,
  // so these hash in only when present, making "which project rated this run" verifiable, never asserted).
  if (project?.projectKey) {
    frozen.projectKey = project.projectKey;
    frozen.projectName = project.projectName ?? project.projectKey;
    frozen.origins = project.origins ?? {};
  }
  return frozen;
}
// T9 (K3) — sha over the canonical (key-sorted) JSON of the frozen subset, so "which
// framework/profile rated this run" is VERIFIABLE (recompute from profiles/<key>.json through
// freezeProfile and compare), never merely asserted. Pre-49 sidecars simply lack the field.
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export function profileShaOf(frozen) {   // @internal
  const { profileSha: _omit, ...rest } = frozen ?? {};
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

export function attachProfile(ctx, job, { write = true } = {}) {
  const sidecarPath = paths(ctx.paths.runDir).profile;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — genuinely absent */ }
  if (raw != null) {
    let sidecar;
    try { sidecar = JSON.parse(raw); }
    catch (e) {
      // PRESENT but unreadable: the sidecar is DRIVER-written (temp+rename) — a corrupt one is a
      // code/filesystem bug. Fail loudly; silently re-resolving from CURRENT profiles/ would be the
      // exact mid-run drift the freeze exists to forbid (and the validators fail-close on the same
      // file — both ends of the contract must agree).
      throw new Error(`_driver/profile.json is corrupt (${e.message}) — investigate; the frozen profile is never silently re-derived`);
    }
    ctx.profile = sidecar;
    // mismatch probe is telemetry-only and must never let a broken profiles/ state crash a resume
    // whose frozen sidecar needs nothing from it.
    try {
      const current = resolveProfile(job);
      if (current && current.key !== sidecar.profileKey)
        runLog(ctx.paths.runDir, { event: "profile-mismatch", sidecar: sidecar.profileKey, resolved: current.key });
      // THE MATCH IS RECORDED TOO, and that is the point rather than symmetry for its own sake.
      // `profile-mismatch` existed and its counterpart did not, so "the profile was right" was carried
      // by the ABSENCE of a row — and an absence cannot tell "it matched" from "the probe never ran"
      // (it throws below on a broken profiles/ state) or from "this run predates the probe". Three
      // different facts, one empty grep. The positive row says which.
      else if (current)
        runLog(ctx.paths.runDir, { event: "profile-resolved", sidecar: sidecar.profileKey, resolved: current.key });
    } catch (e) {
      runLog(ctx.paths.runDir, { event: "profile-mismatch-probe-failed", error: String(e.message).slice(0, 120) });
    }
    return;
  }
  if (!write) {
    // no sidecar + read-only (reconstructCtx, or a resume of a pre-WS-B run): stay LEGACY end to
    // end — a fresh resolve here would make the messages dictate what the validators (which read
    // only the sidecar) won't enforce.
    ctx.profile = null;
    return;
  }
  // spec 62 — resolve the EFFECTIVE profile (customer + optional project overlay merged per-field). No project ⇒
  // { projectKey: null, origins: null } and the freeze is byte-identical to pre-62. derivedFloor/derivedBatchSize
  // follow the RESOLVED platforms automatically (a project's wider marketplace list ⇒ its own smaller batch).
  const { profile: p0, projectKey, projectName, origins } = resolveEffectiveProfile(job);
  // Per-run platforms are ADDITIVE, and are folded in BEFORE the freeze so derivedFloor/derivedBatchSize
  // re-derive from the surface actually swept. Sweeping an extra marketplace without raising the floor
  // would leave the coverage ledger describing a grid the run never had.
  const { profile: p, added: addedPlatforms } = withRunPlatforms(p0, job.platforms);
  ctx.profile = freezeProfile(p, projectKey ? { projectKey, projectName, origins } : null);
  // Provenance ("why did this run sweep gnc.com?") is deliberately NOT stamped onto the frozen profile:
  // profileSha exists so "which profile rated this run" can be RECOMPUTED from profiles/<key>.json, and a
  // job-derived field in that subset would make it unrecomputable. The swept set is visible in the frozen
  // platforms; where the extras came from is run telemetry, logged below.
  ctx.profile.profileSha = profileShaOf(ctx.profile);   // T9 (K3)
  // WHICH ORGANISATION'S GENERIC this run is filed under — the door stamps it on a Generic job, from the
  // verified principal. Set AFTER the hash for the reason the provenance note above gives: it is job-
  // derived, and `profileSha` must stay recomputable from profiles/<key>.json. Absent on a company's run.
  if (typeof job?.tenant === "string" && job.tenant && ctx.profile.profileKey === "generic") ctx.profile.organisation = job.tenant;
  const tmp = `${sidecarPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ctx.profile, null, 2) + "\n");
  renameSync(tmp, sidecarPath);
  runLog(ctx.paths.runDir, { event: "profile", key: p.key, project: projectKey ?? null, platforms: p.platforms.length,
    ...(addedPlatforms.length ? { runPlatforms: addedPlatforms } : {}),
    floor: ctx.profile.minCellsPerVariant, batch: ctx.profile.batchSize });
}

// ── doc 50 — freeze the FRAMEWORK MANIFEST beside the profile sidecar ────────────────────────────────
// _driver/framework.json is the frozen band vocabulary of the framework in force (the customer's own via
// the frozen frameworkPath, else the Generic default) — the single source every v4 consumer reads (the
// synthesis dictation, verify's band gates, the lint auto-correct, render/index/email/xlsx). Frozen so a
// framework edit between run and resume can never change a live run's vocabulary. RESUME BACKFILL: a run
// frozen before doc 50 has a profile sidecar but no framework sidecar — mint it here from the frozen
// frameworkPath (the parked-run deploy-boundary case); its findings.json stays whatever version it
// declares, judged by that version's gates. Corrupt ⇒ fail loud (driver-written, same as profile.json).
const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
export function attachFramework(ctx, { write = true } = {}) {
  const sidecarPath = paths(ctx.paths.runDir).framework;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — genuinely absent */ }
  const methodPath = driverDir(ctx.paths.runDir, FROZEN_METHOD_FILE);
  if (raw != null) {
    try { ctx.framework = parseFrameworkManifest(raw); }
    catch (e) { throw new Error(`_driver/framework.json is corrupt (${e.message}) — investigate; the frozen framework is never silently re-derived`); }
    // The method the run froze, or none: a run frozen without one is never given one on resume.
    ctx.frameworkMethod = attachFrameworkMethod({ frozenPath: methodPath, manifest: ctx.framework, minted: false });
    return;
  }
  // NO FROZEN FRAMEWORK. It is frozen before the first stage, so a run without one ran no stage, and a
  // read-only caller has nothing to rebuild. (A run from before the framework freeze was given one here,
  // resolved in memory; a run from an earlier build is no longer resumed.)
  if (!write) throw new Error("_driver/framework.json is absent — the run stopped before its framework was frozen, so it ran no stage and there is nothing to rebuild");
  // A cold start, or a resume of a first pass that stopped before this freeze: the framework in force is
  // resolved from the frozen profile and minted now, as the cold path does. With no profile it is the
  // GENERIC DEFAULT — doc 50 has no framework-less runs, and frameworkFor(null) resolves it.
  const fwPath = frameworkFor(ctx.profile);
  // config.skillsRoot, NOT DRIVER_DIR: the profile's framework may live in the deployment's config
  // store (CLEAROTRON_INSTRUCTIONS_DIR), which is also the root the AGENT resolves the same path against.
  const manifest = loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath);   // throws framework_manifest_missing — a deploy defect, loud
  ctx.framework = manifest;
  // The method is frozen BEFORE the manifest: a run interrupted between the two writes has no manifest,
  // so its resume mints both again. The other order would leave a manifest with no method beside it,
  // which the resume branch above reads as a framework that states none.
  ctx.frameworkMethod = attachFrameworkMethod({ frozenPath: methodPath, resolve: (rel) => config.resolveSkillPath(rel), fwPath, manifest, minted: true });
  const tmp = `${sidecarPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(tmp, sidecarPath);
  runLog(ctx.paths.runDir, { event: "framework", key: manifest.framework_key,
    custom: fwPath !== DEFAULT_FRAMEWORK, bands: manifest.bands.map((b) => b.label).join("/"), file: manifestPathFor(fwPath),
    method: ctx.frameworkMethod ? methodPathFor(fwPath) : null });
}

// ── Search-depth spine — freeze the resolved SEARCH POLICY beside the profile ────────────────────────
// _driver/search-policy.json records WHICH product shape this run is (level / pipeline / components /
// recipe content-sha / where the selection came from) — frozen once at cold start so a profile-default or
// recipe edit between run and resume can never reshape a live run (the freezeProfile doctrine), and so
// publish/meta can stamp the run's product identity without re-deriving it. Exported for unit tests.
// Resolution inputs: the FROZEN ctx.profile (carries defaultProduct + allowedRecipes — the resume-safe
// source; the runner's admission gate already enforced allowedRecipes on the raw profile at claim) and
// the SHARED TERRITORY LADDER, because a request that names no product is named by its own scope.
// A resolution that lands on a pipeline this build cannot execute FAILS LOUD — a CLI-invoked job must
// never silently run a knockout selection as a full-priced clearance (the admission gate's discipline,
// held at the second door too).
/** The preview's promise, kept at the run's own door: a saved search's scope BINDS the run.
 *
 *  resolveEffectiveScope (the plan/review preview) ladders request > saved search > account, but
 *  until now its recipeScope input had no run-side consumer — the run resolved scope from job
 *  fields + profile defaults only, so a requester could approve the saved scope and get a
 *  different search (audit N3, 2026-07-27). The fold writes the SAME ladder into the job itself:
 *  jurisdictions/classes fill only when the requester left them unset (request wins), platforms
 *  union additively (a mandate is never removable, mirroring withRunPlatforms — the account's own
 *  list still unions in later at the gather door). Idempotent by construction, so the resume
 *  re-fold from the frozen sidecar changes nothing; sidecars frozen before recipeScope existed
 *  carry null and no-op. */
export function foldRecipeScope(job, searchPolicy) {   // @internal
  const s = searchPolicy?.recipeScope;
  if (!s || typeof s !== "object") return job;
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
  // WORLDWIDE IS NOT A GAP THE SAVED SEARCH MAY FILL. A worldwide-stamped request has no
  // `job.jurisdictions` — that is what worldwide LOOKS like on the wire — so the emptiness test alone
  // read it as "the requester named none" and wrote the saved search's territories in. The run then
  // carried a stamp saying everywhere and a list saying seven countries, and every consumer downstream
  // of this fold reads the list. resolveEffectiveScope already puts worldwide above the saved-search
  // rung; this is the same rule at the one place that WRITES.
  const worldwide = job.geography?.mode === "worldwide";
  if (!worldwide && !nonEmpty(job.jurisdictions) && nonEmpty(s.jurisdictions)) {
    job.jurisdictions = [...s.jurisdictions];
    // AND THE STAMP MOVES WITH THEM. `job.geography` was written at the door to say the requester named
    // no territories; after this fold the job names some, and leaving the old stamp behind makes every
    // later reader attribute a saved search's scope to a request that never mentioned geography.
    // GEOGRAPHY_ORIGINS has carried "saved-search" since the stamp was minted, for "a writer that
    // freezes a resolved layer into the job, which nothing does yet". This is that writer.
    job.geography = { mode: "named", origin: "saved-search" };
  }
  if (!nonEmpty(job.classes) && nonEmpty(s.classes)) job.classes = [...s.classes];
  if (nonEmpty(s.platforms)) {
    const have = new Set((job.platforms ?? []).map((p) => String(p).trim().toLowerCase()));
    const add = s.platforms.filter((p) => !have.has(String(p).trim().toLowerCase()));
    if (add.length) job.platforms = [...(job.platforms ?? []), ...add];
  }
  return job;
}

export function attachSearchPolicy(ctx, job, { write = true } = {}) {   // @internal
  const sidecarPath = paths(ctx.paths.runDir).searchPolicy;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — genuinely absent */ }
  if (raw != null) {
    try { ctx.searchPolicy = JSON.parse(raw); }
    catch (e) { throw new Error(`_driver/search-policy.json is corrupt (${e.message}) — investigate; the frozen policy is never silently re-derived`); }
  } else if (!write) {
    // NO FROZEN PRODUCT, AND THIS CALLER MAY NOT FREEZE ONE. A run froze its product before its first stage, so it has
    // none to read. A resume finishes the opening first (steps/open-run.mjs finishTheOpening), so a reader here never
    // assumes one: this used to read the absence as a run from before the freeze and name a retired clearance.
    throw new Error("_driver/search-policy.json is absent — the run stopped before its product was frozen, and this reader does not settle one");
  } else {
    let resolved;
    // force:true — the recipe store is written by a LIVE service; a long-lived driver process must see a
    // just-saved recipe (save→trigger), and the read only happens when the job names one (rare, cheap).
    //
    // ── RESOLVED AGAINST THE TERRITORIES, WHICH IS WHAT THE WALL RESOLVED AGAINST ──────────────────────
    //
    // This call omitted `territories` and therefore minted the product from an EMPTY scope. Under the
    // offering's last rung an empty scope IS worldwide, so a one-country clearance — admitted by the
    // wall as a Full country search, quoted with case law and the native-language lane, 2.5h — froze
    // here as a Global preliminary search with caseLaw:false and jxLanes:false. The case-law stage never
    // ran and the delivered document printed a product the client did not buy. The two resolutions are
    // independent by construction (the runner does not hand its policy down), so the only fix is that
    // both read the same ladder: resolveTerritories, off the FROZEN profile, exactly as the wall's own
    // first pass reads it off the effective one. The saved-search rung is not needed here and cannot be
    // — foldRecipeScope runs immediately below and writes it into the job — which is why this is the
    // ladder rather than the full resolver.
    try {
      resolved = resolveSearchPolicy(job, {
        profile: ctx.profile,
        recipes: job.recipeKey ? loadRecipes({ force: true, proseGuard: recipeProseGuard }) : null,
        territories: resolveTerritories(job, ctx.profile).jurisdictions,
      });
    } catch (e) { resolved = { clarify: `search-policy resolution errored: ${String(e?.message ?? e).slice(0, 160)}` }; }
    // A CLARIFY THROWS. THERE IS NO FAIL-OPEN LEFT, and its deletion is the point.
    //
    // It used to fall open to the literal level `clearotron` — stageLabel "Depth 4" — whenever the job named
    // no selector and the profile carried no default. Both halves of that condition had rotted: the
    // selector test read the deleted `searchLevel` (so it was true for every job) and the profile test
    // read the deleted `defaultSearchLevel` (so it was undefined for every profile). The branch was
    // therefore UNCONDITIONAL: any resolution that clarified — a product the account's allowedRecipes
    // refuses, a staff-set default that is a typo, an unreadable recipe store — silently minted a
    // RETIRED product into the frozen sidecar, and reportIdentityFor resolved it back through
    // RETIRED_POLICIES so the delivered report was bannered "Depth 4 — Preliminary clearance".
    //
    // A guess wearing a level key is what the offering replaced. A resolution nobody can make names no
    // product, and this door refuses rather than choosing one (the admission gate's discipline, held at
    // the second door too — CLI/direct dispatch never passes the first).
    if (resolved.clarify) throw new Error(`search-policy: ${resolved.clarify}`);
    // The availability gate holds at THIS door too (CLI/direct dispatch bypasses the runner's admission
    // gate): a selection this build/deployment cannot execute refuses on MINT — never a silent downgrade
    // to a plain clearance. Resume-reads are exempt: a mid-flight run keeps its frozen shape even if a
    // kill switch flipped after it started.
    const gateMsg = gateResolvedPolicy(resolved);
    if (gateMsg) throw new Error(`search-policy: ${gateMsg}`);
    // deliveryRoute "portal" has no consumer yet — refuse like an unbuilt level (a silent email-anyway
    // would be a delivery-contract lie); "email"/absent is today's behavior.
    const route = String(job.deliveryRoute ?? "").trim().toLowerCase() || null;
    if (route && route !== "email")
      throw new Error(`search-policy: deliveryRoute ${JSON.stringify(job.deliveryRoute)} is not available in this build yet — omit it to deliver by email`);
    // Attribution rides the sidecar SANITIZED (review 2026-07-17): the validator only WARNS on a malformed
    // parentRunId ("treated as unset") — honor that promise at the freeze so a raw queue file can never
    // persist an arbitrary string into meta.json; enqueuedVia is clamped to a bounded token for the same
    // reason. `sub` (the verified ops-token principal) joins these once the grants slice lands (Phase 3b).
    const pidRaw = String(job.parentRunId ?? "").trim().toLowerCase();
    const viaRaw = String(job.enqueuedVia ?? "").trim();
    ctx.searchPolicy = { schema: 1, level: resolved.level, pipeline: resolved.pipeline, stageLabel: resolved.stageLabel,
      components: resolved.components, recipe: resolved.recipe ?? null, extras: resolved.extras ?? null,
      origins: resolved.origins,
      // WHOEVER asked for the case-law pass — this job's own lever, or the saved search named instead of
      // a level — frozen with the rest of the selection. A run that resumes days later grounds case law
      // because the run was SOLD it, not because a recipe still says so. (resolveSearchPolicy ORs the two
      // requesters; until 2026-08-01 it returned the recipe's side alone, so a level-selected job froze
      // `false` while the quote had already priced the premium and the stage had already run.)
      caseLaw: resolved.caseLaw === true,
      // The saved search's SCOPE, frozen verbatim for the same reason: foldRecipeScope derives the
      // run's own jurisdictions/classes/platforms from THIS copy on every pass (fresh and resume),
      // so a recipe edited mid-park cannot retarget a run the requester already approved.
      recipeScope: resolved.recipeScope ?? null,
      // THE WEB SETTINGS this run is held to (search-policy.mjs PRODUCT_POLICIES): the tier its questions go
      // out on and the results each grid cell keeps. Frozen, so a resume runs on what the run started on.
      web: resolved.web ?? null,
      deliveryRoute: route,
      enqueuedVia: /^[a-z0-9][a-z0-9/_.-]{0,63}$/i.test(viaRaw) ? viaRaw : null,
      // WHO triggered (Phase 3b attribution): the verified token sub start_run stamped — frozen here so
      // it survives into meta.json (the ledger alone was unanswerable from list_runs; review 2026-07-18).
      // Same bounded-token clamp as enqueuedVia (this string reaches meta/log surfaces).
      enqueuedBy: /^[a-z0-9][a-z0-9@/_.:-]{0,119}$/i.test(String(job.enqueuedBy ?? "").trim()) ? String(job.enqueuedBy).trim() : null,
      parentRunId: /^[a-z0-9][a-z0-9-]{1,80}$/.test(pidRaw) ? pidRaw : null,
      frozenAt: new Date().toISOString() };
    const tmp = `${sidecarPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(ctx.searchPolicy, null, 2) + "\n");
    renameSync(tmp, sidecarPath);
    runLog(ctx.paths.runDir, { event: "search-policy", level: ctx.searchPolicy.level, origin: ctx.searchPolicy.origins?.level ?? null,
      recipe: ctx.searchPolicy.recipe?.key ?? null });
    // qw/cn-scope-honesty (b) — the resolution-time twin of the delivery-time honesty row: a run whose
    // requested scope names a zh-lane jurisdiction but whose machinery does not carry the lane gets a
    // RECORDED recommendation naming where the native-language investigation can be bought. A note only
    // — it never clarifies, parks, or substitutes the product (this door direct-dispatches too, so the
    // note lands in the run log; the runner emits its own copy at the intake door, the
    // checkMarkBudget-warnings posture).
    for (const n of zhScopeDepthNotes(job, ctx.searchPolicy, ctx.profile))
      runLog(ctx.paths.runDir, { event: "level-scope-note", note: n });
  }
  // The fold runs on EVERY path through this door — fresh mint, frozen-sidecar resume, legacy
  // implicit clearotron (recipeScope null there = no-op) — so every downstream consumer of
  // job.jurisdictions/classes/platforms sees the scope the preview promised.
  foldRecipeScope(job, ctx.searchPolicy);
  // Phase 2a: "knockout" is now a dispatchable pipeline — the refusal covers only shapes THIS build
  // cannot execute (e.g. a sidecar frozen by a future build, resumed here).
  if (!["clearance", "knockout"].includes(ctx.searchPolicy.pipeline))
    throw new Error(`run is frozen to search level "${ctx.searchPolicy.level}" (pipeline "${ctx.searchPolicy.pipeline}") — this build has no such pipeline; refusing to run it as a clearance (never a silent product substitution)`);
  // Derived HERE, off the frozen policy, and not at the gather fan-out where it is first used: every
  // stage message() reads ctx.registerOnly, and a run RESUMED past gather never re-enters that block —
  // so deriving it there would leave the late judgment stages (synthesis, refutation, report-overview)
  // reading undefined on exactly the resumes where the prompt matters most, telling them to read a
  // common-law findings file that was never written.
  ctx.registerOnly = isRegisterOnly(ctx.searchPolicy);
  // — the depth row, resolved HERE for the same reason registerOnly is: the late judgment stages
  // are exactly the ones that read it, and a resume that derived it later would have them grading
  // against `undefined` on the runs where it matters most. Fails toward depth when the product is
  // unknown, and carries `source` so a silent fallback is visible in the run record rather than
  // looking like a ladder that did nothing.
  ctx.depth = depthFor(ctx.searchPolicy);
}

// WS2 (B3) — compile/freeze/reuse the deterministic register plan (the attachProfile
// pattern, applied to search identity). The FROZEN _driver/register-plan.json always wins on a
// resume (mid-run re-derivation is the drift the freeze forbids — a corrupt one fails LOUD).
// ALWAYS ON (the CLEAROTRON_REGISTER_PLAN flag was REMOVED on the senior lawyer's instruction 2026-07-03: shipped
// functionality is never hidden behind env flags — it is on, or it is rolled back): every fresh
// run mints from the structured manifest sibling; a run that cannot support a plan (no/malformed
// sibling — e.g. a pre-spec48 resume — or a class-less matter) degrades to ctx.registerPlan =
// null with a logged reason and every consumer takes the legacy path. Replay reads frozen
// artifacts and receipt-keyed validators, never any env — historical verdicts can never flip.
// CROSS-RUN PLAN STORE REMOVED 2026-07-19. The per-slug store
// (<studio>/<slug>/_plans/register-plan.vN.json) reused/extended a previous run's plan for the same
// matter. It made a shipped fix UNDELIVERABLE: `extendRegisterPlan` is strictly append-only
// (`entries: [...prev.entries, ...added]`, never a removal) and reuse keyed on
// `variants_fingerprint`, which does NOT include the form band. So the 2026-07-18 Drivers Haven
// re-run compiled a clean form band, then dispatched the 2026-07-17 plan's stale diacritic
// OR-stack anyway (`source:"extended", added:11`) and failed on the identical gate, identical five
// terms, identical 424 hits. Any defect that ever reached a plan was immortal for that matter.
//
// Determinism does NOT depend on the store and is unaffected: the compiler is PURE, so the same
// manifest + job + form band still yields a byte-identical plan on a fresh compile. That is what
// fixed the F2 non-reproducibility (fact-set Jaccard 0.04 across re-runs); the store only ever
// added "recall is monotone across plan versions".
//
// Measured before removing: across the whole corpus, 20 plans MINTED, 17 FROZEN (the run-level
// resume freeze below), 5 EXTENDED — and all 5 extensions were re-runs of test matters. The
// monotone-recall guarantee protected a re-clear, which effectively never happens in production,
// at the cost of hiding every fix from the only matters we re-run to verify fixes.
//
// A genuinely narrower manifest on a re-run is now VISIBLE (a smaller fresh plan) rather than
// silently backfilled from history. If monotone recall is ever wanted for a real re-clear it must
// be explicit and diffed, never a silent default.
//
// The RUN-LEVEL freeze (P.registerPlan, immediately below) is untouched and load-bearing: a run
// resuming mid-flight must not re-plan, or its half-executed band no longer identity-joins to its
// qids. That freeze lives inside one run and can never carry a defect across a code change.
// A1 — an axis whose EVERY entry is `unsupported` (capability gaps) will dispatch NOTHING: deferral is
// the honest lane, so this is a LOUD EVENT, never a rejection. Refusing the plan would convert a set of
// disclosed gaps into an undelivered run; staying silent would let a whole register axis quietly ship
// as a stack of deferred rows nobody flagged at plan time.
function logFullyDeferredAxes(plan, P, source) {
  for (const a of fullyDeferredAxes(plan)) {
    runLog(P.runDir, { event: "register-plan-axis-deferred", source, axis: a.axis, entries: a.entries,
      reason: String(a.reason ?? "").slice(0, 200) });
    note(`register-plan: axis ${a.axis} will dispatch ZERO entries — all ${a.entries} deferred as capability gaps (${String(a.reason ?? "").slice(0, 120)})`);
  }
}

// `frozenOnly` (item): read the FROZEN plan or nothing. reconstructCtx is an introspection path —
// it must never compile and freeze a plan into an existing run as a side effect of being asked what the
// run already holds. (attachProfile / attachFramework take the same posture via `write:false`.)
/**
 * Ask the register whether the client owns the element the frame proposed, and record the answer.
 *
 * ASYNC AND SEPARATE FROM THE COMPILE, which is why it is its own step rather than a branch inside
 * `attachRegisterPlan`: that function is synchronous and is called on the resume path too. The shape is
 * the digest's — an async driver step writes a receipt, a synchronous consumer reads it — and it buys
 * the property that matters here: the compile cannot accidentally exclude anything by reaching for a
 * promise it does not await.
 *
 * NOT A REGISTERED CONTEXT DERIVATION, and the reason is worth stating because the obvious reading is
 * that it should be. `stage-context.mjs` declares the derivations a sandbox can REPLAY, and its runners
 * are synchronous. This one asks a live register a question; there is no offline re-derivation of that,
 * and declaring it would promise the `--experiment` rig something no runner can deliver — which the
 * guard catches by name, loudly, as it should. A sandbox instead inherits the receipt with the rest of
 * `_driver/`, and a sandbox that has none excludes nothing, which is the same answer every other
 * unverified run gets.
 *
 * NEVER-KILL. Every failure writes an unverified receipt and the run plans exactly as it does today.
 * The element being searched in full is the safe direction and the status quo; the only thing that can
 * narrow a client's search is a register answer naming their own live registration.
 */
export async function verifyAndRecordHouseElement(ctx, opts = {}) {
  const P = ctx.paths;
  try {
    const proposed = frameHouseElementCandidate(P.runDir);
    if (!proposed) return;   // the ordinary case: the frame proposed nothing and there is no question

    const classes = withFrameClasses(inScopeClassList(ctx.job, ctx.profile), P.runDir);
    // THE CLIENT'S OWN NAMES. The profile's trading names are the curated list; the matter's customer is
    // the free-text one. Both, because a profile may be absent on a one-off matter and a customer string
    // may be a person where the filings are held by a company.
    const owners = [...new Set([...(ctx.profile?.selfExclusionOwners ?? []), ctx.job?.customer].map((o) => String(o ?? "").trim()).filter(Boolean))];
    const caps = registerCapabilities(ctx.register);
    const { regions } = resolvePlanRegions(registerJurisdictions(ctx.job, ctx.profile), caps);
    const rec = resolveRecordExecutor({
      lister: opts?.recordLister ?? null, adapter: noteAdapter(ctx, registerAdapter(ctx.register)),
      agentId: ctx.agentId ?? null, sessionKey: `clearance-${ctx.run.slug}-${ctx.run.codename}`,
      recordLog: runRecordLogPath(P.runDir),
      fixtureDir: ctx.job?.registerFixtures?.records ?? null,
    });
    // AN EXACT-NAME LISTING OF THE ELEMENT, filtered to the client's own live in-class registrations by
    // the verifier. The owner join is done on REAL RECORDS the register returned, which is what
    // "verified by owner, not asserted" means — there is no owner-predicate listing on this interface
    // and inventing one would be a second way to ask the same question.
    const lookup = typeof rec.list !== "function" ? null : async ({ element, classes: cls }) => {
      const r = await stopsWithTheRun(P.runDir, "own-registrations", rec.list)(element, { classes: cls, regions, limit: 50 });
      if (!r || r.ok === false) return { ok: false, reason: String(r?.reason ?? "the register listing did not answer") };
      return { ok: true, records: Array.isArray(r.records) ? r.records : [] };
    };

    const receipt = await verifyHouseElementOwnership({ element: proposed.element, classes, owners, lookup });
    receipt.remainder = proposed.remainder;   // carried so the compile needs only this one file
    ensureDriverDir(P.runDir);
    atomicWrite(driverDir(P.runDir, HOUSE_ELEMENT_RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
    runLog(P.runDir, { event: "house-element-ownership", verified: receipt.verified, reason: receipt.reason,
      records: receipt.records.length, owners: owners.length, executor: rec.source });
    if (!receipt.verified) note(`house element: ${proposed.element} stays in the search — ${receipt.reason}`);
  } catch (e) {
    // A THROW HERE MUST NOT COST A REPORT. No receipt means no exclusion, which is today's plan.
    runLog(P.runDir, { event: "house-element-ownership-failed", reason: String(e?.message ?? e).slice(0, 160) });
  }
}

export function attachRegisterPlan(ctx, { frozenOnly = false } = {}) {
  const P = ctx.paths;
  if (frozenOnly) {
    // Read and nothing else: no feasibility re-check, and NO run-journal rows. "the driver attached the
    // frozen plan" is a run event; being asked what the run already holds is not, and a reconstruct
    // that logged one would put an event in the journal that never happened.
    ctx.registerPlan = existsSync(P.registerPlan) ? parseRegisterPlan(readFileSync(P.registerPlan, "utf8")) : null;
    return;
  }
  if (existsSync(P.registerPlan)) {
    // parseRegisterPlan throws token-first on corruption — the frozen plan is never silently re-derived
    ctx.registerPlan = parseRegisterPlan(readFileSync(P.registerPlan, "utf8"));
    runLog(P.runDir, { event: "register-plan", source: "frozen", version: ctx.registerPlan.plan_version, entries: ctx.registerPlan.entries.length });
    logFullyDeferredAxes(ctx.registerPlan, P, "frozen");
    return;
  }
  ctx.registerPlan = null;
  let compiled;
  try {
    let manifest = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"));
    // ── 647 — THE CLIENT'S OWN ELEMENT LEAVES THE CONFLICT ANALYSIS, ON EVIDENCE OR NOT AT ALL ─────
    //
    // The receipt is the ONLY thing that arms this. An absent, unreadable or unverified receipt plans
    // exactly as this compile did before the rule existed, which is the element searched in full — the
    // safe direction, and the one a client is never harmed by.
    let houseConfirmation = null;
    let houseReceipt = null;
    try { houseReceipt = JSON.parse(readFileSync(driverDir(P.runDir, HOUSE_ELEMENT_RECEIPT), "utf8")); }
    catch { houseReceipt = null; }
    if (houseReceipt?.verified === true) {
      const r = excludeHouseElement(manifest, { element: houseReceipt.element, remainder: houseReceipt.remainder });
      if (r.refused) {
        // VERIFIED OWNERSHIP AND STILL NOT APPLIED. The receipt answers who owns the element; the
        // transform answers whether this manifest's mark can survive the cut. Both must hold.
        runLog(P.runDir, { event: "house-element-not-applied", reason: r.refused, element: houseReceipt.element });
      } else {
        manifest = r.manifest;
        houseConfirmation = r.confirmation;
        runLog(P.runDir, { event: "house-element-excluded", element: houseReceipt.element,
          remainder: houseReceipt.remainder, dominant_element: manifest.dominant_element,
          evidence: (houseReceipt.records ?? []).length });
      }
    }
    let form = null;
    try { form = JSON.parse(readFileSync(P.formNeighbourhood, "utf8")); } catch { /* form band optional */ }
    compiled = compileRegisterPlan({
      manifest,
      // the SAME class resolution the recall checks use (job.classes ∪ per-mark classes, else the
      // profile's defaults) — the plan must never be scoped narrower than what the run enforces
      // Jurisdictions resolve EXACTLY as every other scope consumer resolves them (stages.mjs
      // scopeTerritories): the instructed territories, else the customer profile's defaults.
      // enqueue-schema documents "omit it to search the customer's default territories" and NOTHING
      // backfills job.jurisdictions, so `ctx.job.jurisdictions ?? []` compiled a plan with regions:[]
      // for the documented normal case. Harmless on corsearch (an absent region clause is a worldwide
      // sweep); fatal on a provider whose regions[] is mandatory, where every entry then errored on its
      // count probe and the whole plan joined MISSING at fan-in (review finding 11).
      // DECISION 18: the frame's added classes are no longer UNIONED into the plan's class scope. They
      // ride one identical-mark entry each instead, which is what an added class is supposed to cost —
      // unioning put every added class on every variant and every family. The instructed scope is what
      // it always was, and `addedClasses` only ever appends.
      job: { jobKey: ctx.run.slug, classes: inScopeClassList(ctx.job, ctx.profile).map(String), jurisdictions: registerJurisdictions(ctx.job, ctx.profile) },
      addedClasses: frameIdentifiedClassRows(P.runDir), frameMarkets: lastAcceptedMatterFrame(P.runDir)?.scope_jurisdictions ?? null,
      marketList: narrowingMarkets(instructedOrder(ctx.paths, ctx.job), ctx.profile),
      form, skillVersion: "clearance-register@spec48",
      // — WHICH ELEMENT THE EXCLUSION TOOK OUT, so the compile can make its form band unreachable
      // rather than merely unasked-for. Null unless the ownership receipt verified, which is the same
      // condition the exclusion itself runs under: an unverified receipt excludes nothing, and it must
      // not remove a band either.
      houseElement: houseConfirmation ? houseReceipt?.element : null,
      // phase 3 — the plan is compiled AGAINST THE ACTIVE PROVIDER's declared capabilities, so the
      // frozen artifact is executable by construction: the OR-stack split uses that provider's width,
      // jurisdictions are translated into its office vocabulary (EU→EM on Compumark), and a predicate
      // it cannot express is stamped `unsupported` (→ an error:true block → a deferred coverage row)
      // instead of quietly compiling into a weaker search.
      capabilities: registerCapabilities(ctx.register),
      // — the offices this contract covers that THIS BOX cannot reach (a composed provider with an
      // unconfigured member). Split out at compile so the reachable half still executes and the rest
      // rides the plan as a disclosed deferral, never as a silently narrower search.
      unavailableOffices: registerUnavailableOffices(registerCapabilities(ctx.register)),
    });
    // REQUIREMENT 3 — the element is still checked ONCE, as a confirmation of the client's own live
    // registrations rather than as a conflict sweep, so the exclusion is evidenced on the report by a
    // query that ran. Appended after the compile because it is not derived from the manifest: it is the
    // one question about the element the plan still owes.
    if (houseConfirmation && compiled?.entries) {
      const used = new Set(compiled.entries.map((e) => e.qid));
      compiled.entries.push({
        ...houseConfirmation,
        qid: mintSupplementalQid({ prefix: "house", term: houseConfirmation.term, used }),
        nice_classes: compiled.nice_classes ?? [],
        regions: compiled.regions ?? [],
      });
    }
  } catch (e) {
    // NEVER-KILL at mint time: no/malformed sibling or a class-less matter degrades to the legacy
    // path with a logged reason — the plan improves the run, it never turns delivery off.
    note(`register-plan: mint skipped (${String(e.message).slice(0, 100)}) — legacy register path this run`);
    runLog(P.runDir, { event: "register-plan-skipped", reason: String(e.message).slice(0, 120) });
    return;
  }
  // Every fresh run compiles its own plan from THIS run's manifest + job + form band. No prior run
  // of the same matter is consulted (see the header note): a plan is a question list, and it is
  // rebuilt from current inputs so a fix to any of those inputs actually reaches the next run.
  const { plan, action, added } = resolvePlanAgainstStore(null, compiled);
  // 2026-07-29 hardening — variants-model values the compiler refused to dispatch (an infix-star
  // family probe, a prose/label value) compile as DISCLOSED deferred rows, and the drop is loud at
  // mint time too: this event is the feedback to the authoring stage a silent nil search (or a dead
  // run at the freeze lint) never gave. The coverage skeleton discloses the same rows to judgment.
  const droppedVariants = plan.entries.filter((e) => e.unsupported === true && variantTermIssue(e.term));
  if (droppedVariants.length) {
    runLog(P.runDir, { event: "register-plan-variant-dropped",
      entries: droppedVariants.map((e) => ({ qid: e.qid, reason: String(e.unsupported_reason ?? "").slice(0, 200) })) });
    note(`register-plan: ${droppedVariants.length} variants-model value(s) compiled as disclosed deferred rows (un-searchable shape): ${droppedVariants.map((e) => e.qid).join(", ")}`);
  }
  // Repair-first D, hotfixed 2026-07-06 (The Quiet Trail e2e): the gate now applies the round's own
  // doctrine to itself — A REPAIRABLE CONDITION NEVER TERMINATES A RUN.
  //   - `repairable` issues (OR-stack width/name length): log-only from ANY provenance — the executor
  //     chunks oversized stacks at runtime (proven live). The 2026-07-06 failure was exactly this
  //     gate throwing on a 674-name entry INHERITED byte-identical from a pre-split July-3 store via
  //     the recall-monotone extension — a run the executor would have completed.
  //   - `unexecutable` issues (empty terms, unknown predicate, non-numeric classes, dangling guards):
  //     loud ONLY for freshly-authored entries — the whole plan on a fresh mint, ONLY the `added`
  //     entries on an extension. Inherited/reused entries are history, never a fresh compiler bug:
  //     log-only, never brick a matter over its own store.
  const allIssues = validatePlanFeasibility(plan, { capabilities: registerCapabilities(ctx.register) });
  if (allIssues.length) {
    const freshQids = new Set(action === "minted" ? plan.entries.map((e) => e.qid) : (added ?? []).map((e) => e.qid));
    const terminalIssues = allIssues.filter((i) => i.severity === "unexecutable" && freshQids.has(i.entry));
    runLog(P.runDir, { event: "register-plan-infeasible", source: action,
      repairable: allIssues.some((i) => i.severity === "repairable") || undefined,
      terminal: terminalIssues.length ? true : undefined,
      issues: feasibilityMessages(allIssues).slice(0, 6) });
    if (terminalIssues.length)
      throw new StageFailure("register-plan", `freshly compiled plan entries are unexecutable (a compiler bug, not a provider problem): ${feasibilityMessages(terminalIssues).slice(0, 4).join("; ")}`, undefined, { failClass: "deterministic" });
    note(`register-plan: ${allIssues.length} feasibility issue(s) tolerated (${action}; legacy/repairable — the executor chunks oversized stacks): ${feasibilityMessages(allIssues).slice(0, 2).join("; ")}`);
  }
  // (no cross-run store write — the run-dir freeze below is the plan's only durable home, and the
  // archived run keeps it for audit/replay exactly as before)
  // supplemental-lane contract (copper-lattice re-route): stamped on the RUN-DIR copy ONLY — the store
  // copy stays byte-identical (F2 reuse). Everything downstream gates on this flag (the propose-tool
  // stage message, the enumerate exclusion, the band_block_unplanned validator), so a frozen pre-flag
  // plan resumed under new code keeps its old contract end-to-end, and replay over archived runs never
  // sees the flag at all.
  const runPlan = { ...plan, contract: { ...(plan.contract ?? {}), supplemental_lane: 1 } };
  writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(runPlan, null, 2) + "\n");
  renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
  ctx.registerPlan = runPlan;
  runLog(P.runDir, { event: "register-plan", source: action, version: plan.plan_version, entries: plan.entries.length, added: added.length });
  note(`register plan ${action}: v${plan.plan_version}, ${plan.entries.length} entries${added.length ? ` (+${added.length} new)` : ""}`);
  logFullyDeferredAxes(runPlan, P, action);
  // ── deferred_coverage GETS A CONSUMER (review findings 1/10/14) ──────────────────────────────────
  // The compiler splits the matter's jurisdictions into {regions, deferred}. When SOME are covered, the
  // entries compile with the NARROWED regions and execute normally — every block joins `executed`, the
  // per-axis skeleton says "executed", and the coverage-ledger rows are model-authored prose that has
  // no signal the office was dropped. So a matter that asked for four territories was searched in two
  // and shipped a clean over the other two, recorded NOWHERE in the machine path (`deferred_coverage`
  // had zero consumers outside its own test). That is a false clean over an unsearched territory —
  // doctrine 2 and 3 inverted.
  // Consumer, in the ONE place that is code-derived rather than model-derived: the jurisdiction-scope
  // backstop's `searched` set. A jurisdiction the ACTIVE PROVIDER does not cover is, as a matter of
  // fact, not searched — so it is subtracted there and surfaces as under-coverage the run discloses.
  registerDeferredCoverage(ctx, plan);
}

/**
 * Record the plan's uncovered jurisdictions on ctx so the jurisdiction-scope backstop can subtract them
 * from the searched set, and log/note them. `plan.deferred_coverage` is [{jurisdiction, reason}].
 * Exported for test; never throws (a plan without the key is a fully-covered plan → no-op).
 */
export function registerDeferredCoverage(ctx, plan) {   // @internal
  const deferred = Array.isArray(plan?.deferred_coverage) ? plan.deferred_coverage : [];
  // A12: recorded in the CANONICAL vocabulary (UK→GB, EM/EUTM/EUIPO→EU) so the scope backstop's
  // subtraction meets extractSearchedJurisdictions on the same codes — never GB-vs-UK as two territories.
  ctx.registerDeferredJurisdictions = deferred.map((d) => canonicalJurisdictionCode(d?.jurisdiction)).filter(Boolean);
  if (!ctx.registerDeferredJurisdictions.length) return ctx.registerDeferredJurisdictions;
  try {
    runLog(ctx.paths.runDir, { event: "register-plan-deferred-coverage",
      jurisdictions: ctx.registerDeferredJurisdictions, regions: plan.regions ?? [] });
  } catch { /* logging is never allowed to kill the mint */ }
  note(`register plan: jurisdiction(s) ${ctx.registerDeferredJurisdictions.join(", ")} are NOT covered by the active register provider — `
    + `those territories were never searched on the register (searched: ${(plan.regions ?? []).join(", ") || "none"}). `
    + `They are a deferred coverage gap for judgment, never a clean negative.`);
  return ctx.registerDeferredJurisdictions;
}

// acceptance 5 — WHICH LADDER SETTING THIS RUN ACTUALLY USED, in the run record.
//
// Every other number acceptance 5 asks for is a count of what the ladder produced. This is the one that
// makes those counts mean anything: without the row in force, a later reader comparing two runs cannot
// tell a graded product from an ungraded one, and every measurement across the change is unattributable.
// `source` is the load-bearing field — `default-ungraded` says a product this build has no row for fell
// back to one-country values, which otherwise looks exactly like a deliberate setting.
export function depthLadderEvent(ctx) {   // @internal
  const depth = ctx?.depth ?? null;
  return {
    event: "depth-ladder",
    // `level` is what the frozen policy calls it; see depthFor()'s note.
    product: productKeyOf(ctx?.searchPolicy) || null,
    source: depth?.source ?? null,
    // the row, spread flat so a jq over run.jsonl reads one field per setting
    ...(depth ? Object.fromEntries(Object.entries(depth).filter(([k]) => k !== "source")) : {}),
  };
}
