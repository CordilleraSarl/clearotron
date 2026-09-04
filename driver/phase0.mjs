// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Phase 0 — PURE CODE (no LLM): derive the slug, codename, run-dir, calendar date, and customer template.
// Mirrors prelim-search/SKILL.md Phase 0 + Phase 1 slug derivation.

import { existsSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ledgerPath } from "../providers/_shared/ledger-path.mjs";
import { config } from "./driver.config.mjs";
import { resolveProfile } from "./profiles.mjs";
import { PLAN_MAX_NAME_LENGTH } from "./register-plan.mjs";   // — the budget the doors already refuse above

// Codename = random <adjective>-<noun> (lowercase, single hyphen). The slug already embeds the unique
// TMP reference, so the codename's ONE job is per-run dir freshness — which a bare 20×20 random mint
// does NOT guarantee: a same-slug same-day re-mint that collides with an EXISTING run dir is silently
// served that run's completed stages by the idempotency skip, as if it were a resume (the mock-pipeline
// suite, ~35 same-slug runs per process, hit exactly this). buildRunContext re-mints on collision;
// genCodename itself stays a pure pick.
const ADJ = [
  "cobalt", "briar", "sable", "amber", "slate", "ivory", "crimson", "verdant", "onyx", "russet",
  "azure", "umber", "cedar", "flint", "garnet", "hazel", "indigo", "jade", "ochre", "pewter",
];
const NOUN = [
  "falcon", "meadow", "delta", "harbor", "lantern", "cipher", "thicket", "summit", "current", "ember",
  "warren", "beacon", "quarry", "willow", "kestrel", "monolith", "estuary", "bramble", "compass", "drift",
];

export function genCodename(rand = Math.random) {
  return `${ADJ[Math.floor(rand() * ADJ.length)]}-${NOUN[Math.floor(rand() * NOUN.length)]}`;
}

