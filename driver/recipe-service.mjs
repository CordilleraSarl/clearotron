#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recipe-service.mjs — the saved-search ("recipe") write-service. The small
// access-gated surface the Searches panel POSTs to. MIRRORS profile-service.mjs exactly:
//   • binds LOOPBACK only; the sole ingress is the Cloudflare Tunnel → CF Access (Entra IdP);
//   • re-verifies the CF Access JWT on EVERY request; rate-limits per identity;
//   • fail-closed: refuses to start without CLEAROTRON_OIDC_AUDIENCE plus a team or an issuer (unless
//     DEV+loopback). Any JWT-fronting proxy works — see RECIPE_OIDC_ISSUER.
//
// Endpoints:
//   GET  /recipes                       — the registry levels + every saved search (roster view). read-only.
//   GET  /recipes/:customer             — one customer's saved searches. read-only.
//   GET  /recipes/:customer/:slug       — the full recipe + its content sha (the freeze identity).
//   POST /recipes/:customer/:slug/validate — server-side dry-run (validateRecipe + prose guards). NO write.
//   POST /recipes/:customer/:slug/save  — the VALIDATED AUTO-COMMIT write: re-validate server-side, write
//                                         <recipesDir>/<customer>/<slug>.json, git-commit AS the CF-Access
//                                         identity, append an audit line. (Upsert; archive = save with
//                                         archived:true — there is deliberately no delete.)
//   GET  /recipes/health                — bare liveness (no data, no auth) for systemd/Caddy.
//
// HARD RULES (enforced here, not just in the UI): the git author + audit "by" + the created/updated stamps
// ALWAYS come from the verified Access identity — body-supplied stamps are ignored; `version` is
// server-owned (monotonic per save); EVERY write re-runs the SAME load-time validator the driver uses
// (search-policy.mjs validateRecipe), so the UI can never persist a recipe the driver would later reject;
// free text gets the profiles.mjs anti-rule prose guards (a recipe must never smuggle a rating rule in as
// prose — levels select machinery, never rating authority); a recipe belongs to a REAL customer on the
// profile roster (never "generic"). The routing core (`makeRecipeService`) is fs-only + injected
// git/audit so it unit-tests offline; auth + rate-limit are wired in the bootstrap.

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { resolvePort } from "../shared/listen.mjs";   // — the port SOURCE, decided once
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { storeInRepo, storeOutsideRepoMessage, makeCommittableAudit, commitWithAuditRow, resolveStoreRepoRoot, makeStoreCommit } from "../shared/store-in-repo.mjs";   //,
import {
  loadRecipes as loadRecipesDefault, validateRecipe, recipeShaOf,
  ORDERABLE_PRODUCTS, PRODUCT_POLICIES, COMPONENTS, RECIPE_EXTRA_KEYS,
} from "./search-policy.mjs";
import { productRows } from "./product-rows.mjs";
import { loadProfiles as loadProfilesDefault, recipeProseGuard, platformEntryErrors } from "./profiles.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { envFrom } from "../shared/env-aliases.mjs";   // — read the audience by either spelling
import { accessAudience, audienceLabel } from "../shared/access-audience.mjs";   // — F54; jose-free on purpose
export { recipeProseGuard };   // single home is profiles.mjs — every loadRecipes door wires the same guard

// The registry view the composer builds its menu from — display metadata only, straight off the closed
// registry (the report-identity rule: titles/labels derive from HERE, never from a client's recipe label).
// One derivation, in product-rows.mjs, shared with the portal and the ops-MCP: the row now carries a
// COMPUTED turnaround and a client-facing name, and three hand-written copies of that could drift.
// Imported rather than re-exported straight through, because `route` below calls it too and a bare
// `export ... from` creates no local binding.
export const registryProducts = productRows;
export const componentCatalog = () =>
  Object.fromEntries(Object.entries(COMPONENTS).map(([k, v]) => [k, { pipelines: v.pipelines, desc: v.desc }]));

