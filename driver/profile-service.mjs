#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// profile-service.mjs — the per-customer config-edit write-service. The small access-gated surface
// the profiles editor page POSTs to. MIRRORS the retired quality write-service exactly:
//   • binds LOOPBACK only; the sole ingress is the Cloudflare Tunnel → CF Access (Entra IdP);
//   • re-verifies the CF Access JWT on EVERY request; rate-limits per identity;
//   • fail-closed: refuses to start without CLEAROTRON_OIDC_AUDIENCE plus a team or an issuer, and without the
//     allowed hosts (unless DEV+loopback). Any JWT-fronting proxy works — see PROFILE_OIDC_ISSUER.
//
// Endpoints:
//   GET  /profiles               — roster (key/name/industry). read-only.
//   GET  /profiles/:key          — the "what's configured" view (profile + context pack + derived floor/batch
//                                  + which framework is selected). read-only.
//   POST /profiles/:key/validate — server-side dry-run (validateProfileEdit + assertContextPackShape). NO write.
//   POST /profiles/:key/save     — the VALIDATED AUTO-COMMIT write: re-validate server-side, write
//                                  profiles/<key>.json (+ <key>.context.md), git-commit AS the CF-Access
//                                  identity, append an audit line. (Upsert: creates if absent.)
//   GET  /profiles/health        — bare liveness (no data, no auth) for systemd/Caddy.
//
// HARD RULES (enforced here, not just in the UI): the git author + audit "by" ALWAYS come from the verified
// Access identity (a body-supplied author is ignored); EVERY write re-runs the SAME load-time validators the
// driver uses (validateProfileEdit), so the UI can never persist a profile the driver would later reject; the
// reasoning core (risk-framework*.md / synthesis-rules.md) and the framework SELECTION are NOT editable here —
// they are git + review gated. The routing core (`makeProfileService`) is fs-only + injected git/audit so it
// unit-tests offline; auth + rate-limit are wired in the bootstrap and reuse the trademark-artifacts libs.

import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { resolvePort } from "../shared/listen.mjs";   // — the port SOURCE, decided once
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { storeInRepo, storeOutsideRepoMessage, makeCommittableAudit, commitWithAuditRow, makeStoreCommit } from "../shared/store-in-repo.mjs";   //
import { customerStoreDir, customerStoreLine } from "../shared/customer-store.mjs";   // — one store for the surface and the runs
import {
  loadProfiles as loadProfilesDefault, validateProfileEdit as validateProfileEditDefault,
  loadProjects as loadProjectsDefault, resolveEffectiveProfile, PROJECT_KEYS,
  assertProfileKey, derivedFloor, derivedBatchSize, CONTEXT_PACK_FILE, DEFAULT_DELIVERY_TEMPLATE,
} from "./profiles.mjs";

import { DEFAULT_FRAMEWORK, DEFAULT_WORKED_EXAMPLES, loadFrameworkManifest } from "./framework.mjs";
import { config } from "./driver.config.mjs";
import { productRows } from "./product-rows.mjs";   // the offering, so the editor never hand-types a menu
import { dirname as pathDirname } from "node:path";
import { fileURLToPath as toPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { envFrom } from "../shared/env-aliases.mjs";   // — read the audience by either spelling
import { accessAudience, audienceLabel } from "../shared/access-audience.mjs";   // — F54; jose-free on purpose

// doc 50 — the manifest beside each framework file: the vocabulary the profile page shows (title, band
// ladder, entity, source deck). Best-effort: a missing/corrupt manifest serves null and the page falls
// back to the filename — the editor must never 500 because a framework asset is mid-change.
//
// THE BARE CATCH IS WHY THIS TOOK WEEKS TO FIND. Serving null is right — the editor must not 500 over a
// framework asset mid-change — but swallowing the REASON meant a deployment whose skills overlay pointed
// at the wrong tree looked, from every log, exactly like a customer who simply has no custom framework.
// The page said "could not be read" and nothing anywhere said why. Log it once, at the point of loss.
const DRIVER_DIR = pathDirname(toPath(import.meta.url));
function manifestFor(fwPath) {
  try { return loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath); }
  catch (e) {
    console.error(`[profile-service] framework manifest unreadable for ${fwPath}: ${String(e?.message ?? e)} `
      + `(resolved to ${config.resolveSkillPath(fwPath)})`);
    return null;
  }
}

// doc 50 — band MEANINGS for the profile page's "What the bands mean" box: display-only prose lifted from
// the framework deck at VIEW time, keyed off the already-validated manifest band labels. HARD LINE: never a
// manifest field, never consumed by rating code — the deck prose stays the single home of the framework's
// meaning (the judgment mandate); this is presentation, read fresh per view. Best-effort like manifestFor:
// ANY miss (missing/garbled deck, one band without its row/section) returns null and the page simply omits
// the box — the editor must never 500 because a framework asset is mid-change. The tests parse the REAL
// shipped decks, so a deck edit that breaks extraction fails CI instead of silently blanking the box.
const stripMd = (s) => String(s ?? "").replace(/\*+/g, "").trim();

// matrix-shaped decks (aurora): the deck's "Band meanings" table is the only table whose FIRST cell is
// exactly the band label (the matrix table suffixes its labels with the deck's internal indices, e.g.
// "**Very High** *(5)*") — take that row's cells as { band, meaning, response }.
function matrixBandMeanings(deck, manifest) {
  const tableRows = deck.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l));
  const out = [];
  for (const b of manifest.bands) {
    const want = b.label.trim().toLowerCase();
    let hit = null;
    for (const line of tableRows) {
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(stripMd);
      if (cells.length >= 3 && cells[0].toLowerCase() === want && cells[1] && cells[2]) {
        hit = { band: b.label, meaning: cells[1], response: cells[2] };
        break;
      }
    }
    if (!hit) return null;   // ANY miss ⇒ no partial box
    out.push(hit);
  }
  return out;
}

