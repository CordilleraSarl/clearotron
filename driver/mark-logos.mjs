// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// mark-logos.mjs — the logo of each cited registration, fetched once the findings are final and saved with the run.
//
// A lawyer compares logos first, and the report showed none. So after the record is final and before the report is
// published, both pipelines run this one step: for each registration the report will show, it reads the run's saved
// record, and where that record says the mark is figurative and that an image exists, it asks the register the run is
// set to use for that one image. It writes what happened to each registration in `_driver/logos.json`, which the report
// reads, and the images under `_driver/logos/`.
//
// WHICH REGISTRATIONS. The ones the report shows and no others: a clearance's findings, withdrawn ones left out, and
// the registrations each cites; a Knockout's listed filings. Measured on a 55-finding global preliminary of 2026-11-03:
// 28 of the 3,497 records it held, so 28 image requests (Krzys approved that count, 2026-11-18).
//
// WHAT A ROW SAYS, and only `failed` reads as "Logo not retrieved" on the page:
//   fetched   the image is saved; `file` is relative to the run folder, `contentType` PNG, JPEG, GIF or WebP
//   failed    a request was made and did not land, or brought back something that is not one of those images
//   no-logo   the record says a word mark, or that no image exists
//   unknown   the record cannot say, or this run makes no register call: a replay, an injected fetcher, no credential,
//             or a register whose adapter fetches no image. Nothing is requested.
//
// THE REGISTER THE RUN IS SET TO USE, AND NO OTHER (Krzys, 2026-11-18: "we dont mix and match"). A register that
// cannot fetch an image leaves its rows `unknown`; no second service is asked.
//
// A RESUME OR A REPUBLISH ASKS NOTHING AGAIN. A row already `fetched` whose file is still there is kept as it is.
//
// RECORDING ONLY, and it never throws: a logo that could not be had never stops a report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRecordUri } from "../providers/_shared/record-uri.mjs";
import { readRecordArtifacts } from "./registry-fidelity.mjs";
import { DRIVER_DIR, driverDir } from "./run-record.mjs";
import { runLog } from "./log.mjs";

export const LOGOS_FILE = "logos.json";
export const LOGOS_DIR = "logos";

// The register's own words for the kind of mark, as saved records carry them (counted on the test machine,
// 2026-11-18: Clarivate's eight values and Signa's three). Any other value is unknown and fetches nothing.
const FIGURATIVE = new Set(["WORD AND DESIGN", "DESIGN MARK", "DESIGN AND COLOR", "STYLIZED LETTERS", "COMBINED", "FIGURATIVE"]);
const WORD = new Set(["WORD ONLY", "WORD MARK", "BLOCK LETTERS", "WORD"]);

/** Whether a saved record carries a logo: "logo", "no-logo" or "unknown". PURE. */
export function logoOf(record) {
  if (!record || typeof record !== "object") return "unknown";
  const feature = String(record.markFeature ?? "").trim().toUpperCase();
  if (record.imageAvailable === false || WORD.has(feature)) return "no-logo";
  return FIGURATIVE.has(feature) && record.imageAvailable === true ? "logo" : "unknown";
}

/** The image type the bytes open as, by their first bytes, or null for anything else. PURE. */
export function imageTypeOf(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return { type: "image/gif", ext: "gif" };
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

/** The registrations the report will show, in its order and once each. PURE. */
export function citedRefs({ findings = null, registerRecords = null } = {}) {
  const out = [];
  const add = (ref) => { const k = normalizeRecordUri(ref); if (k && !out.includes(k)) out.push(k); };
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f?.disposition === "withdrawn") continue;
    for (const r of Array.isArray(f?.owner?.registrations) ? f.owner.registrations : []) add(r?.uri);
  }
  for (const m of Array.isArray(registerRecords?.marks) ? registerRecords.marks : [])
    for (const r of Array.isArray(m?.records) ? m.records : []) add(r?.recordId);
  return out;
}

const fileFor = (ref, ext) => `${ref.replace(/^\/mark\//, "").replace(/[^a-z0-9_-]+/gi, "-")}.${ext}`;

/**
 * The rows for these registrations: kept where an earlier pass saved the image, fetched where the record carries a logo
 * and a request may be made, and said for the rest. `fetchImage(ref)` resolves `{ ok, bytes, contentType }` or
 * `{ ok: false, cause }`; `mayCall` is `{ ok }` or `{ ok: false, why }`. Writes the images it fetched. IMPURE.
 */
