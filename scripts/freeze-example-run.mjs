#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// freeze-example-run.mjs — capture ONE finished clearance run as a frozen, publishable sample.
//
//   node scripts/freeze-example-run.mjs --run-dir <archived run workspace> --out <dir> [--force]
//                                      [--codename <name>] [--run-id <id>] [--customer-key <key>]
//                                      [--keep-scratch]
//
// Exit 0 clean, 1 with findings, 2 if it could not look.
//
// WHAT THIS IS FOR
// `npm run example` must show a real report to somebody with no credentials, no model access and no engine.
// It does that by REPLAYING a finished run through the ordinary publisher. This script produces the thing
// it replays: the smallest subset of a run workspace that `publishReport` actually reads, with the
// dispatch payloads and telemetry left behind, proven to re-render.
//
// THE ALLOWLIST IS DERIVED, NOT DECLARED
// FROZEN_FILES below is one half of the answer — the paths traced from the reads in driver/publish/
// index.mjs, registry-fidelity.mjs and driver/tokens.mjs. A list of paths copied from a source file is a
// list that goes stale the first time somebody adds a read. So the list is not trusted: step 5 publishes
// the FULL source run and the FROZEN copy into two scratch pools and diffs them. If the allowlist dropped
// something the renderer wanted, the two reports differ and this script exits 1. That check is the
// contract; FROZEN_FILES is only its starting guess.
//
// WHAT IS DELIBERATELY DROPPED
//   _driver/*.dispatch.txt   the stage prompts sent to the model — the engine's internals, not the report's
//   _driver/*.jsonl          per-stage telemetry (models, session keys, token usage)
//   _driver/run.jsonl        the event log
//   _driver/stage-inputs/    what each stage was handed
//   _history/                pre-reopen snapshots
// Dropping the telemetry drops `meta.tokens` (driver/publish/index.mjs:971 — the only consumer of
// rollupTokens). That is the one difference step 5 is told to expect, and it says so out loud rather than
// normalising it away in silence.
//
// WHAT THIS SCRIPT DOES NOT DO
// It does not decide the sample is publishable. It greps for the shapes that must never leave the VM
// (absolute operator paths, credentials, staff mail) and fails on them. It does NOT re-implement
// driver/test/no-client-identifiers.test.mjs: that guard sweeps the whole tracked tree, so it sweeps the
// frozen example the moment it is committed, and a second copy of a validator drifts from the first.

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync,
  statSync, rmSync, mkdtempSync, cpSync, renameSync,
} from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── The allowlist ────────────────────────────────────────────────────────────────────────────────────
// Every entry cites the read that puts it here. `required` means publish cannot render without it.
const FROZEN_FILES = [
  // publish/index.mjs — parseReport(reportMd), the one mandatory input
  { path: "report.md", required: true, why: "publish/index.mjs:649 parseReport" },
  { path: "audit.md", why: "publish/index.mjs:835 audit workbook source" },
  { path: "findings.json", why: "publish/index.mjs:555 the per-finding machine contract" },
  { path: "status.json", why: "publish/index.mjs:730,905 machine ledger note + markName" },
  { path: "case-law-findings.md", why: "publish/index.mjs:660 case-law section" },
  { path: "common-law-grid.json", why: "publish/index.mjs:788 common-law coverage" },
  // publish/index.mjs — the _driver sidecars it reads by name
  { path: "_driver/receipts.json", why: "publish/index.mjs:592" },
  { path: "_driver/senior-rights.json", why: "publish/index.mjs:599" },
  { path: "_driver/verdict.json", why: "publish/index.mjs:604" },
  { path: "_driver/framework.json", why: "publish/index.mjs:608 the bands the run was rated under" },
  { path: "_driver/register-plan.json", why: "publish/index.mjs:634" },
  { path: "_driver/instructed-scope.json", why: "publish/index.mjs:641 fallback for register-plan" },
  { path: "_driver/enforcer-signals.json", why: "publish/index.mjs:672" },
  { path: "_driver/predelivery-lint.json", why: "publish/index.mjs:699,713" },
  { path: "_driver/escalation-state.json", why: "publish/index.mjs:714" },
  { path: "_driver/reasoning-integrity.json", why: "publish/index.mjs:715" },
  { path: "_driver/corrections-state.json", why: "publish/index.mjs:716" },
  { path: "_driver/search-policy.json", why: "publish/index.mjs:768,806 level + stage label" },
  { path: "_driver/profile.json", why: "publish/index.mjs:920 + report-registry.mjs:42 customer key" },
];