// bands-shaped decks (house, zephyr): each band lives under its own heading ("## VERY HIGH RISK") — find
// the section whose heading STARTS WITH the band label ("High" must never steal "VERY HIGH RISK") and lift
// EVERY rung the band states, in the deck's own order.
//
// ── IT USED TO LIFT ONE BULLET OF THREE ─────────────────────────────────────
//
// The regex here was `**Potential outcomes**` and nothing else, so the portal's "What the bands mean"
// box showed consequences only: no "prior rights owner is very likely to win", no "no credible defences
// available", none of the market-overlap or coexistence read. The reviewing lawyer read that screen and
// concluded the legal assessment had been deleted from her framework. It had not — the deck on disk is
// complete and the engine reasons over all of it — but the one surface a lawyer uses to check WHICH
// framework rates their matters misrepresented it, in the direction most likely to destroy confidence.
//
// ── AND IT HARD-CODED ONE ENGLISH PHRASE, WHICH IS THE SECOND DEFECT ─────────────────────────────
//
// A deck that spells its third rung differently matched nothing, and a miss returned null, and null
// renders as NO SECTION AT ALL. So a rename would have silently removed the whole box rather than
// degrading — and the completed deck coming in Part 2 renames exactly that rung.
//
// The label is now whatever the deck wrote, so no phrase is privileged. What survives from the old
// design is the protection it was actually for: a band whose section is missing, or whose section
// states no rungs at all, is a GARBLED deck and still returns null, because a half-shown framework
// misleads worse than an absent one. A merely renamed rung is not that case.
function bandsBandMeanings(deck, manifest) {
  const re = /^#{1,6}[ \t]*([^\n]+)$/gm;
  const heads = [];
  for (let m; (m = re.exec(deck)); ) heads.push({ text: stripMd(m[1]), start: m.index, end: m.index + m[0].length });
  const sections = heads.map((h, i) => ({ head: h.text.toLowerCase(), body: deck.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : deck.length) }));
  const out = [];
  for (const b of manifest.bands) {
    const want = b.label.trim().toLowerCase();
    const sec = sections.find((s) => s.head === want || (s.head.startsWith(want) && !/[a-z0-9]/i.test(s.head.charAt(want.length))));
    if (!sec) return null;
    // Every top-level "- **Label.** text" bullet the band states, in the deck's order. The label is the
    // deck's own word for the rung; nothing here decides which rungs exist or what they may be called.
    const rungs = [];
    for (const m of sec.body.matchAll(/^[ \t]*[-*][ \t]+\*\*([^*]+?)\*\*[ \t]*(.+)$/gm)) {
      const label = stripMd(m[1]).replace(/[.:]\s*$/, "").trim();
      const text = stripMd(m[2]).trim();
      if (label && text) rungs.push({ label, text });
    }
    if (!rungs.length) return null;   // a section stating no rungs is a garbled deck — see above
    // `meaning` IS KEPT, and it is not vestigial: `driver/profile-page.html` renders these rows too and
    // reads exactly this field, so dropping it would blank a second surface that nobody asked me to
    // change. It carries the LAST rung — the consequences one in both the shipped deck and the completed
    // one — so a reader that only knows `meaning` shows what it showed before, across the rename.
    out.push({ band: b.label, meaning: rungs[rungs.length - 1].text, rungs });
  }
  return out;
}

/** Pure extraction (exported for the tests): deck text + validated manifest → [{ band, meaning, response? }]
 *  in manifest band order, or null on ANY miss. Never throws. */
export function extractBandMeanings(deckText, manifest) {
  try {
    if (!deckText || !manifest || !Array.isArray(manifest.bands) || !manifest.bands.length) return null;
    return manifest.structure?.kind === "matrix"
      ? matrixBandMeanings(String(deckText), manifest)
      : bandsBandMeanings(String(deckText), manifest);
  } catch { return null; }
}

function bandMeaningsFor(fwPath, manifest) {
  if (!manifest) return null;
  try { return extractBandMeanings(readFileSync(config.resolveSkillPath(fwPath), "utf8"), manifest); }
  catch (e) {
    // Same reasoning as manifestFor: a silent null here blanks the "What the bands mean" box while the
    // title still renders, so the page looks complete and is missing half the framework.
    console.error(`[profile-service] framework deck unreadable for ${fwPath}: ${String(e?.message ?? e)}`);
    return null;
  }
}

