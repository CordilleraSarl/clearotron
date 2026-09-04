#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// signa-sync.mjs — fetch Signa's live office list and write the snapshot the contract derives from.
//
// WHY THE SNAPSHOT IS A COMMITTED FILE AND NOT A RUNTIME FETCH. Owner decision, 2026-08-16: a vendor
// quietly changing what we claim to search is exactly the thing a human should review, so a coverage
// change arrives as a diff in a pull request rather than as a different answer on a Tuesday.
//
// It also solves a practical problem. `GET /v1/offices` exposes no version, no etag and no change feed
// — only `limit` and `cursor` — so there is nothing to poll for change. Diffing our committed file IS
// the change detection.
//
// WHY IT EMITS A .js MODULE RATHER THAN .json. `capabilities.js` files are declared PURE — no node
// imports, no HTTP — and `register-capabilities.mjs` imports all six at module load. A generated ES
// module is a plain import that keeps all of that true, needs no import attributes, and diffs exactly
// as well as JSON. It follows `shared/portal-tokens.mjs`, which already emits a generated source file
// for the same reason.
//
// ── THE ASYMMETRY, WHICH IS THE WHOLE SAFETY ARGUMENT ────────────────────────────────────────────────
//
//   Signa ADDS an office and our snapshot is narrower  → we under-claim. Safe. The snapshot is dated
//                                                        and the date is disclosable.
//   An office goes non-live and our snapshot is wider  → we plan a slice against an office the vendor
//                                                        no longer serves, the answer comes back thin,
//                                                        and it READS AS CLEAN. This must refuse.
//
// So the gate is each office's own `status` field, not its presence in the response. An office that
// stops being `live` leaves the covered set on the next sync, and the diff says so out loud.
//
// AND A FAILED SYNC NEVER WRITES. `driver/register-availability.mjs` carries the paragraph on why an
// empty covered list reads as "covers nothing" and must not be produced by a failure path. Every
// refusal below exits non-zero with the existing file untouched, because a stale snapshot is a known
// quantity and an empty one is a silent catastrophe.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "providers", "signa", "src", "offices.generated.js");
const DEFAULT_BASE = "https://api.signa.so";

const die = (msg) => { console.error(`[signa-sync] REFUSED — ${msg}`); process.exit(1); };

const key = String(process.env.SIGNA_API_KEY ?? "").trim();
if (!key) die("SIGNA_API_KEY is not set. Nothing was written; the existing snapshot stands.");
const base = String(process.env.SIGNA_BASE_URL ?? "").trim() || DEFAULT_BASE;

// Paged deliberately, even though the list is small today: `limit`/`cursor` are the only controls the
// endpoint offers, and a silently truncated first page is the shape that would drop an office without
// anyone noticing — which is the wide-snapshot failure above, arriving through the front door.
const all = [];
let cursor = null;
for (let page = 0; page < 20; page++) {
  const url = new URL("/v1/offices", base);
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  let res;
  try { res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } }); }
  catch (e) { die(`the office list could not be fetched (${e.message}). Existing snapshot untouched.`); }
  if (!res.ok) die(`GET /v1/offices returned HTTP ${res.status}. Existing snapshot untouched.`);

  let body;
  try { body = await res.json(); }
  catch (e) { die(`the response was not JSON (${e.message}).`); }
  if (!Array.isArray(body?.data)) die("the response carried no `data` array — the shape has changed.");

  all.push(...body.data);
  if (!body.has_more) break;
  cursor = body.next_cursor ?? body.cursor ?? null;
  if (!cursor) die("`has_more` was true and no cursor was returned — the page loop cannot be completed, "
    + "and a partial list written as complete is precisely the wide-snapshot failure this guards.");
}

if (!all.length) die("the office list came back EMPTY. An empty covered set reads as 'covers nothing' "
  + "and must never come from a failure path — see driver/register-availability.mjs.");

const offices = all.map((o) => ({
  key: String(o.legacy_code ?? "").trim(),
  code: String(o.code ?? "").trim().toUpperCase(),
  jurisdiction: String(o.jurisdiction_code ?? o.st3_code ?? o.code ?? "").trim().toUpperCase(),
  name: String(o.name_en ?? o.name ?? "").trim(),
  status: String(o.status ?? "").trim(),
  // DISCLOSABLE MATERIAL, captured whether or not anything reads it yet. WIPO on a weekly cadence is a
  // real limitation on a time-sensitive matter, and the product states that as prose today if at all.
  update_cadence: String(o.update_cadence ?? "").trim() || null,
  total_marks: Number.isFinite(o.total_marks) ? o.total_marks : null,
  last_synced_at: String(o.last_synced_at ?? "").trim() || null,
  coverage: o.coverage && typeof o.coverage === "object" ? o.coverage : null,
})).sort((a, b) => a.key.localeCompare(b.key));

for (const o of offices) {
  if (!o.key || !o.jurisdiction) die(`an office came back without a key or jurisdiction `
    + `(${JSON.stringify(o).slice(0, 120)}) — a nameless office cannot be mapped and must not be guessed.`);
}
const live = offices.filter((o) => o.status === "live");
if (!live.length) die(`${offices.length} office(s) returned and NONE is status:live. That would compile `
  + "to an empty covered set, which reads as 'covers nothing'. Refusing rather than writing it.");

// The fetch timestamp is an argument, not a clock read, so a re-run with the same input reproduces the
// same file: the snapshot is a reviewable diff, and a diff that changes on every run reviews nothing.
const stamp = String(process.env.SIGNA_SYNC_STAMP ?? "").trim() || new Date().toISOString();

const body = `// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl
// GENERATED by bin/signa-sync.mjs — do not edit by hand.
//
// This is the vendor's own office list, fetched and committed so that a change in what we claim to
// search arrives as a reviewable diff rather than as a different answer on a Tuesday. The endpoint
// exposes no version, etag or change feed, so this file IS the change detection.
//
// \`status\` is load-bearing: providers/signa/src/capabilities.js covers only the \`live\` ones. An office
// that stops being live leaves the covered set on the next sync, and this diff is where that is seen.
//
// Fetched: ${stamp}
export const SIGNA_OFFICE_SNAPSHOT = Object.freeze({
  fetched_at: ${JSON.stringify(stamp)},
  source: ${JSON.stringify(`${base}/v1/offices`)},
  offices: Object.freeze([
${offices.map((o) => `    Object.freeze(${JSON.stringify(o)}),`).join("\n")}
  ]),
});
`;

const before = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
writeFileSync(OUT, body);
console.log(`[signa-sync] ${offices.length} office(s), ${live.length} live → ${OUT.replace(`${join(HERE, "..")}/`, "")}`);
console.log(`[signa-sync] live: ${live.map((o) => o.jurisdiction).join(" ")}`);
const notLive = offices.filter((o) => o.status !== "live");
if (notLive.length) console.log(`[signa-sync] NOT covered (status not live): ${notLive.map((o) => `${o.jurisdiction}=${o.status}`).join(" ")}`);
if (before === body) console.log("[signa-sync] no change.");
else if (before === null) console.log("[signa-sync] FIRST snapshot — review it as you would any coverage claim.");
else console.log("[signa-sync] CHANGED — read the diff before merging; it changes what we claim to search.");