// ── THE KNOCKOUT LANE IS A DIFFERENT WORKSPACE, AND report.md IS NOT IN IT ─
//
// A knockout run never writes report.md: for that lane the markdown is an OUTPUT of publish, not an
// input to it (report-registry.mjs:60-67). The batch findings are the source. Freezing one used to
// refuse at the report.md gate with "not a finished clearance run workspace" — a message accurate about
// the tool and misleading about the run, which is how two good knockout captures read as broken runs.
//
// Cited the same way the clearance list is: every entry names the read that puts it here.
const KNOCKOUT_FILES = [
  { path: "knockout-findings.json", required: true, why: "report-registry.mjs:66 the batch findings ARE the report source" },
  { path: "knockout-plan.json", why: "report-registry.mjs:77 plan" },
  { path: "knockout-assessment.md", why: "the merged prose the lane writes (gateway.mjs:184)" },
  { path: "knockout-frame.md", why: "the batch scope note (gateway.mjs:65)" },
  { path: "email-body.md", why: "the delivery prose the lane writes beside the assessment" },
  { path: "status.json", why: "publish/index.mjs:730,905 machine ledger note + markName" },
  { path: "audit.md", why: "publish/index.mjs:835 audit workbook source" },
  // The _driver sidecars publishKnockout reads by name. framework.json is REQUIRED and says so at its
  // call site: a knockout re-rendered under today's bands would silently restate its verdict.
  { path: "_driver/framework.json", required: true, why: "report-registry.mjs:68 the bands it was rated under" },
  { path: "_driver/search-policy.json", why: "report-registry.mjs:71 level + stage label" },
  { path: "_driver/profile.json", why: "report-registry.mjs:72 customer key and the delivery overlay" },
  { path: "_driver/verdict.json", why: "publish/index.mjs:604" },
  { path: "_driver/receipts.json", why: "publish/index.mjs:592" },
  // THE COUNT SIDECARS, AND THE PROOF IS WHAT FOUND THEM. Without register-counts.json the republished
  // meta carries `registerCounts: undefined` where the source carried the provider, the taken-at stamp
  // and the per-mark counts — so the workbook's Register column and every counted figure in the
  // knockout report render empty (publish/knockout.mjs:140-155). Named by stages-knockout.mjs:32,41.
  { path: "_driver/register-counts.json", why: "publish/knockout.mjs:140-155 counted figures + the Register column" },
  { path: "_driver/register-records.json", why: "stages-knockout.mjs:41 the terms behind the close-variation axis" },
  { path: "_driver/instructed-scope.json", why: "publish/index.mjs:641 fallback for register-plan" },
];

/** The allowlist for a template. One place, so a new template cannot half-exist. */
const filesFor = (t) => (t === "knockout" ? KNOCKOUT_FILES : FROZEN_FILES);

// Whole directories copied by extension. readRecordArtifacts() in registry-fidelity.mjs readdirs _records/
// and parses every file in it, so the set cannot be enumerated ahead of time.
const FROZEN_DIRS = [
  { path: "_records", ext: ".json", why: "readRecordArtifacts() in registry-fidelity.mjs" },
];

// The knockout lane's directories. Same rule as _records/: the set cannot be enumerated ahead of time,
// so the whole directory travels by extension.
//
// research/ IS REQUIRED AND THE PROOF IS WHAT FOUND IT. publish/knockout.mjs
// traces every finding citation back to the run's own research payload — `research/<mark>.md`, read from
// the workspace (knockout.mjs:317) — and REFUSES the publish when a citation cannot be traced. The first
// knockout freeze copied nine files, left research/ behind, and the republish proof threw:
//
//   knockout publish REFUSED: 2 finding citation(s) could not be traced to this run's own research
//   payloads. knockout_url_unreceipted:VENQORI: cites "https://www.venqorgroup.com/" but the mark has
//   no research payload
//
// A code read of the allowlist would not have found that; publishing both sides and diffing did, which
// is the whole reason step 5 exists.
const KNOCKOUT_DIRS = [
  { path: "research", ext: ".md", why: "publish/knockout.mjs:317 receipt tracing — research/<mark>.md" },
  { path: "register-units", ext: ".json", why: "the per-unit register evidence the lane writes beside research/" },
];

/** The directories for a template, same shape as filesFor. */
const dirsFor = (t) => (t === "knockout" ? [...FROZEN_DIRS, ...KNOCKOUT_DIRS] : FROZEN_DIRS);