// CODE-OWNED fields — the framework SELECTION. The editor page has no form fields for these, so a save
// assembled from the form omits them, and defaultWriteProfile rewrites the whole file: the 2026-07-04/05 UI
// saves (587324ab, cea0ca2f, c59030a1) silently stripped frameworkPath/workedExamplesPath from zephyr and
// aurora, flipping both customers to the house-default framework. The on-disk value ALWAYS wins here — a
// client body can neither drop, change, nor introduce a framework selection (git + review gated, per the
// header rules). Applied to validate AND save so the dry run judges exactly what a save would write.
// Search-depth spine: allowedRecipes/jxPolicy/runCaps have NO form fields on the editor page — without
// the preserve they would be silently STRIPPED on every UI save (the exact 2026-07-04 frameworkPath bug
// class: a save flipped two customers to the house framework). They stay CODE_OWNED until the editor
// grows real fields. defaultProduct LEFT this list in Phase 3a — the page now has a real dropdown
// for it (an empty selection deliberately unsets it back to the Generic default).
const CODE_OWNED_FIELDS = ["frameworkPath", "workedExamplesPath", "allowedRecipes", "jxPolicy", "runCaps"];
// defaultProduct left CODE_OWNED in 3a (the page has a real dropdown) — but OMISSION IS NOT
// CONSENT (review 2026-07-18: a pre-3a page/stale tab omits the field entirely and would silently
// strip it, the exact 2026-07-04 bug class). The contract: absent ⇒ preserve from disk; the 3a page
// sends "" for an explicit unset; a value sets it. Applied to validate AND save.
function normalizeDefaultProduct(incoming, existing) {
  if (incoming.defaultProduct === undefined) {
    if (existing?.defaultProduct !== undefined) incoming.defaultProduct = existing.defaultProduct;
  } else if (incoming.defaultProduct === "") {
    delete incoming.defaultProduct;
  }
  return incoming;
}
// marketplaceDensity has NO CONTROL ON ANY SURFACE since the owner ruling of 2026-08-29 ("get rid of it
// completely. there is no such thing as staff only"), and it is NOT code-owned — so without this it would
// be stripped on the next save of any profile that has one.
//
// THAT IS NOT A TIDINESS POINT. `dense` is what holds a byte-heavy marketplace's verbatim stdout inside
// the worker output channel; losing it silently re-arms a measured truncation crash (the incident is cited
// above profiles.mjs gridCellBudget). profile-page.html RECONSTRUCTS its payload from form inputs, so
// removing the input removed the key from every save it makes — the same shape as the archived-state and
// defaultProduct preserves either side of this.
//
// The on-disk value ALWAYS wins, including over a body that sends one: no surface may set this field any
// more, so a body carrying it is a stale tab or a hand-rolled call, and neither is an instruction.
// A LIST, BECAUSE THIS IS NOW A CLASS AND NOT AN INCIDENT. Every key here is a real profile field with
// NO CONTROL ON ANY SURFACE, and profile-page.html reconstructs its payload from the inputs it has — so
// each one would be stripped on the next staff save of any profile carrying it.
//
//   marketplaceDensity  the control was removed by owner ruling; the value sizes
//                       the grid batch and losing it re-arms a measured truncation crash.
//   demoData            never had a control; losing it turns a demo account into
//                       one indistinguishable from a client, which is the exact failure the marker
//                       exists to prevent — and it fails silent, because a stripped marker looks like
//                       a real account rather than like an error.
//
// Adding a key here rather than a second bespoke function on purpose: the third one would otherwise be
// written by somebody who never saw the first two.
const NO_CONTROL_KEYS = ["marketplaceDensity", "demoData"];

function preserveUncontrolled(incoming, existing) {
  for (const k of NO_CONTROL_KEYS) {
    if (existing?.[k] !== undefined) incoming[k] = existing[k];
    else delete incoming[k];
  }
  return incoming;
}
function preserveCodeOwned(incoming, existing) {
  const merged = { ...incoming };
  for (const f of CODE_OWNED_FIELDS) {
    if (existing?.[f] !== undefined) merged[f] = existing[f];
    else delete merged[f];
  }
  return merged;
}