// ── the routing core (fs via injected dirs; git/audit injected) ──────────────────────────────────────────
export function makeRecipeService({
  recipesDir,
  profileDir = undefined,                      // undefined ⇒ profiles.mjs default dir
  loadRecipes = loadRecipesDefault,
  loadProfiles = loadProfilesDefault,
  writeRecipe = defaultWriteRecipe,
  gitCommit = () => null,       // ({ files, message, author }) => sha — injected (no child_process in the core)
  audit = () => {},             // ({ event, key, by, fields }) => void
} = {}) {
  const rosterHas = (customer) => {
    try {
      const profiles = profileDir === undefined ? loadProfiles({ force: true }) : loadProfiles({ dir: profileDir, force: true });
      return profiles.has(customer) && customer !== "generic";
    } catch { return false; }   // an unreadable roster fails CLOSED here — writes need a verifiable owner
  };
  const listRow = ([key, r]) => {
    const [customer, slug] = key.split("/");
    return { customer, slug, label: r.label, base: r.base, archived: Boolean(r.archived),
      version: r.version ?? null, updatedAt: r.updatedAt ?? r.createdAt ?? null };
  };

  async function route(method, path, identity, body = {}) {
    const by = identity?.email || "unknown";
    const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);   // ["recipes", customer?, slug?, action?]
    if (parts[0] !== "recipes") return { status: 404, json: { error: "not_found" } };

    // GET /recipes — the registry + every saved search
    if (parts.length === 1) {
      if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
      const recipes = loadRecipes({ dir: recipesDir, force: true });
      return { status: 200, json: {
        products: registryProducts(), components: componentCatalog(), extras: RECIPE_EXTRA_KEYS,
        recipes: [...recipes.entries()].map(listRow).sort((a, b) => `${a.customer}/${a.slug}`.localeCompare(`${b.customer}/${b.slug}`)),
      } };
    }

    const customer = parts[1];
    // GET /recipes/:customer — one customer's list
    if (parts.length === 2) {
      if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
      if (!rosterHas(customer)) return { status: 404, json: { error: "unknown_customer" } };
      const recipes = loadRecipes({ dir: recipesDir, force: true });
      return { status: 200, json: { customer,
        recipes: [...recipes.entries()].filter(([k]) => k.startsWith(`${customer}/`)).map(listRow).sort((a, b) => a.slug.localeCompare(b.slug)) } };
    }

    const slug = parts[2];
    const action = parts[3];

    // GET /recipes/:customer/:slug — the full recipe + its freeze sha (same roster gate as the list:
    // an off-roster customer's hand-dropped dir is a CONFIG ERROR, never quietly served — review 2026-07-18)
    if (parts.length === 3) {
      if (method !== "GET") return { status: 405, json: { error: "method_not_allowed" } };
      if (!rosterHas(customer)) return { status: 404, json: { error: "unknown_customer" } };
      const recipes = loadRecipes({ dir: recipesDir, force: true });
      const r = recipes.get(`${customer}/${slug}`);
      if (!r) return { status: 404, json: { error: "unknown_recipe" } };
      return { status: 200, json: { customer, slug, recipe: r, sha: recipeShaOf(r) } };
    }

    if (parts.length !== 4 || (action !== "validate" && action !== "save"))
      return { status: 404, json: { error: "not_found" } };
    if (method !== "POST") return { status: 405, json: { error: "method_not_allowed" } };
    if (!rosterHas(customer))
      return { status: 400, json: { error: `customer "${customer}" is not on the profile roster — a saved search belongs to a real customer (create the profile first; "generic" cannot own recipes)` } };

    const incoming = body.recipe;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
      return { status: 400, json: { error: "recipe (object) is required in the body" } };

    // Server-owned stamps (the identity discipline): whatever the body claims, created/updated/version come
    // from the DISK + the verified identity — exactly what will be written is what gets validated.
    const recipes = loadRecipes({ dir: recipesDir, force: true });
    const existing = recipes.get(`${customer}/${slug}`) ?? null;
    // optimistic concurrency (optional): a client that names the version it based its edit on gets a
    // 409 instead of a silent last-writer-wins clobber (review 2026-07-18)
    if (existing && body.expectedVersion != null && body.expectedVersion !== (existing.version ?? null))
      return { status: 409, json: { error: `version conflict: the recipe is at v${existing.version ?? "?"} but your edit was based on v${body.expectedVersion} — reload and re-apply` } };
    const now = new Date().toISOString();
    const effective = { ...incoming };
    delete effective.createdBy; delete effective.createdAt;
    delete effective.updatedBy; delete effective.updatedAt; delete effective.version;
    // archive state is STICKY against omission (the CODE_OWNED omission-is-not-consent discipline):
    // un-archiving takes an EXPLICIT archived:false, never a body that simply lacks the key
    if (existing?.archived && incoming.archived === undefined) effective.archived = true;
    if (existing) {
      if (existing.createdBy != null) effective.createdBy = existing.createdBy;
      if (existing.createdAt != null) effective.createdAt = existing.createdAt;
      effective.updatedBy = by; effective.updatedAt = now;
      effective.version = (Number.isInteger(existing.version) ? existing.version : 0) + 1;
    } else {
      effective.createdBy = by; effective.createdAt = now;
      effective.version = 1;
    }

    // Both guards injected: the prose rules (a recipe must never smuggle a rating rule in as prose) and
    // the marketplace-entry rule, so a saved scope is held to exactly the rule a job's scope is.
    const v = validateRecipe(customer, slug, effective, { proseGuard: recipeProseGuard, platformEntryErrors });

    // POST …/validate — dry run, NO write (the propose step)
    if (action === "validate")
      return { status: 200, json: { ok: v.ok, errors: v.errors, isNew: !existing, wouldWriteVersion: effective.version } };

    // POST …/save — the validated AUTO-COMMIT write (the confirm step). The write lands FIRST (atomic
    // temp+rename); a git failure after it must never hide the mutation behind a 500 — the recipe is
    // LIVE (all three driver doors read force-fresh), so the response says written:true with the
    // commit error named, and the audit line records commit:null either way (review 2026-07-18 —
    // the "reported outcome diverges from disk truth" class).
    if (!v.ok) return { status: 400, json: { error: "validation_failed", errors: v.errors } };
    const { files } = writeRecipe({ recipesDir, customer, slug, recipe: effective });
    const message = `chore(prelim): ${existing ? (effective.archived && !existing.archived ? "archive" : "update") : "create"} saved search ${customer}/${slug} (via config UI, by ${by})`;
    // — the row rides IN the commit, so it no longer names a sha. shared/store-in-repo.mjs says why.
    const { commit, commitError } = commitWithAuditRow({ audit, gitCommit, files, message, by,
      row: { event: existing ? "recipe-update" : "recipe-create", key: `${customer}/${slug}`, by,
        fields: Object.keys(incoming), version: effective.version, archived: Boolean(effective.archived) } });
    return { status: 200, json: { written: true, created: !existing, customer, slug,
      version: effective.version, sha: recipeShaOf(effective), commit,
      ...(commitError ? { commitError: `saved and LIVE, but the git commit failed (${commitError}) — fix the repo state; the audit line records the gap` } : {}) } };
  }
  return { route };
}