// ── Scrub battery ────────────────────────────────────────────────────────────────────────────────────
// Shapes that must never leave this VM inside a published artifact. Each is a finding, not a warning.
const SCRUB = [
  { id: "operator-home", re: /\/home\/(?:azureuser|devuser|testuser|devuser1)\b/g, what: "an operator home path" },
  { id: "production-pool", re: /\/srv\/trademark-archive/g, what: "the production pool root" },
  { id: "firm-mail", re: /[A-Za-z0-9._%+-]+@cordillera\.ch/g, what: "a firm email address" },
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{8,}/g, what: "an Anthropic API key" },
  { id: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, what: "a bearer token" },
  { id: "pplx-key", re: /\bpplx-[A-Za-z0-9]{16,}/g, what: "a Perplexity API key" },
  // A credential env var is fine as a NAME (docs say them constantly); it is a finding when it carries a value.
  {
    id: "credential-assignment",
    re: /\b(?:CORSEARCH_SESSION_KEY|CLARIVATE_API_KEY|SIGNA_API_KEY|EUIPO_CLIENT_SECRET|EUIPO_CLIENT_ID|PERPLEXITY_API_KEY|SERPAPI_API_KEY|ANTHROPIC_API_KEY|COURTLISTENER_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{6,}/g,
    what: "a credential with a value beside it",
  },
];

// Volatile output: recomputed on every publish, so it cannot be compared byte-for-byte. Each entry names
// what varies and why, and step 5 prints them — a normalisation nobody can see is a normalisation that
// hides the next real difference.
const VOLATILE = [
  { id: "issued", re: /\d{4}-\d{2}-\d{2} · \d{2}:\d{2} [A-Z]{2,5}/g, sub: "<issued>", why: "publish/index.mjs:520 generation stamp, firm locale" },
  { id: "iso-timestamp", re: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, sub: "<ts>", why: "publish/index.mjs:665 asOf / :1067 issuedAt" },
];

// ── REWRITES — what is CHANGED on the way out, as opposed to what is refused ───────────────────────
//
//. The scrub battery above REFUSES; these two rewrite, and the difference is
// that a refusal hands a person a list and a rewrite hands them a committable tree. Both classes were
// found by scanning a real freeze rather than by reading the code, and neither can be fixed by hand:
// one of them is 1,460 files.
//
// 1. THE BIRTH CODENAME, IN CONTENT. `--codename` rebuilds the run's IDENTITY — the leaf, the runId, the
//    directory — and the content keeps the old pair: `_receipt.context` in every record artifact reads
//    "prelim-<matter>-<codename>-register-unit-primary-sweep", and audit.md and status.json carry it in
//    prose. driver/test/no-client-identifiers.test.mjs check 2 sweeps CONTENT as well as paths, so a
//    tree renamed but not rewritten can never be committed — which is exactly what the old echo check
//    reported, correctly, and could do nothing about.
//
// 2. THE PAID REGISTER'S RECORD IDENTIFIERS. The export's own detector for this class states it: "the paid register's own record
//    identifiers, which are not ours to publish" — five letters then 32 hex. Substituted for canonical
//    dashed v4 UUIDs, which that module names in the same breath as "ours" and explicitly NOT the
//    refused class.
//
//    PUBLIC REGISTER NUMBERS ARE NOT TOUCHED. `eu-018948193` and its kin are public register facts and
//    are the demo's content by demo/README.md's own sentence. A rewrite that took them would be
//    destroying the thing the report is about.
//
//    DETERMINISTIC, so cross-references inside one run stay joined. The same key always yields the same
//    UUID, because a record artifact and the receipt that cites it must still agree afterwards — a
//    random substitution per occurrence would break every join in the frozen run and nothing would say
//    so until a reader opened the report and found a citation pointing at nothing.
const VENDOR_KEY_RE = /\b[A-Za-z]{5}[0-9a-fA-F]{32}\b/g;
const vendorKeyMap = new Map();

/**
 * ONE SUBSTITUTE PER IDENTIFIER, WHATEVER CASE IT IS WRITTEN.
 *
 * The vendor writes the same record id both ways inside one file — the filename in lowercase and the
 * artifact's own `uri` in upper:
 *
 *     ae-<vendorid>.json
 *     "uri": "/mark/ae/<VENDORID>"
 *
 * Keyed on the raw text those are two identifiers and get two UUIDs, so the uri stops pointing at the
 * file it names and the demo's own links go dead — silently, because both halves still look like
 * well-formed ids. Keyed on the lowercased form they are one identifier with one substitute and the
 * join survives. That is the same reason the substitution is deterministic at all, one level down.
 */
const substituteFor = (key) => {
  const k = String(key).toLowerCase();
  if (!vendorKeyMap.has(k)) vendorKeyMap.set(k, substituteVendorKey(k));
  return vendorKeyMap.get(k);
};