// ── the routing core (pure-ish: fs via the injected profile dir; git/audit injected) ─────────────────────
export function makeProfileService({
  profileDir,
  // ── READS RESOLVE THE DEPLOYMENT'S LAYERED VIEW; WRITES KEEP THE STORE ────
  //
  // The engine's no-argument loadProfiles() layers the configured store OVER the bundled base, with
  // `generic` falling through by name — that is what makes the wizard's empty store a working install.
  // This service used the explicit-dir form on its READ routes too, which bypasses layering by design,
  // so every Profiles screen 500'd with "generic.json is REQUIRED" on the exact store the wizard had
  // just described as working (the owner's fresh install, 2026-08-31, six times in one session).
  //
  // `readLayered` is a CONSTRUCTION fact, not a mode: the portal (serving the deployment whose store
  // profileDir names) passes true; a fixture that built a directory and asserts on precisely that
  // roster keeps the explicit read it always had. It governs every read of EXISTING state — including
  // the validate/save preservation reads, because "existing" is what the reader was shown, and
  // preserving code-owned fields from a store that lacks the shown-through profile would silently drop
  // them on the first override-by-name save (the 2026-07-04 omitted-field class). The WRITE itself
  // still lands in profileDir — that is the override-by-name mechanism working, not a leak.
  readLayered = false,
  loadProfiles = loadProfilesDefault,
  loadProjects = loadProjectsDefault,           // spec 62 — project overlays under a customer
  validateProfileEdit = validateProfileEditDefault,
  writeProfile = defaultWriteProfile,
  writeProject = defaultWriteProject,           // spec 62
  gitCommit = () => null,        // ({ files, message, author }) => sha — injected (no child_process in the core)
  audit = () => {},             // ({ event, key, by, fields }) => void
} = {}) {
  const isStr = (v) => typeof v === "string";
  const readPack = (key) => {
    const p = join(profileDir, CONTEXT_PACK_FILE(key));
    return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
  };
  // Every read of existing state goes through here — one author for which view a route answers from.
  const resolveExisting = () => (readLayered ? loadProfiles({ force: true }) : loadProfiles({ dir: profileDir, force: true }));
  // The read-only "what's configured" view — the raw editable fields + the DERIVED values (shown, never
  // stored) + which framework is IN FORCE for this customer (doc 50: their own if on file, else the house
  // default — the page states which, with the manifest's ladder/entity/source; selection stays read-only).
  const view = (profile) => {
    const fwPath = profile.frameworkPath ?? DEFAULT_FRAMEWORK;
    const manifest = manifestFor(fwPath);
    // display-only deck prose (doc 50) — omitted entirely on any extraction miss, never a 500
    const bandMeanings = bandMeaningsFor(fwPath, manifest);
    return {
      key: profile.key,
      profile: stripDerived(profile),
      contextPack: readPack(profile.key),
      derived: { minCellsPerVariant: derivedFloor(profile), batchSize: derivedBatchSize(profile) },
      framework: {
        path: fwPath,
        // CUSTOM MEANS "NOT THE GENERIC DEFAULT", which is what the word means to the lawyer reading the
        // page and what the engine's own run record has always meant (pipeline.mjs writes
        // `custom: fwPath !== DEFAULT_FRAMEWORK`). This read it as "the field is set at all", and the
        // two disagreed silently for as long as nothing set the field to the default explicitly.
        //
        // made something set it: the onboarding verb sets frameworkPath ALWAYS, per
        // the owner's ruling, so a brand owner onboarded without their own framework carries the house
        // default as an explicit value. Under the old reading the box below then said "Custom
        // framework: Generic default — this brand owner's OWN framework rates every matter for them, in
        // its own words" about a client who has no framework of their own. That box was rewritten once
        // already for the inverse lie (it told a lawyer their client was rated under the house
        // framework when the profile said otherwise); this is that defect pointing the other way.
        //
        // KNOWN LIMIT, stated rather than hidden: a brand owner who DELIBERATELY chose the house
        // default is no longer distinguishable from one who never chose. The run record never could
        // draw that distinction either, and the page's prose never offered it. Making a deliberate
        // default visible is a new field and a design decision, not a side effect of this comparison.
        custom: fwPath !== DEFAULT_FRAMEWORK,
        manifest,
        ...(bandMeanings ? { bandMeanings } : {}),
        workedExamples: profile.workedExamplesPath ?? DEFAULT_WORKED_EXAMPLES,
        editable: false,
      },
      deliveryTemplate: profile.delivery?.template ?? DEFAULT_DELIVERY_TEMPLATE,
    };
  };

  async function route(method, path, identity, body = {}) {
    const by = identity?.email || "unknown";
    const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);   // ["profiles", key?, action?]
    if (parts[0] !== "profiles") return { status: 404, json: { error: "not_found" } };

    // GET /profiles — roster
    if (parts.length === 1) {
      if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
      const profiles = resolveExisting();
      // THE OFFERING RIDES THE ROSTER. The editor has to render a `defaultProduct` menu, and a menu
      // hand-typed into profile-page.html is a second list of the four products — the exact drift the
      // registry was collapsed to one source to end (the page carried a level menu of five retired keys
      // for as long as it took anyone to notice that every save it produced was refused). One row shape,
      // productRows(), the same one the composer and the recipe service read.
      return { status: 200, json: {
        profiles: [...profiles.values()].map((p) => ({ key: p.key, name: p.name, industry: p.industry ?? "" })),
        products: productRows(),
      } };
    }

    const key = parts[1];
    const action = parts[2];

    // GET /profiles/:key — read-only view
    if (parts.length === 2) {
      if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
      const profiles = resolveExisting();
      if (!profiles.has(key)) return { status: 404, json: { error: "unknown_profile" } };
      return { status: 200, json: view(profiles.get(key)) };
    }

    // ── spec 62 — project overlays: /profiles/:customer/projects[/:project[/validate|save]] ──────────────
    // A project is a SPARSE OVERLAY under its customer. Reads show the overlay beside the customer's inherited
    // values + the effective merge + per-field origins; writes re-run the SPARSE validators server-side, so the
    // customer-only-key rejection is a real 400 (the F7 deny-unknown discipline one level down — NOT the
    // silent preserveCodeOwned path, which is for a customer editing its OWN framework selection).
    if (action === "projects") {
      const customer = key;
      const profiles = resolveExisting();
      if (!profiles.has(customer)) return { status: 404, json: { error: "unknown_profile" } };
      const projects = loadProjects({ dir: profileDir, profiles, force: true });
      const project = parts[3];
      const pAction = parts[4];

      // GET /profiles/:customer/projects — the customer's project list
      if (parts.length === 3) {
        if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
        const list = [...projects.values()].filter((o) => o.customerKey === customer)
          // Archived rows are SHOWN, MARKED here — this is the STAFF door (profile-page.html reaches it
          // directly, outside the portal), and staff need to see an archived project to un-archive it.
          // Hiding archived projects from CLIENTS is the portal's job (portal-upstream.listProjects),
          // exactly as the saved-search list splits staff and client views.
          .map((o) => ({ key: o.projectKey, name: o.projectName, archived: Boolean(o.archived) }))
          .sort((a, b) => a.key.localeCompare(b.key));
        return { status: 200, json: { customer, projects: list } };
      }

      const fq = `${customer}/${project}`;
      // GET /profiles/:customer/projects/:project — overlay + inherited + effective + origins (never a 2nd full copy)
      if (parts.length === 4) {
        if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
        const overlay = projects.get(fq);
        if (!overlay) return { status: 404, json: { error: "unknown_project" } };
        const cust = profiles.get(customer);
        const { profile: effective, origins } = resolveEffectiveProfile({ profileKey: customer, projectKey: project }, { profiles, projects });
        return { status: 200, json: {
          customer, customerName: cust.name, project,
          overlay: overlayEditable(overlay),
          contextPack: overlay.contextPack ?? "",
          inherited: Object.fromEntries(PROJECT_KEYS.map((k) => [k, cust[k] ?? null])),
          effective: Object.fromEntries(PROJECT_KEYS.map((k) => [k, effective[k] ?? null])),
          origins,
          derived: { minCellsPerVariant: derivedFloor(effective), batchSize: derivedBatchSize(effective) },
        } };
      }

      // POST /profiles/:customer/projects/:project/{validate,save}
      if (parts.length !== 5 || (pAction !== "validate" && pAction !== "save"))
        return { status: 404, json: { error: "not_found" } };
      if (method !== "POST") return { status: 405, json: { error: "method_not_allowed" } };
      const overlayBody = body.profile;
      const ctx = isStr(body.contextPack) ? body.contextPack : "";
      if (!overlayBody || typeof overlayBody !== "object" || Array.isArray(overlayBody))
        return { status: 400, json: { error: "profile (overlay object) is required in the body" } };
      const exists = projects.has(fq);
      const errKey = `projects/${customer}/${project}`;   // ⇒ error prefix "profiles/projects/<customer>/<project>.json"
      const priorOverlay = exists ? projects.get(fq) : null;
      // The overlay-side preserves (review 2026-07-17). Applied to validate AND save so the dry run judges
      // exactly what a save would write — the customer-side rule at normalizeDefaultProduct/preserveCodeOwned.
      //
      // defaultProduct: the project editor has no field for it yet, so an existing overlay's value must
      // survive a form save that omits it (the same bug class as the customer-side CODE_OWNED preserve;
      // defaultProduct is the only spine key a project may carry).
      if (overlayBody.defaultProduct === undefined && priorOverlay?.defaultProduct !== undefined)
        overlayBody.defaultProduct = priorOverlay.defaultProduct;
      // marketplaceDensity: same rule, and now permanent rather than "yet" — the control was removed from
      // both surfaces by owner ruling, so an overlay's value can only ever come from the file it is in.
      preserveUncontrolled(overlayBody, priorOverlay);
      // ARCHIVE STATE IS STICKY AGAINST OMISSION — recipe-service.mjs's discipline verbatim: un-archiving
      // takes an EXPLICIT archived:false, never a body that simply lacks the key. This is not theoretical:
      // profile-page.html's collectProject() RECONSTRUCTS the overlay from form inputs rather than seeding
      // from the server object, so every save from the staff page omits `archived`. Without this line,
      // opening an archived project there and pressing Save would silently un-archive it.
      if (priorOverlay?.archived && overlayBody.archived === undefined) overlayBody.archived = true;

      if (pAction === "validate") {
        const v = validateProfileEdit(errKey, overlayBody, ctx, { sparse: true });
        let keyError = null;
        if (!exists) { try { assertProfileKey(project); } catch (e) { keyError = String(e.message); } }
        const errors = keyError ? [keyError, ...v.errors] : v.errors;
        return { status: 200, json: { ok: errors.length === 0, errors, isNew: !exists } };
      }

      // save — the validated AUTO-COMMIT write (sparse validators; customer-only keys 400 here)
      if (!exists) { try { assertProfileKey(project); } catch (e) { return { status: 400, json: { error: String(e.message) } }; } }
      const v = validateProfileEdit(errKey, overlayBody, ctx, { sparse: true });
      if (!v.ok) return { status: 400, json: { error: "validation_failed", errors: v.errors } };
      // The write lands FIRST (atomic temp+rename); a git failure after it must never hide the mutation
      // behind a 500 — the overlay is LIVE the moment it is renamed (every loadProjects door reads
      // force-fresh), so the response says written:true with the commit error named, and the audit line
      // records commit:null either way. Before this, gitCommit sat OUTSIDE any try/catch: a git failure
      // 500'd the request AFTER the rename and skipped the audit call below entirely, leaving a live
      // overlay with no record of who changed it or when (the "reported outcome diverges from disk truth"
      // class — recipe-service.mjs fixed the identical hole one level down).
      const { files } = writeProject({ profileDir, customer, project, overlay: overlayBody, contextPack: ctx });
      // The transition is encoded in the message so the config store's git log reads as an audit trail —
      // the same three words saved searches emit (an un-archive reads as "update" there too).
      const transition = exists ? (overlayBody.archived && !priorOverlay?.archived ? "archive" : "update") : "create";
      const message = `chore(prelim): ${transition} project ${customer}/${project} (via config UI, by ${by})`;
      // — the row rides IN the commit, so it no longer names a sha. shared/store-in-repo.mjs says why.
      const { commit, commitError } = commitWithAuditRow({ audit, gitCommit, files, message, by,
        row: { event: exists ? "project-update" : "project-create", key: fq, by, fields: Object.keys(overlayBody),
          archived: Boolean(overlayBody.archived) } });
      return { status: 200, json: { written: true, created: !exists, customer, project, commit,
        ...(commitError ? { commitError: `saved and LIVE, but the git commit failed (${commitError}) — fix the repo state; the audit line records the gap` } : {}) } };
    }

    if (parts.length !== 3 || (action !== "validate" && action !== "save"))
      return { status: 404, json: { error: "not_found" } };
    if (method !== "POST") return { status: 405, json: { error: "method_not_allowed" } };

    // body: { profile: {...}, contextPack?: "" }. NEVER trust a body-supplied author/by.
    const profile = body.profile;
    const contextPack = isStr(body.contextPack) ? body.contextPack : "";
    if (!profile || typeof profile !== "object" || Array.isArray(profile))
      return { status: 400, json: { error: "profile (object) is required in the body" } };

    // POST /profiles/:key/validate — dry run, NO write (the propose step)
    if (action === "validate") {
      const profilesV = resolveExisting();
      const exists = profilesV.has(key);
      normalizeDefaultProduct(profile, exists ? profilesV.get(key) : null);
      preserveUncontrolled(profile, exists ? profilesV.get(key) : null);
      const effective = preserveCodeOwned(profile, exists ? profilesV.get(key) : null);
      const v = validateProfileEdit(key, effective, contextPack);
      // a brand-new key must also be a safe slug (it becomes a filename); surface that in the dry run
      let keyError = null;
      if (!exists) { try { assertProfileKey(key); } catch (e) { keyError = String(e.message); } }
      const errors = keyError ? [keyError, ...v.errors] : v.errors;
      return { status: 200, json: { ok: errors.length === 0, errors, isNew: !exists } };
    }

    // POST /profiles/:key/save — the validated AUTO-COMMIT write (the confirm step)
    const profiles = resolveExisting();
    const exists = profiles.has(key);
    if (!exists) { try { assertProfileKey(key); } catch (e) { return { status: 400, json: { error: String(e.message) } }; } }
    // re-validate SERVER-SIDE (never trust the client) with the exact load-time guards, on the EFFECTIVE
    // profile (client body + preserved code-owned fields) — exactly what will be written
    normalizeDefaultProduct(profile, exists ? profiles.get(key) : null);
    preserveUncontrolled(profile, exists ? profiles.get(key) : null);
    const effective = preserveCodeOwned(profile, exists ? profiles.get(key) : null);
    const v = validateProfileEdit(key, effective, contextPack);
    if (!v.ok) return { status: 400, json: { error: "validation_failed", errors: v.errors } };

    const { files } = writeProfile({ profileDir, key, profile: effective, contextPack });
    // The write is atomic and LIVE the instant it renames — the next run freezes THIS file. An
    // unguarded gitCommit therefore reported the opposite of the truth: a commit failure (index.lock
    // contention with the portal, the standalone services or the nightly backup, or any other git
    // fault) threw out of the handler, so the user was told "Nothing was written. Try again shortly."
    // about a profile that was already governing production, and the audit() call below was skipped —
    // leaving no record of who changed it. Same guard the project branch above already carries.
    const message = `chore(prelim): ${exists ? "update" : "create"} customer profile ${key} (via config UI, by ${by})`;
    // — the row rides IN the commit, so it no longer names a sha. shared/store-in-repo.mjs says why.
    const { commit, commitError } = commitWithAuditRow({ audit, gitCommit, files, message, by,
      row: { event: exists ? "profile-update" : "profile-create", key, by, fields: Object.keys(effective) } });
    return { status: 200, json: { written: true, created: !exists, commit, key,
      ...(commitError ? { commitError: `saved and LIVE, but the git commit failed (${commitError}) — fix the repo state; the audit line records the gap` } : {}) } };
  }
  return { route };
}