export function kebab(s) {
  return String(s)
    .normalize("NFKD")        // decompose first (é→e+◌́, ™→TM) …
    .toLowerCase()            // … then lowercase, so symbol decompositions don't re-introduce caps
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// ── — THE SLUG IS A PATH COMPONENT, SO IT IS BOUNDED HERE ──────────────────
//
// `validateJob` refuses a mark over `PLAN_MAX_NAME_LENGTH` at every door, and that
// is the right place for the refusal: the deliverable must name the mark the client asked about, so a
// name that is a paragraph is sent back rather than shortened. This is the belt behind that braces, and
// it guards a different failure — the doors are not the only writer of a runId. A caller that composes
// one without passing `validateJob`, or a filesystem stricter than this one, meets the bound anyway.
//
// THE BOUND IS ON THE NAME, NOT ON THE KEBAB, and that is what makes it safe to add to a function whose
// output is already on disk. A name inside the door's budget is sliced by nothing, so its slug is
// byte-identical to the one every existing run directory, archive directory, pool directory and report
// link was computed from — by construction, with no reasoning needed about how far NFKD can lengthen a
// legal name (`™` decomposes to `tm`, `½` to `1-2`). Bounding the kebab instead would need a number for
// that expansion, and every answer to it changes the slug of some name that is legal today.
//
// THE REFERENCE IS BOUNDED TOO, and it has to be: no door states a length for `ref`/`tmp`, so bounding
// only the mark would leave `tmp<5000 characters>-acme` — the same unusable path this issue is about,
// reached through the other half of the same string. It borrows the mark's budget rather than inventing
// a second number; 120 characters is generous for a reference, and a reference that long is already not
// one. Recorded on the tracker rather than fixed silently.
//
// It TRUNCATES where the door REFUSES, and the difference is deliberate: the door is talking to a person
// who can retype the name, and this is composing an internal identity for a name that already got past
// one. A refusal here would turn a stricter filesystem into an outage.
const boundName = (s) => String(s).slice(0, PLAN_MAX_NAME_LENGTH);

// slug = tmp<n>-<kebab-mark-name>. The TMP Reference No. guarantees uniqueness; the mark keeps it readable.
// Refless jobs (ref/tmp absent — allowed since the intake relaxation) get `noref<6-hex>-<mark>`: the hash is
// of job.id, the sanitized email message-id and the queue's dedup key, so the slug stays unique across
// same-name marks AND stable across webhook re-delivery + resume. Refed jobs are byte-identical to before.
export function deriveSlug(job) {
  const raw = boundName(String(job.ref ?? job.tmp ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  const mark = kebab(boundName(job.markName ?? job.name ?? job.marks?.[0]?.name ?? "mark"));
  if (!raw) {
    const h = createHash("sha256").update(String(job.id ?? mark)).digest("hex").slice(0, 6);
    return `noref${h}-${mark}`;
  }
  const tmp = raw.startsWith("tmp") ? raw : `tmp${raw}`;
  return `${tmp}-${mark}`;
}

// Calendar date in Europe/Zurich (the firm's timezone), YYYY-MM-DD.
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

// The resolved customer = the profile key (profiles.mjs resolveProfile, forwarder-domain only). This was
// a aurora-interactive.example-vs-generic HARDCODE (D4.1); the engine is already profile-driven, so resolveProfile is
// the single source of truth. ctx.customer is telemetry-only (the run-start log line); per-customer
// DELIVERY reads the FROZEN sidecar ctx.profile.profileKey (which wins on resume) — never read
// ctx.customer for a delivery decision, or a profiles/ edit between run and resume would diverge.
export function selectCustomer(job) {
  return resolveProfile(job)?.key ?? "generic";
}

// studioRoot defaults to clawdi's; per-run code passes the FORWARDING agent's studioRoot (the run-dir must
// sit in the executing agent's workspace so its sandboxed write tool can reach it).
export function runDirFor({ slug, date, codename, studioRoot = config.studioRoot }) {
  return join(studioRoot, slug, `${date}-${codename}`);
}

// archive/<YYYY-MM>/<slug>/<date>-<codename>/ — same codenamed leaf as the run-dir, in the same workspace.
export function archiveDirFor({ slug, date, codename, archiveRoot = config.archiveRoot }) {
  return join(archiveRoot, date.slice(0, 7), slug, `${date}-${codename}`);
}

// ── — THE RUN KEY MUST BE UNIQUE IN THE SCOPE IT IS READ IN, NOT ONLY IN ITS OWN ROOT ────────
//
// `prelim-<slug>-<codename>-` is not just a directory name. It is the ONLY thing separating one run's
// rows from another's in the shared call ledger, and `pipeline.mjs`'s screen gate reads that ledger to
// build the fetched universe it judges goods-drops against:
//
//     const fetched = new Set([
//       ...fetchedRecordUris(DEFAULT_LEDGER_PATH, runPrefix),        // ← shared across runs
//       ...assembleRunRecords(run.runDir, runPrefix).records.keys(), // ← run-local; a sibling cannot enter
//     ]);
//
// Two runs that draw the same codename for the same slug therefore SHARE A FETCHED SET, and the gate
// reads a record as fetched that its own run never fetched — `all-fetched`, on a run whose fetcher
// failed every call. That is 's signature.
//
// MEASURED, one `npm run test:full`: 252 mints across 57 processes, slug `tmp2201-novapulse` drawn 94
// times, 10 collisions. Birthday against 400 names predicts ~11. This is the expected rate, not bad luck.
//
// THE EXISTING GUARD CANNOT SEE IT, and the reason is scope, not a bug. `existsSync` asks whether THIS
// run's studio/archive root already holds the name; every mock run gets a fresh temp root, so the guard
// is structurally blind to every sibling. The run-dir hazard the header above describes is real and this
// keeps guarding it — the ledger is simply shared one scope wider, and the key has to be unique there too.
//
// So the mint also CLAIMS the name, in the directory that defines the sharing scope: beside the call
// ledger, which `resolveLedger` already points at the suite's temp root under a suite run and at the
// box's telemetry dir in production. No new environment variable, and the scope is right by construction
// rather than by a second resolution somebody has to keep in step.
//
// A CLAIM, NOT A FETCH-SCAN, because the two runs race BEFORE either fetches: scanning the ledger for
// `record_fetch` rows only sees a sibling that has already fetched, which is the half of the window that
// was never the problem. One line per run, written at mint.

// ONE SHORT LINE PER RUN, AND NOTHING PRUNES IT — said here because that is a reader's first question.
// The file grows with the box's run count and no reader trims it. What bounds it is the KEY rather than
// the file: a claim carries its DATE, and the check only ever compares against the same slug and the
// same calendar day, so yesterday's lines are inert the moment the date turns. They cost a parse and
// answer no. Nothing enumerates this directory either — checked, no `readdir`/glob over the telemetry
// dir anywhere in the tree — so a new filename beside the ledgers surprises no reader.
/** The claim registry, beside the call ledger — so its scope IS the ledger's scope. Resolved per call. */
export const codenameRegistryPath = () => join(dirname(ledgerPath("call")), "run-codenames.jsonl");

/**
 * Claim `prelim-<slug>-<codename>-` for this run, and report whether we got it.
 *
 * FIRST WRITER WINS, decided by re-reading rather than by locking: append the claim, read every claim
 * back, and the earliest line for this slug+date+codename is the owner. Two runs that append in the same
 * instant both see both lines and exactly one of them sees itself first, so neither needs the other to
 * be finished — which a check-then-write would.
 *
 * A REGISTRY THAT CANNOT BE READ OR WRITTEN RETURNS TRUE, and that is deliberate: this narrows an
 * existing guard, so its failure mode is the behaviour that shipped before it, never a run refused over
 * its own telemetry directory. The `existsSync` pair above still holds in that case.
 *
 * @returns {boolean} true when this run owns the name
 */
export function claimRunCodename({ slug, date, codename, registryPath = codenameRegistryPath(), id = randomUUID() }) {
  const key = `${slug}\u0000${date}\u0000${codename}`;
  try {
    mkdirSync(dirname(registryPath), { recursive: true });
    appendFileSync(registryPath, `${JSON.stringify({ ts: new Date().toISOString(), slug, date, codename, id })}\n`);
  } catch { return true; }
  let text;
  try { text = readFileSync(registryPath, "utf8"); } catch { return true; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }   // tolerate a torn concurrent append
    if (`${row.slug}\u0000${row.date}\u0000${row.codename}` !== key) continue;
    return row.id === id;                                          // the FIRST claimant for this key wins
  }
  return true;   // our own line is unreadable — see the note above; do not fail a run over it
}

// Freshness-aware mint: a codename no run (live OR archived) already owns for this slug+date, and one no
// concurrent run has claimed in the ledger's own scope — a collision would resume a stranger's completed
// stages via the idempotency skip (see the codename header note) AND merge two runs' fetched universes.
// Shared by buildRunContext's fresh-mint path AND the runner's dispatch pre-mint (B1: the runner persists
// the identity to the queue sidecar BEFORE any spend, so a crash-reclaim resumes instead of re-minting) —
// a pre-mint through raw genCodename would silently lose this collision protection.
// 20 straight collisions ⇒ the 400-name space is exhausted for this slug+date — suffix for freshness.
export function mintFreshCodename({ slug, date, studioRoot = config.studioRoot, archiveRoot = config.archiveRoot,
  rand = Math.random, claim = claimRunCodename }) {
  for (let i = 0; i < 20; i++) {
    const c = genCodename(rand);
    if (!existsSync(runDirFor({ slug, date, codename: c, studioRoot }))
      && !existsSync(archiveDirFor({ slug, date, codename: c, archiveRoot }))
      && claim({ slug, date, codename: c })) return c;
  }
  // The suffix carries the same guarantee the loop does: it is unique by construction, so it is claimed
  // rather than raced for.
  return `${genCodename(rand)}-${Date.now().toString(36)}`;
}

// Assemble the immutable run identity for a job. rand is injectable for tests. studioRoot/archiveRoot are the
// FORWARDING agent's (derived from its queue dir by the runner); they default to clawdi's for back-compat.
// `codename`/`date` overrides exist for RESUME: re-driving a failed run must rebuild the SAME run identity
// (slug/date/codename → the same run-dir) so the idempotency skip reuses the prior stages instead of minting
// a fresh codename and re-spending everything (the "pearl-keystone" trap). A bare new run leaves both unset.
export function buildRunContext(
  job,
  { rand = Math.random, now = new Date(), studioRoot = config.studioRoot, archiveRoot = config.archiveRoot,
    codename: codenameOverride, date: dateOverride } = {},
) {
  const slug = deriveSlug(job);
  const date = dateOverride ?? todayISO(now);
  // Fresh mints go through mintFreshCodename (above) so they never land in a dir another run already owns.
  // Overrides skip the check: RESUME (and the runner's dispatch pre-mint, which already minted freshly)
  // wants the identity verbatim.
  const codename = codenameOverride ?? mintFreshCodename({ slug, date, studioRoot, archiveRoot, rand });
  return {
    slug,
    codename,
    date,
    customer: selectCustomer(job),
    studioRoot,
    archiveRoot,
    runDir: runDirFor({ slug, date, codename, studioRoot }),
    archiveDir: archiveDirFor({ slug, date, codename, archiveRoot }),
  };
}