const substituteVendorKey = (key) => {
  const h = createHash("sha256").update(`clearotron-demo-substitution:${key}`).digest("hex");
  // Canonical v4 shape: version nibble 4, variant nibble one of 8/9/a/b. Built rather than sliced raw,
  // so what comes out satisfies CANONICAL_UUID_RE instead of merely looking like it does.
  const variant = "89ab"[parseInt(h[16], 16) % 4];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// meta.json keys the freeze is EXPECTED to change, with the reason. Anything else differing is a finding.
const EXPECTED_META_DELTA = {
  tokens: "telemetry pruned — _driver/*.jsonl is the only source (driver/tokens.mjs:82)",
};

// ── args ─────────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);

const runDir = flag("--run-dir");
const outDir = flag("--out");
const USAGE = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n").replace(/^\/\/ ?/gm, "");
// Asking for help is not an error: --help prints to stdout and exits 0. Missing arguments IS one, and
// exits 2 — "could not look", the same code every other script here uses for it.
if (has("--help") || has("-h")) { console.log(USAGE); process.exit(0); }
if (!runDir || !outDir) { console.error(USAGE); process.exit(2); }

const findings = [];
const note = (msg) => console.log(`  ${msg}`);
const finding = (msg) => { findings.push(msg); console.error(`  FINDING: ${msg}`); };

// ── 1. read the source ───────────────────────────────────────────────────────────────────────────────
console.log(`\nfreeze-example-run\n  source: ${runDir}\n  out:    ${outDir}\n`);
console.log("1. source run");
if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
  console.error(`freeze-example-run: no run directory at ${runDir}`);
  process.exit(2);
}
// ── WHICH LANE THIS RUN CAME FROM ───────────────────────────────────────
//
// Detected from the workspace, not asked for: a knockout run is the one that wrote
// knockout-findings.json, which is the file its publisher reads as the report source. `--template`
// overrides, and an override that contradicts the workspace SAYS so rather than proceeding quietly —
// the whole reason this gate is being touched is that its old message described the tool's expectation
// and not the run in front of it.
const detected = existsSync(join(runDir, "knockout-findings.json")) ? "knockout" : "clearance";
const template = flag("--template") ?? detected;
if (template !== "clearance" && template !== "knockout") {
  console.error(`freeze-example-run: --template must be "clearance" or "knockout", not ${JSON.stringify(template)}`);
  process.exit(2);
}
if (template !== detected) note(`--template ${template} overrides what the workspace looks like (${detected})`);

// THE REQUIRED SET IS THE TEMPLATE'S, AND THE REFUSAL NAMES THE RUN RATHER THAN THE TOOL. The old gate
// demanded report.md of everything and told a knockout capture it was "not a finished clearance run
// workspace" — true of the tool, false about the run, and it read as two good captures being broken.
const missingRequired = filesFor(template).filter((f) => f.required && !existsSync(join(runDir, f.path)));
if (missingRequired.length) {
  console.error(`freeze-example-run: ${runDir} looks like a ${template} run and is missing `
    + `${missingRequired.map((f) => f.path).join(", ")} — required by ${missingRequired.map((f) => f.why).join("; ")}.`);
  if (template === "clearance" && existsSync(join(runDir, "knockout-findings.json")))
    console.error("  It carries knockout-findings.json, so it is probably a knockout run: pass --template knockout.");
  process.exit(2);
}
// A run that never delivered is a run whose report was never fit to show. Say so; do not refuse — a
// deliberately-captured mid-verdict sample is a legitimate thing to want, it just must not be silent.
if (!existsSync(join(runDir, ".delivered"))) note("no .delivered sentinel — this run did not finish delivery");

// The run id is the archived directory's identity as the pool knows it: <matter>-<date>-<codename>.
// Derived from the workspace layout (…/archive/<yyyy-mm>/<matter>/<date>-<codename>) rather than guessed.
// The examples here are deliberately not real run codenames: driver/test/no-client-identifiers.test.mjs
// refuses any <adj>-<noun> pair from driver/phase0.mjs's generator vocabulary ANYWHERE in the tracked
// tree, and a plausible one written into a comment fails that guard exactly as a real one would.
const leaf = basename(runDir);                          // 2026-01-01-<codename>
const matter = basename(dirname(runDir));               // tmp2201-<mark>
const sourceDate = leaf.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)?.[1] ?? null;
const sourceCodename = leaf.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)?.[1] ?? "";