// DERIVED values (floor/batch) are never stored in the file (single source of truth) — strip them from a
// loaded profile before returning it as the editable form, and drop the internal `key` field.
function stripDerived(profile) {
  const { key, minCellsPerVariant, batchSize, contextPack, ...editable } = profile;
  void key; void minCellsPerVariant; void batchSize; void contextPack;
  return editable;
}

// spec 62 — the editable overlay (the deltas the page edits): projectName + whatever PROJECT_KEYS the overlay
// sets, minus loadProjects' internal meta (projectKey/customerKey come from the path; contextPack is its own field).
function overlayEditable(overlay) {
  const { projectKey, customerKey, contextPack, ...editable } = overlay;
  void projectKey; void customerKey; void contextPack;
  return editable;
}

// Default fs writer (temp+rename, atomic). Writes profiles/<key>.json and, when prose is supplied, the
// sibling <key>.context.md; an empty pack removes an existing sibling (clearing the pack). Returns the files
// touched (for the git commit). Injected-overridable so the routing core unit-tests with no real fs writes.
export function defaultWriteProfile({ profileDir, key, profile, contextPack }) {
  const files = [];
  const jsonPath = join(profileDir, `${key}.json`);
  writeFileSync(`${jsonPath}.tmp`, JSON.stringify(profile, null, 2) + "\n");
  renameSync(`${jsonPath}.tmp`, jsonPath);
  files.push(jsonPath);
  const packPath = join(profileDir, CONTEXT_PACK_FILE(key));
  if (contextPack && String(contextPack).trim()) {
    writeFileSync(`${packPath}.tmp`, String(contextPack).trim() + "\n");
    renameSync(`${packPath}.tmp`, packPath);
    files.push(packPath);
  } else if (existsSync(packPath)) {
    rmSync(packPath);
    files.push(packPath);
  }
  return { files };
}