export async function logoRows({ runDir, refs, records, register, fetchImage, mayCall, prior = [] }) {
  const kept = new Map(prior.filter((r) => r?.state === "fetched" && r.file && existsSync(join(runDir, r.file))).map((r) => [r.ref, r]));
  const rows = [];
  for (const ref of refs) {
    if (kept.has(ref)) { rows.push(kept.get(ref)); continue; }
    const record = records.get(ref);
    if (!record) { rows.push({ ref, register, state: "unknown", cause: "the run holds no saved record of this registration" }); continue; }
    const has = logoOf(record);
    if (has !== "logo") {
      rows.push({ ref, register, state: has, ...(has === "unknown" ? { cause: "the record does not say whether the mark has a logo" } : {}) });
      continue;
    }
    if (!mayCall?.ok) { rows.push({ ref, register, state: "unknown", cause: mayCall?.why ?? "this run makes no register call" }); continue; }
    if (typeof fetchImage !== "function") { rows.push({ ref, register, state: "unknown", cause: "this register's adapter fetches no image" }); continue; }
    let got;
    try { got = await fetchImage(ref); } catch (e) { got = { ok: false, cause: `the request threw: ${String(e?.message ?? e).slice(0, 120)}` }; }
    if (!got?.ok) { rows.push({ ref, register, state: "failed", cause: String(got?.cause ?? "the request did not land").slice(0, 200) }); continue; }
    const kind = imageTypeOf(got.bytes);
    if (!kind) { rows.push({ ref, register, state: "failed", cause: "the answer is not a PNG, JPEG, GIF or WebP image" }); continue; }
    const file = `${DRIVER_DIR}/${LOGOS_DIR}/${fileFor(ref, kind.ext)}`;   // relative to the run folder, the same on every system
    try {
      mkdirSync(driverDir(runDir, LOGOS_DIR), { recursive: true });
      writeFileSync(join(runDir, file), got.bytes);
      rows.push({ ref, register, state: "fetched", file, contentType: kind.type, bytes: got.bytes.length });
    } catch (e) { rows.push({ ref, register, state: "failed", cause: `the image could not be saved: ${String(e?.message ?? e).slice(0, 120)}` }); }
  }
  return rows;
}

/**
 * The step both pipelines run before publishing. `findingsPath` for a clearance, `registerRecordsPath` for a Knockout;
 * `provider` is the run's register adapter; `injectedFetcher` true when the run answers its record fetches itself (a
 * replay, a test). Writes `_driver/logos.json`; returns it, or null when it could not. Never throws.
 */
export async function markLogos(runDir, { findingsPath = null, registerRecordsPath = null, provider = null, injectedFetcher = false,
  env = process.env, agentId = null, sessionKey = null } = {}) {
  try {
    const read = (p) => { try { return p ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };
    const findings = read(findingsPath)?.findings ?? null;
    const refs = citedRefs({ findings, registerRecords: read(registerRecordsPath) });
    const at = driverDir(runDir, LOGOS_FILE);
    const prior = read(at)?.rows ?? [];
    const register = provider?.id ?? null;
    const credential = provider?.credEnv ? String(env[provider.credEnv] ?? "").trim() : "";
    const mayCall = injectedFetcher ? { ok: false, why: "this run answers its record fetches from saved records and makes no register call" }
      : !provider ? { ok: false, why: "no register is set for this run" }
        : !credential ? { ok: false, why: `${provider.credEnv ?? "the register's credential"} is not set, so no register call is made` }
          : { ok: true };
    const fetchImage = typeof provider?.markImage === "function" ? (ref) => provider.markImage(ref, { agentId, sessionKey }) : null;
    const rows = await logoRows({ runDir, refs, records: readRecordArtifacts(runDir), register, fetchImage, mayCall, prior });
    const doc = { schema: 1, register, takenAt: new Date().toISOString(), rows };
    writeFileSync(at, JSON.stringify(doc, null, 2) + "\n");
    return doc;
  } catch { return null; }
}

/** The run's log line for the step: how many registrations ended in each state, or that the step could not write. */
export function logosStep(runDir, doc) {
  const counts = {};
  for (const r of doc?.rows ?? []) counts[r.state] = (counts[r.state] ?? 0) + 1;
  try { runLog(runDir, doc ? { event: "logos", register: doc.register, ...counts } : { event: "logos-not-written" }); } catch { /* a log line never stops a publish */ }
  return counts;
}