// RENAMING IS PART OF THE JOB, NOT A CONVENIENCE.
// Every run codename is an <adj>-<noun> pair from driver/phase0.mjs's generator, and check 2 of
// driver/test/no-client-identifiers.test.mjs refuses any such pair ANYWHERE in the tracked tree —
// content and paths alike. So a frozen example keeping its birth codename can never be committed. That
// makes `--codename` a rename of the whole identity, not a cosmetic field: it rebuilds the leaf, so the
// runId, the pool directory and the manifest all follow. `--run-id` overrides the lot for a run whose
// workspace does not follow the archive layout.
const codename = flag("--codename") ?? sourceCodename;
const renamed = codename !== sourceCodename;
const newLeaf = renamed && sourceDate ? `${sourceDate}-${codename}` : leaf;
const runId = flag("--run-id") ?? `${matter}-${newLeaf}`;
if (renamed && !sourceDate) note(`--codename given but ${leaf} carries no <date>-<codename> shape — runId left as derived; pass --run-id to set it outright`);
const readJsonOr = (p, f = null) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return f; } };
const profile = readJsonOr(driverDir(runDir, "profile.json"));
const customerKey = flag("--customer-key") ?? profile?.profileKey ?? "generic";
note(`runId=${runId} codename=${codename || "(none)"} customerKey=${customerKey}`);
if (renamed) note(`renamed from ${sourceCodename} — step 4 lists every frozen file still carrying the old one`);

// ── 2. copy the allowlist ────────────────────────────────────────────────────────────────────────────
console.log("\n2. allowlist copy");
if (existsSync(outDir)) {
  if (!has("--force")) {
    console.error(`freeze-example-run: ${outDir} exists — pass --force to replace it.`);
    process.exit(2);
  }
  rmSync(outDir, { recursive: true, force: true });
}
const frozenRun = join(outDir, "run");
mkdirSync(frozenRun, { recursive: true });

const copied = [];
for (const entry of filesFor(template)) {
  const src = join(runDir, entry.path);
  if (!existsSync(src)) {
    if (entry.required) { finding(`required input absent: ${entry.path} (${entry.why})`); }
    else note(`absent: ${entry.path}`);
    continue;
  }
  const dst = join(frozenRun, entry.path);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied.push(entry.path);
}
for (const dir of dirsFor(template)) {
  const src = join(runDir, dir.path);
  if (!existsSync(src)) { note(`absent: ${dir.path}/ (${dir.why})`); continue; }
  mkdirSync(join(frozenRun, dir.path), { recursive: true });
  for (const name of readdirSync(src)) {
    if (!name.endsWith(dir.ext)) continue;
    copyFileSync(join(src, name), join(frozenRun, dir.path, name));
    copied.push(join(dir.path, name));
  }
}
note(`${copied.length} file(s) copied`);

// ── 2b. rewrite ──────────────────────────────────────────────────────────────────────────────────────
//
//. Two classes, both measured on real freezes, neither fixable by hand — one of
// them touched 1,460 files in a single run. See the REWRITES header above for why each is here and why
// public register numbers are deliberately not among them.
//
// THE ORDER MATTERS AND IS NOT INCIDENTAL: the codename goes first. A vendor key is substituted for a
// UUID that contains no letters in runs of five, so it can never manufacture a codename; a codename
// rewrite cannot manufacture a vendor key either. Doing keys first would be equally safe today and
// would stop being safe the moment either pattern widened, so the pass that changes the most text runs
// against the original bytes rather than against the other pass's output.
console.log("\n2b. rewrite");
let cnFiles = 0, cnHits = 0, vkFiles = 0, vkHits = 0;
for (const rel of copied) {
  const path = join(frozenRun, rel);
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }   // a binary member of _records/ is not text
  const before = text;

  if (renamed && sourceCodename) {
    // Every occurrence, in prose and inside JSON string values alike. A JSON-aware walk would miss
    // audit.md, and a key-name-aware one would miss `_receipt.context`, which is where it actually hides.
    const parts = text.split(sourceCodename);
    if (parts.length > 1) { cnFiles++; cnHits += parts.length - 1; text = parts.join(codename); }
  }

  const keys = text.match(VENDOR_KEY_RE);
  if (keys?.length) {
    vkFiles++; vkHits += keys.length;
    for (const k of new Set(keys)) substituteFor(k);
    text = text.replace(VENDOR_KEY_RE, substituteFor);
  }

  if (text !== before) writeFileSync(path, text);
}