// spec 62 — the project overlay writer: profiles/projects/<customer>/<project>.json (+ sibling <project>.context.md).
// Same temp+rename atomicity + empty-pack-removes-sibling contract as defaultWriteProfile; mkdir -p the customer dir.
export function defaultWriteProject({ profileDir, customer, project, overlay, contextPack }) {
  const dir = join(profileDir, "projects", customer);
  mkdirSync(dir, { recursive: true });
  const files = [];
  const jsonPath = join(dir, `${project}.json`);
  writeFileSync(`${jsonPath}.tmp`, JSON.stringify(overlay, null, 2) + "\n");
  renameSync(`${jsonPath}.tmp`, jsonPath);
  files.push(jsonPath);
  const packPath = join(dir, CONTEXT_PACK_FILE(project));
  if (contextPack && String(contextPack).trim()) {
    writeFileSync(`${packPath}.tmp`, String(contextPack).trim() + "\n");
    renameSync(`${packPath}.tmp`, packPath);
    files.push(packPath);
  } else if (existsSync(packPath)) {
    rmSync(packPath);
    files.push(packPath);
  }
  return { files };
}

// ── node req/res plumbing (auth → body → route → response) — from the retired write-service ──────────────
async function readJsonBody(req, limitBytes = 131072) {
  return await new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on("data", (c) => { len += c.length; if (len > limitBytes) { reject(new Error("body_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { const s = Buffer.concat(chunks).toString("utf8").trim(); if (!s) return resolve({}); try { resolve(JSON.parse(s)); } catch { reject(new Error("body_unparseable")); } });
    req.on("error", reject);
  });
}

// `authHeader` is a PARAMETER, not a module const, and the first draft of got that wrong: the
// header name is resolved inside the bootstrap block far below, and this factory is module scope, so
// `req.headers[AUTH_HEADER]` referenced a binding that does not exist here. `node --check` parses it,
// every test passes, and it is a ReferenceError on the first authenticated request — the exact failure
// ci.yml's `lint:driver` step was added to catch, which is what caught it. Default preserved so a
// caller that passes nothing behaves exactly as before.
export function makeHttpHandler({ verify, limiter, service, authHeader = "cf-access-jwt-assertion", log = () => {} }) {
  const send = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(b) }); res.end(b); };
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/profiles/health") return send(res, 200, { ok: true });
      const identity = verify ? await verify(req.headers[authHeader]) : { email: "dev@local" };
      if (limiter && !limiter.take(identity.email)) return send(res, 429, { error: "rate_limited" });
      let body; try { body = await readJsonBody(req); } catch (e) { return send(res, 400, { error: String(e.message) }); }
      const r = await service.route(req.method, url.pathname, identity, body);
      return send(res, r.status, r.json);
    } catch (e) {
      if (e && e.name === "AuthError" && Number.isInteger(e.status)) return send(res, e.status, { error: e.message });
      log(`500 ${String(e?.message || e)}`);
      return send(res, 500, { error: "internal" });
    }
  };
}