// Default fs writer (temp+rename, atomic): <recipesDir>/<customer>/<slug>.json. The slug/customer are
// validated upstream (validateRecipe slug RE + the roster check) before any path is built from them.
export function defaultWriteRecipe({ recipesDir, customer, slug, recipe }) {
  const dir = join(recipesDir, customer);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, `${slug}.json`);
  writeFileSync(`${jsonPath}.tmp`, JSON.stringify(recipe, null, 2) + "\n");
  renameSync(`${jsonPath}.tmp`, jsonPath);
  return { files: [jsonPath] };
}

// ── node req/res plumbing (auth → body → route → response) — profile-service.mjs verbatim ───────────────
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
      if (req.method === "GET" && url.pathname === "/recipes/health") return send(res, 200, { ok: true });
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
  const HERE = dirname(fileURLToPath(import.meta.url));
  const log = (...a) => process.stderr.write(`[recipe-service] ${a.join(" ")}\n`);
  // — resolved through the shared helper so the SOURCE travels with the number. "18801" and
// "18801 because nobody said otherwise" are different addresses to an operator, and only the
// second one is a guess at which instance this is.
const PORT_CHOICE = resolvePort({ value: process.env.RECIPE_PORT, name: "RECIPE_PORT", fallback: 18801 });
const PORT = PORT_CHOICE.port;
  const HOST = process.env.RECIPE_HOST || "127.0.0.1";
  const AUTH_DISABLED = process.env.RECIPE_AUTH_DISABLED === "1";
  const DEV = process.env.RECIPE_DEV === "1";
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
  const OIDC_ISSUER = process.env.RECIPE_OIDC_ISSUER || "";
  const JWKS_URL = process.env.RECIPE_JWKS_URL || "";
  const EMAIL_CLAIM = process.env.RECIPE_EMAIL_CLAIM || "email";
  // LOWERCASED WHEN READ, for the reason the portal's own note records: Node lowercases incoming
  // header names, so a verbatim `Cf-Access-Jwt-Assertion` would match nothing and refuse every
  // correctly authenticated user — a fail-CLOSED misconfiguration that looks like a broken proxy.
  const AUTH_HEADER = (process.env.RECIPE_AUTH_HEADER || "cf-access-jwt-assertion").toLowerCase();
  // NO example.com default (see portal-service.mjs, which already made this move): a forgotten env
  // silently denies every real identity at the edge while looking configured.
  const DOMAINS = (process.env.MCP_ALLOWED_EMAIL_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
  // NAMED, never guessed — the same move as CF_ACCESS/MCP_ALLOWED_EMAIL_DOMAINS above. This service
  // WRITES, so a forgotten env var would have it saving a real customer's search into `driver/recipes/`,
  // the source tree's synthetic demo dir: committed to the wrong repo, invisible to the engine, and
  // sitting next to two fictional customers. Refuse to start instead.
  const recipesDir = process.env.CLEAROTRON_RECIPES_DIR || "";
  if (!recipesDir) {
    log("FATAL: CLEAROTRON_RECIPES_DIR is required — it names the recipe store this service reads and writes. There is no default: the in-repo driver/recipes/ holds synthetic demos for fictional customers and must never be a live store.");
    process.exit(1);
  }
  // the ROSTER follows the same store as the profile-service (review 2026-07-18: without this knob the
  // roster was pinned to the in-repo demos — real external-store customers 400'd while demo customers
  // wrote into the prod store; the roster and the recipe store must come from one universe)
  // — the PROFILE_DIR arm is GONE, not kept as a courtesy. Keeping it would let a
  // box that sets only the retired name pull this door back onto a second store, which is the exact
  // split 1923 exists to close.
  // NOT customerStoreDir() here: `undefined` is meaningful at this call site — it delegates to
  // profiles.mjs's own default dir (see the parameter's note at the top of this file), which
  // resolves CLEAROTRON_CUSTOMERS_DIR itself. This site has no bundled directory of its own to
  // fall back to, which is exactly what customerStoreDir() requires a caller to supply.
  const profileDir = envFrom(process.env, "CLEAROTRON_CUSTOMERS_DIR") || undefined;
  // — RESOLVED ONCE, FOR BOTH DOORS. This read was `RECIPE_REPO_ROOT || join(HERE, "..")` and the
  // portal's was `RECIPE_REPO_ROOT || <profile repo root>`, so the same environment brought one door up
  // and exited the other. The profile root is consulted here now, which is what the test instance needs
  // and what this file's own roster note already argued for: the roster and the recipe store must come
  // from one universe.
  const resolved = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], fallback: join(HERE, "..") });
  const repoRoot = resolved.root;   // git commits land here
  {
    // — the shared statement of this rule, which the PROFILE side did not have and should have.
    // Also symlink-tolerant, which the resolve-only version here was not: these stores are deployed behind
    // symlinked paths, and a false refusal is an outage where a false pass is the status quo.
    const reach = storeInRepo(recipesDir, repoRoot);
    if (!reach.ok) {
      // — NAME THE VARIABLE THAT ANSWERED. "outside the repo root" is unactionable without it:
      // an operator who set RECIPE_REPO_ROOT and sees a root they did not type has learned something,
      // and one who set nothing needs to be told which name would have been read.
      log(`FATAL: ${storeOutsideRepoMessage({ storeVar: "CLEAROTRON_RECIPES_DIR", storeDir: reach.store, repoVar: "RECIPE_REPO_ROOT", repoRoot: reach.repo })}`
        + ` The repo root came from ${resolved.from} (tried ${resolved.tried.join(", ")} in that order).`);
      process.exit(1);
    }
  }

  let verify = null;
  if (AUTH_DISABLED) {
    if (!DEV) { log("FATAL: RECIPE_AUTH_DISABLED=1 also requires RECIPE_DEV=1 — refusing to start (fail-closed)."); process.exit(1); }
    if (!LOOPBACK.has(HOST)) { log(`FATAL: auth disabled but HOST=${HOST} is not loopback — refusing.`); process.exit(1); }
    log("WARNING: auth DISABLED (dev mode, loopback only) — LOCAL TESTING ONLY.");
  } else if ((!TEAM && !OIDC_ISSUER) || !AUD) {
    // AN AUDIENCE PLUS EITHER A TEAM OR AN ISSUER. Before this, a deployment fronted by its own
    // OIDC provider and carrying no vendor team could not start at all — the refusal demanded a value
    // that deployment had no reason to hold. Missing BOTH is still fatal, and still fail-closed.
    log(`FATAL: auth enabled but CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or RECIPE_OIDC_ISSUER are missing — refusing to start (fail-closed).`); process.exit(1);
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
  const auditPath = process.env.RECIPE_AUDIT || join(recipesDir, "_audit.log");
  // — this copy had NO failure logging at all, which is what four hand-maintained copies buys you.
  const gitCommit = makeStoreCommit({ repoRoot, log, what: "recipe" });
  // — returns the path when it is committable, so the save stages the row with the change.
  const audit = makeCommittableAudit({ auditPath, repoRoot });

  const { RateLimiter } = await import("../mcp-server/lib/ratelimit.mjs");
  const service = makeRecipeService({ recipesDir, profileDir, gitCommit, audit });
  const limiter = new RateLimiter({ perMinute: Number(process.env.RECIPE_RATE_PER_MIN || 60) });
  const { createServer } = await import("node:http");
  const { listenOrDie } = await import("../shared/listen.mjs");   //: a taken port is a sentence, not a stack
  const handler = makeHttpHandler({ verify, limiter, service, authHeader: AUTH_HEADER, log });
  listenOrDie(createServer(handler), {
    port: PORT, host: HOST, what: "recipe-service", portVar: "RECIPE_PORT", portSource: PORT_CHOICE.source, log,
    onReady: ({ port: bound }) => log(`listening on http://${HOST}:${bound}/recipes — dir=${recipesDir} repo=${repoRoot} ${verify ? "auth ON" : "AUTH OFF (dev)"}`),
  });
}