// THE PATHS CARRY THE CLASS TOO, AND CONTENT-ONLY SCANS CANNOT SEE IT.
//
// Measured after the content pass was already working and two independent scans read clean: 1,455 of
// 1,473 files in one product demo, and 193 of 212 in another, carry the record identifier in their
// FILENAME — `_records/us-<vendorid>.json`. Both scans reported zero because
// `scanRecordKeys(files, read)` reads what `read` returns and both of us handed it file CONTENT.
// Nothing was wrong with the instrument; it was asked about the wrong population twice, and the two
// answers agreeing was read as corroboration.
//
// The committed-content guard for codenames already sweeps "content and paths alike" for exactly this
// reason. This is that rule applied to the other class.
//
// THE SAME MAP AS THE CONTENT PASS, which is what keeps the tree joined: a filename and every reference
// to it inside the run — including the artifact's own `uri`, which the vendor writes in UPPER case —
// resolve to one substitute. A second renaming scheme here would break every one of those silently.
let pathRenames = 0;
for (let i = 0; i < copied.length; i++) {
  const rel = copied[i];
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  VENDOR_KEY_RE.lastIndex = 0;
  if (!VENDOR_KEY_RE.test(base)) { VENDOR_KEY_RE.lastIndex = 0; continue; }
  VENDOR_KEY_RE.lastIndex = 0;
  const newRel = rel.slice(0, rel.lastIndexOf("/") + 1) + base.replace(VENDOR_KEY_RE, substituteFor);
  renameSync(join(frozenRun, rel), join(frozenRun, newRel));
  copied[i] = newRel;                       // every later step reads this list — scrub, echo, prune count
  pathRenames++;
}
note(`vendor record keys in PATHS: ${pathRenames} file(s) renamed`);
note(renamed && sourceCodename
  ? `codename: ${cnHits} occurrence(s) in ${cnFiles} file(s) rewritten "${sourceCodename}" -> "${codename}"`
  : "codename: not renamed (--codename not given, or it matches the source) — nothing rewritten");
note(`vendor record keys: ${vkHits} occurrence(s) in ${vkFiles} file(s) substituted, ${vendorKeyMap.size} distinct key(s)`);

// PROVED, NOT ASSUMED — and this is the half that makes the counts above worth printing. A rewrite that
// silently matched nothing prints "0 occurrence(s)" and reads exactly like a tree that was already
// clean. The export's vendor-key detector records that trap in its own header: its first cut looked for
// version-1 UUIDs, found zero, and the zero was a claim about the detector. So the frozen tree is
// re-read here and any survivor of either class is a FINDING, whatever the counters said.
{
  const survivorsCn = [], survivorsVk = [];
  for (const rel of copied) {
    let t; try { t = readFileSync(join(frozenRun, rel), "utf8"); } catch { continue; }
    if (renamed && sourceCodename && t.includes(sourceCodename)) survivorsCn.push(rel);
    VENDOR_KEY_RE.lastIndex = 0;   // a /g regex carries lastIndex across .test() calls
    if (VENDOR_KEY_RE.test(t)) survivorsVk.push(rel);
    VENDOR_KEY_RE.lastIndex = 0;
    // AND THE PATH. Both scans that missed this class read content only; the re-read must not repeat it.
    if (VENDOR_KEY_RE.test(rel)) survivorsVk.push(`${rel} (in its own name)`);
    VENDOR_KEY_RE.lastIndex = 0;
  }
  if (survivorsCn.length) finding(`${survivorsCn.length} file(s) still carry the source codename after the rewrite: ${survivorsCn.slice(0, 8).join(", ")}${survivorsCn.length > 8 ? ", …" : ""}`);
  if (survivorsVk.length) finding(`${survivorsVk.length} file(s) still carry a vendor record key after substitution: ${survivorsVk.slice(0, 8).join(", ")}${survivorsVk.length > 8 ? ", …" : ""}`);
  if (!survivorsCn.length && !survivorsVk.length) note("re-read the frozen tree: no codename and no vendor record key survived");
}