// ── bootstrap (only when executed directly) ─────────────────────────────────────────────────────────────
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  // — the translation has moved to a side-effecting `import "../shared/env-local.mjs"` at the top
  // of this file. The call that stood here claimed to run "before any config read" and did not: a body
  // call runs after every static import has evaluated, and this service statically reaches
  // `driver.config.mjs` and `profiles.mjs`, both of which capture at module top. It reads no dotfile
  // either way — that load is gated on isCliEntry(argv[1]) and this entry is not on CLI_ENTRIES.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const log = (...a) => process.stderr.write(`[profile-service] ${a.join(" ")}\n`);
  // — resolved through the shared helper so the SOURCE travels with the number. "18794" and
// "18794 because nobody said otherwise" are different addresses to an operator, and only the
// second one is a guess at which instance this is.
const PORT_CHOICE = resolvePort({ value: process.env.PROFILE_PORT, name: "PROFILE_PORT", fallback: 18794 });
const PORT = PORT_CHOICE.port;
  const HOST = process.env.PROFILE_HOST || "127.0.0.1";
  const AUTH_DISABLED = process.env.PROFILE_AUTH_DISABLED === "1";
  const DEV = process.env.PROFILE_DEV === "1";
  const TEAM = process.env.CF_ACCESS_TEAM || "";
  // — F54. A deployment runs one Access application per audience; jose has
  // always accepted a list. `accessAudience` keeps a STRING for 0 or 1 so the `!AUD` guard below
  // stays fail-closed — an empty array would be truthy and open it.
  const AUD = accessAudience(envFrom(process.env, "CLEAROTRON_OIDC_AUDIENCE"));
  // ── — BRING YOUR OWN LOGIN PROVIDER. The same four values the staff MCP face reads as
  // TRADEMARK_MCP_* and the portal reads as PORTAL_*, under this service's own prefix. Unset ⇒ the
  // Cloudflare Access shapes derived from CF_ACCESS_TEAM, so no deployment configured today changes.
  //
  // `makeAccessVerifier` has ALWAYS accepted issuer/jwksUrl/emailClaim — this service simply never
  // passed them, which is how one product shipped a provider-agnostic API face and three single-vendor
  // services beside it. Owner ruling 2026-08-23: "we can't launch with an identity vendor, they bring
  // their own… they pick their own."
  const OIDC_ISSUER = process.env.PROFILE_OIDC_ISSUER || "";
  const JWKS_URL = process.env.PROFILE_JWKS_URL || "";
  const EMAIL_CLAIM = process.env.PROFILE_EMAIL_CLAIM || "email";
  // LOWERCASED WHEN READ, for the reason the portal's own note records: Node lowercases incoming
  // header names, so a verbatim `Cf-Access-Jwt-Assertion` would match nothing and refuse every
  // correctly authenticated user — a fail-CLOSED misconfiguration that looks like a broken proxy.
  const AUTH_HEADER = (process.env.PROFILE_AUTH_HEADER || "cf-access-jwt-assertion").toLowerCase();
  // NO example.com default (see portal-service.mjs, which already made this move): a forgotten env
  // silently denies every real identity at the edge while looking configured.
  const DOMAINS = (process.env.MCP_ALLOWED_EMAIL_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
  // — one store for the surface and the runs; PROFILE_DIR is retired, not
  // fallen back to, because a box setting only the old name would still get a second store.
  const profileStore = customerStoreDir({ bundledDir: join(HERE, "profiles") });
  const profileDir = profileStore.dir;
  log(customerStoreLine("profile store", profileStore));
  const repoRoot = process.env.PROFILE_REPO_ROOT || join(HERE, "..", "..");   // git commits land here
  // ── — REFUSE A STORE THIS SERVICE COULD NEVER COMMIT ────────────────────────────────────────
  //
  // A save is two steps that are not atomic: write the file, then `git add` it. Point the second at a
  // repository that does not contain the first and git refuses AFTER the write has landed — the overlay is
  // live, the audit row records commit:null, and the orphan sits untracked forever. Nothing retries it,
  // and the next store sync refuses on the dirty tree. Measured on the test box: one save blocked every
  // hourly deploy tick for 19 hours, and the only symptom was a line in a deploy log nobody reads.
  //
  // The recipe service has refused on this since it was written. This service, which is where the incident
  // actually happened, did not — the same control, correct in one of the two places that needed it.
  //
  // FATAL, matching the recipe service and not the portal: this process exists to serve profiles. If every
  // save it accepts would orphan a file, starting is worse than not starting.
  {
    const reach = storeInRepo(profileDir, repoRoot);
    if (!reach.ok) {
      log(`FATAL: ${storeOutsideRepoMessage({ storeVar: "CLEAROTRON_CUSTOMERS_DIR", storeDir: reach.store, repoVar: "PROFILE_REPO_ROOT", repoRoot: reach.repo })}`);
      process.exit(1);
    }
  }

  let verify = null;
  if (AUTH_DISABLED) {
    if (!DEV) { log("FATAL: PROFILE_AUTH_DISABLED=1 also requires PROFILE_DEV=1 — refusing to start (fail-closed)."); process.exit(1); }
    if (!LOOPBACK.has(HOST)) { log(`FATAL: auth disabled but HOST=${HOST} is not loopback — refusing.`); process.exit(1); }
    log("WARNING: auth DISABLED (dev mode, loopback only) — LOCAL TESTING ONLY.");
  } else if ((!TEAM && !OIDC_ISSUER) || !AUD) {
    // AN AUDIENCE PLUS EITHER A TEAM OR AN ISSUER. Before this, a deployment fronted by its own
    // OIDC provider and carrying no vendor team could not start at all — the refusal demanded a value
    // that deployment had no reason to hold. Missing BOTH is still fatal, and still fail-closed.
    log(`FATAL: auth enabled but CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or PROFILE_OIDC_ISSUER are missing — refusing to start (fail-closed).`); process.exit(1);
  } else if (!DOMAINS.length) {
    log("FATAL: auth enabled but MCP_ALLOWED_EMAIL_DOMAINS is unset — set the explicit domain list; no default (fail-closed)."); process.exit(1);
  } else {
    const { makeAccessVerifier } = await import("../mcp-server/lib/cf-access.mjs");   // lazy: jose only here
    verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: DOMAINS,
      issuer: OIDC_ISSUER || undefined, jwksUrl: JWKS_URL || undefined, emailClaim: EMAIL_CLAIM });
    // The log names the ISSUER IN FORCE, not the team, because with an own-provider deployment the team
    // is empty and a line reading `team=` tells the operator nothing about which door is actually open.
    log(`auth ON — issuer=${OIDC_ISSUER || `CF Access team=${TEAM}`} aud=${audienceLabel(AUD)} claim=${EMAIL_CLAIM} header=${AUTH_HEADER} domains=[${DOMAINS.join(", ")}]`);
  }

  const { execFileSync } = await import("node:child_process");   // lazy: only the live service shells out to git
  const auditPath = process.env.PROFILE_AUDIT || join(profileDir, "_audit.log");
  // — SAY IT WHEN IT HAPPENS. The core catches this and reports `commitError` on the response and in
  // the audit row, both of which are read by whoever made the save and nobody else. A failed commit leaves
  // a permanent sync blocker, so it belongs in the service journal too: the boot check above removes the
  // CONFIGURATION cause, not index.lock contention, a detached HEAD, a hook, or a full disk.
  // — one committer for every store door. It completes what an earlier failed save left staged,
  // names the fault when its own commit fails, and never un-stages: identity-derived author (HARD RULE).
  const gitCommit = makeStoreCommit({ repoRoot, log, what: "profile" });
  // — returns the path when it is committable, so the save stages the row with the change.
  const audit = makeCommittableAudit({ auditPath, repoRoot });

  const { RateLimiter } = await import("../mcp-server/lib/ratelimit.mjs");
  const service = makeProfileService({ profileDir, gitCommit, audit });
  const limiter = new RateLimiter({ perMinute: Number(process.env.PROFILE_RATE_PER_MIN || 60) });
  const { createServer } = await import("node:http");
  const { listenOrDie } = await import("../shared/listen.mjs");   //: a taken port is a sentence, not a stack
  const handler = makeHttpHandler({ verify, limiter, service, authHeader: AUTH_HEADER, log });
  listenOrDie(createServer(handler), {
    port: PORT, host: HOST, what: "profile-service", portVar: "PROFILE_PORT", portSource: PORT_CHOICE.source, log,
    onReady: ({ port: bound }) => log(`listening on http://${HOST}:${bound}/profiles — dir=${profileDir} repo=${repoRoot} ${verify ? "auth ON" : "AUTH OFF (dev)"}`),
  });
}