// ── 3. prune proof ───────────────────────────────────────────────────────────────────────────────────
// Not "we did not copy them" — "they are not there". The assertion is over the output tree, so a future
// allowlist entry that drags a dispatch payload in is caught here rather than in a reviewer's eye.
console.log("\n3. prune proof");
const walk = (root, base = root) => {
  const out = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
};
const frozenFiles = walk(frozenRun);
const PRUNED = [
  { re: /\.dispatch\.txt(?:\.prev-[0-9a-f]+)?$/, what: "stage dispatch payloads" },
  { re: /\.jsonl$/, what: "per-stage telemetry" },
  { re: /^_driver\/stage-inputs\//, what: "stage inputs" },
  { re: /^_history\//, what: "pre-reopen history" },
];
for (const p of PRUNED) {
  const survivors = frozenFiles.filter((f) => p.re.test(f));
  if (survivors.length) finding(`${p.what} survived the freeze: ${survivors.slice(0, 5).join(", ")}`);
  else note(`no ${p.what}`);
}
const sourceCount = walk(runDir).length;
note(`${sourceCount} file(s) in the source run → ${frozenFiles.length} frozen`);

// ── 4. scrub ─────────────────────────────────────────────────────────────────────────────────────────
console.log("\n4. scrub");
let scrubHits = 0;
for (const rel of frozenFiles) {
  let text;
  try { text = readFileSync(join(frozenRun, rel), "utf8"); } catch { continue; }
  for (const rule of SCRUB) {
    rule.re.lastIndex = 0;
    const hits = text.match(rule.re);
    if (!hits) continue;
    scrubHits += hits.length;
    // Never print the match — the match IS the secret on four of these six rules.
    finding(`${rel}: ${hits.length}× ${rule.what} [${rule.id}]`);
  }
}
if (!scrubHits) note(`${SCRUB.length} rule(s), 0 hits across ${frozenFiles.length} file(s)`);

// THE CODENAME ECHO. `--codename` renames the run's identity, but the birth codename is written INTO the
// artifacts — status.json alone is 14KB of engine state. Every file still carrying it has to be rewritten
// by hand before the sample can be committed, because check 2 of no-client-identifiers.test.mjs sweeps
// content as well as paths. This is not a second copy of that guard's vocabulary table: it greps for ONE
// literal this script already knows, and its job is to hand the person landing the sample the exact list.
if (sourceCodename) {
  const echoes = frozenFiles.filter((rel) => {
    try { return readFileSync(join(frozenRun, rel), "utf8").includes(sourceCodename); } catch { return false; }
  });
  if (!echoes.length) note(`no file carries the source codename "${sourceCodename}"`);
  else if (renamed) finding(`${echoes.length} frozen file(s) still carry the source codename "${sourceCodename}" — rewrite each before committing: ${echoes.join(", ")}`);
  else note(`${echoes.length} file(s) carry the run's codename "${sourceCodename}" — a committed sample needs it renamed (--codename) and these rewritten: ${echoes.join(", ")}`);
}

// ── 5. republish proof ───────────────────────────────────────────────────────────────────────────────
// The one check that can tell the allowlist is complete: publish BOTH and diff. Same process, so
// engineCommit() is cached to one value and cannot differ between the two.
console.log("\n5. republish proof");
const scratch = mkdtempSync(join(tmpdir(), "freeze-proof-"));
const poolFull = join(scratch, "full");
const poolFrozen = join(scratch, "frozen");
const meta = { runId, codename, customerKey, template };

const { republishRun } = await import(join(REPO, "driver", "publish", "report-registry.mjs"));
const publishInto = async (pool, dir) => {
  mkdirSync(pool, { recursive: true });
  return republishRun({ runId, meta, pool, poolUrl: "", runDir: dir, skipRegen: true });
};

// THE SOURCE SIDE IS REWRITTEN TOO, OR THIS CHECK ANSWERS THE WRONG QUESTION.
//
// The proof asks one thing: does the frozen ALLOWLIST render what the full run renders. Since step 2b
// the frozen copy also has its codename and its vendor keys rewritten, and the source does not — so a
// straight diff reports every rewritten byte as an allowlist gap. Measured on the first real freeze:
// three findings (audit.md, report-data.json, report.html), all of them the rewrite working exactly as
// intended and none of them a dropped input.
//
// A check that fires on every correct run is a check everyone learns to skip, and it would have been
// firing over the one signal it exists to carry. So the rewrite is held CONSTANT across the comparison:
// the source is staged and put through the same pass, and what remains is only ever an allowlist gap.
//
// A COPY, never the archive. The source run is real client matter; nothing here writes to it.
const rewriteInPlace = (root, files) => {
  for (const rel of files) {
    const path = join(root, rel);
    let t; try { t = readFileSync(path, "utf8"); } catch { continue; }
    const before = t;
    if (renamed && sourceCodename) t = t.split(sourceCodename).join(codename);
    t = t.replace(VENDOR_KEY_RE, substituteFor);
    if (t !== before) writeFileSync(path, t);
  }
};

let sourceForProof = runDir;
if ((renamed && sourceCodename) || vendorKeyMap.size) {
  const staged = join(scratch, "source");
  cpSync(runDir, staged, { recursive: true });
  const stagedFiles = [];
  const walkRel = (d, base = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walkRel(join(d, e.name), rel); else stagedFiles.push(rel);
    }
  };
  walkRel(staged);
  rewriteInPlace(staged, stagedFiles);
  sourceForProof = staged;
  note(`source staged and put through the same rewrite (${stagedFiles.length} file(s)) — the diff below `
    + "answers about the allowlist alone");
}

let proofOk = false;
try {
  await publishInto(poolFull, sourceForProof);
  await publishInto(poolFrozen, frozenRun);
  proofOk = true;
} catch (e) {
  finding(`republish threw: ${String(e?.message ?? e).slice(0, 300)}`);
}

if (proofOk) {
  const normalise = (s) => VOLATILE.reduce((acc, v) => acc.replace(v.re, v.sub), s);
  for (const v of VOLATILE) note(`normalised ${v.id} — ${v.why}`);

  const listOf = (pool) => {
    const d = join(pool, runId);
    return existsSync(d) ? readdirSync(d).sort() : [];
  };
  const a = listOf(poolFull), b = listOf(poolFrozen);
  const missing = a.filter((f) => !b.includes(f));
  const extra = b.filter((f) => !a.includes(f));
  if (missing.length) finding(`the frozen run publishes fewer artifacts: missing ${missing.join(", ")}`);
  if (extra.length) finding(`the frozen run publishes artifacts the source does not: ${extra.join(", ")}`);

  for (const name of b.filter((f) => a.includes(f))) {
    // The workbook is a zip container — its bytes carry timestamps and are not comparable. Its inputs
    // (audit.md, findings.json) are compared directly, which is the property that matters.
    if (name.endsWith(".xlsx")) { note(`skipped ${name} (zip container, timestamped)`); continue; }
    const rawA = readFileSync(join(poolFull, runId, name), "utf8");
    const rawB = readFileSync(join(poolFrozen, runId, name), "utf8");
    if (name === "meta.json") {
      const mA = JSON.parse(rawA), mB = JSON.parse(rawB);
      for (const k of ["issuedAt"]) { delete mA[k]; delete mB[k]; }
      const keys = [...new Set([...Object.keys(mA), ...Object.keys(mB)])];
      for (const k of keys) {
        if (JSON.stringify(mA[k]) === JSON.stringify(mB[k])) continue;
        if (EXPECTED_META_DELTA[k]) { note(`meta.${k} differs as expected — ${EXPECTED_META_DELTA[k]}`); continue; }
        finding(`meta.${k} differs after freeze: source=${JSON.stringify(mA[k])?.slice(0, 120)} frozen=${JSON.stringify(mB[k])?.slice(0, 120)}`);
      }
      continue;
    }
    if (normalise(rawA) === normalise(rawB)) { note(`${name} identical (${rawB.length} bytes)`); continue; }
    finding(`${name} differs between the source run and the frozen copy — the allowlist dropped an input the renderer reads`);
  }
}
if (!has("--keep-scratch")) rmSync(scratch, { recursive: true, force: true });
else note(`scratch pools kept at ${scratch}`);

// ── 6. write the example manifest ─────────────────────────────────────────────────────────────────────
// Deliberately NOT the published meta.json: that carries issuedAt, engineCommit and a token rollup, all
// stamps of the machine that produced it. Only the four fields republishRun actually reads as INPUTS.
console.log("\n6. manifest");
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
note(`meta.json → ${JSON.stringify(meta)}`);
writeFileSync(join(outDir, "PROVENANCE.md"),
  `# Example run — provenance\n\n`
  + `Frozen by \`scripts/freeze-example-run.mjs\` from one finished clearance run.\n\n`
  + `- Run id: \`${runId}\`\n`
  + `- Frozen inputs: ${copied.length} file(s), the subset \`publishReport\` reads\n`
  + `- Dropped: stage dispatch payloads, per-stage telemetry, stage inputs, run event log, history\n\n`
  + `\`npx clearotron demo\` republishes this directory into a local pool and serves it. Nothing here calls a\n`
  + `model, a register or the network.\n\n`
  + `Regenerate with:\n\n`
  + "```\n"
  + `node scripts/freeze-example-run.mjs --run-dir <archived run> --out demo --force\n`
  + "```\n");

// ── verdict ──────────────────────────────────────────────────────────────────────────────────────────
if (!findings.length) {
  console.log(`\nno findings. Frozen example at ${outDir}\n`);
  process.exit(0);
}
console.error(`\n${findings.length} finding(s):`);
for (const f of findings) console.error(`  - ${f}`);
console.error("");
process.exit(1);
