// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// knockout-register-record.mjs — record_knockout_register_read: the knockout's reading step, as a typed return path.
//
// The step asks its questions through the register's own tool, which writes every answer to the band itself. What
// comes back here is the part only judgment can say, per name: the filings it carries forward, what it set aside and
// why, and the questions it chose not to ask. The driver joins each to the band, so a record id is one the register
// returned, and refuses a record that leaves a read list, a crowd or a count unaccounted for: nothing set aside goes
// without its reason.
//
// THE ARTIFACT IS AT THE RUN ROOT, the rule the rest of this lane follows: `_driver/` holds the driver's own
// measurements, and this is a model's output.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { captureCall, stampVerdict } from "./call-capture.mjs";
import { DRIVER_DIR, driverDir } from "../shared/driver-dir.mjs";
import { refuseUndeclared, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
import { carriedIds, formQid, formsOfName, knockoutBandBlocks, knockoutProposals, openingQid, questionsOwed } from "./knockout-register-read.mjs";

const TOKEN = "knockoutregisterread";
const SCHEMA_VERSION = 1;

const DECLARED = {
  "": ["schema_version", "marks"],
  marks: ["name", "carried", "set_aside", "not_asked", "open_questions"],
  "marks.carried": ["records", "why", "check_owner"],
  "marks.set_aside": ["question", "records", "why"],
  "marks.not_asked": ["question", "why"],
};

/** The artifact this transport writes, at the run root. */
export const knockoutRegisterFile = (runDir) => join(String(runDir ?? ""), "knockout-register.json");

/** One file per call, refusals included, beside the other transports' capture directories. */
export function knockoutRegisterCallPaths(runDir) {
  const dir = driverDir(runDir, "knockout-register-calls");
  return { dir, accepted: join(dir, "accepted.json"), refusals: join(dir, "refusals.jsonl") };
}

const nameKey = (s) => String(s ?? "").trim().toLowerCase();
const text = (v) => (typeof v === "string" ? v.trim() : "");

/** A repair call merges by name onto what was accepted: a name it omits keeps its row, one it sends is replaced whole. PURE. */
export function mergeKnockoutRegisterCall(prior, received) {
  if (!prior) return received;
  const byName = new Map((Array.isArray(prior.marks) ? prior.marks : []).map((m) => [nameKey(m?.name), m]));
  for (const m of Array.isArray(received?.marks) ? received.marks : []) byName.set(nameKey(m?.name), m);
  return { ...prior, ...received, marks: [...byName.values()] };
}

/** The call's own shape, before anything on disk is read. PURE. */
export function acceptKnockoutRegister(call) {
  const refuse = (what) => ({ ok: false, reason: `${TOKEN}_${what}` });
  if (!Array.isArray(call?.marks) || !call.marks.length) return refuse("marks: send one row per instructed name.");
  const seen = new Set();
  const marks = [];
  for (const m of call.marks) {
    const name = text(m?.name);
    if (!name) return refuse("name: every row names the instructed name it answers for, verbatim.");
    if (seen.has(nameKey(name))) return refuse(`duplicate:${name}: one row per name.`);
    seen.add(nameKey(name));
    for (const key of ["carried", "set_aside", "not_asked"]) {
      if (!Array.isArray(m?.[key])) return refuse(`${key}:${name}: send a list; an empty one says there is none.`);
    }
    for (const g of m.carried) {
      if (!Array.isArray(g?.records) || !g.records.length) return refuse(`carried_records:${name}: each carried group names its record ids.`);
      if (!text(g?.why)) return refuse(`carried_why:${name}: a carried group says why, in one reason for the group.`);
    }
    for (const key of ["set_aside", "not_asked"]) {
      for (const row of m[key]) {
        if (!text(row?.question)) return refuse(`${key}_question:${name}: each row names the question it is about.`);
        if (!text(row?.why)) return refuse(`${key}_why:${name}: ${text(row?.question)} carries no reason. Write down why.`);
      }
    }
    marks.push({ name,
      carried: m.carried.map((g) => ({ records: [...new Set(g.records.map((r) => String(r)))], why: text(g.why), ...(g.check_owner === true ? { check_owner: true } : {}) })),
      set_aside: m.set_aside.map((r) => ({ question: text(r.question), ...(Array.isArray(r.records) && r.records.length ? { records: r.records.map(String) } : {}), why: text(r.why) })),
      not_asked: m.not_asked.map((r) => ({ question: text(r.question), why: text(r.why) })),
      open_questions: (Array.isArray(m.open_questions) ? m.open_questions : []).map(text).filter(Boolean) });
  }
  return { ok: true, model: { schema_version: SCHEMA_VERSION, marks } };
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/** The accepted record against this run: one row per instructed name, ids the register returned, nothing unaccounted for. */
export function checkKnockoutRegisterAgainstRun(model, runDir) {
  const scope = readJson(driverDir(runDir, "instructed-scope.json"));
  const instructed = (Array.isArray(scope?.marks) ? scope.marks : []).map((n) => String(n));
  if (!instructed.length) return { ok: false, reason: `${TOKEN}_scope: the run's instructed scope could not be read, so the names cannot be checked.` };
  const byName = new Map(model.marks.map((m) => [nameKey(m.name), m]));
  const missing = instructed.filter((n) => !byName.has(nameKey(n)));
  if (missing.length) return { ok: false, reason: `${TOKEN}_names: no row for ${missing.map((n) => `"${n}"`).join(", ")}. Send one row per instructed name.` };
  const known = new Set(instructed.map(nameKey));
  const stray = model.marks.filter((m) => !known.has(nameKey(m.name)));
  if (stray.length) return { ok: false, reason: `${TOKEN}_names: "${stray[0].name}" is not an instructed name. Names verbatim from the instructed scope.` };

  const counts = readJson(driverDir(runDir, "register-counts.json"));
  const countsFor = (n) => (counts?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(n)) ?? null;
  const plan = readJson(join(runDir, "knockout-plan.json"));
  const framedFor = (n) => (plan?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(n)) ?? null;
  for (const n of instructed) {
    const row = byName.get(nameKey(n));
    const blocks = knockoutBandBlocks(runDir, n);
    const held = new Set([...blocks.values()].flatMap((b) => (Array.isArray(b?.records) ? b.records : []).map((r) => String(r?.record_id ?? ""))));
    const carried = carriedIds(row);
    const stranger = [...carried].find((id) => !held.has(id));
    if (stranger) return { ok: false, reason: `${TOKEN}_carried:${n}: "${stranger}" is not a record this name's questions returned. Copy record_id from the list you read.` };
    const { entries } = knockoutProposals(runDir, n);
    const asked = new Set([...blocks.keys(), ...entries.map((e) => String(e?.qid)), ...["identical", "containing", "close"].map((k) => openingQid(n, k)),
      ...formsOfName(n, framedFor(n)).map((_, i) => formQid(n, i))]);
    const unknown = row.set_aside.find((r) => !asked.has(r.question));
    if (unknown) return { ok: false, reason: `${TOKEN}_set_aside:${n}: "${unknown.question}" is not a question on this name. Name the question by its qid.` };
    const owed = questionsOwed({ name: n, countsEntry: countsFor(n), blocks, proposals: entries, carried, framed: framedFor(n) });
    const notAsked = owed.find((o) => o.mustAsk);
    if (notAsked) return { ok: false, reason: `${TOKEN}_identical:${n}: the register counts ${notAsked.count} under this name and no question was asked on it. Ask it: read the list if you can read it in full, or narrow it. A reason does not stand in for the name's own question.` };
    const said = new Set(row.set_aside.map((r) => r.question));
    const unsaid = owed.filter((o) => !said.has(o.question));
    if (unsaid.length) {
      return { ok: false, reason: `${TOKEN}_set_aside:${n}: nothing says what became of ${unsaid.map((o) => `${o.question} (${o.count ?? "count unknown"}, ${o.kind})`).join("; ")}. `
        + "Read it, narrow it, or add a set_aside row naming that question with your reason." };
    }
  }
  return { ok: true };
}

/** Does the file on disk hold an accepted reading record for this run? koStage's skip-if-valid read. */
export function validateKnockoutRegisterFile(file, content) {
  let doc;
  try { doc = JSON.parse(content); } catch (e) { return { ok: false, reason: `not valid JSON: ${e.message}` }; }
  const shape = acceptKnockoutRegister(doc);
  if (!shape.ok) return shape;
  const dir = dirname(file);
  const runDir = basename(dir) === DRIVER_DIR ? dirname(dir) : dir;
  if (!existsSync(driverDir(runDir, "instructed-scope.json"))) return { ok: false, reason: "the run's instructed scope is not on disk, so this record cannot be checked." };
  return checkKnockoutRegisterAgainstRun(shape.model, runDir);
}

export function recordKnockoutRegisterRead(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const dir = String(runDir ?? "");
  const paths = knockoutRegisterCallPaths(dir);
  const nameFor = (seq) => join(paths.dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };
  const journal = (reason) => {
    try { writeFileSync(paths.refusals, JSON.stringify({ at: now(), reason }) + "\n", { flag: "a" }); }
    catch { /* the refusal still stands and is still returned */ }
  };
  const refused = (reason) => {
    journal(reason);
    return { written: null, refused: reason, captured: closeCapture({ ok: false, refused: reason }), capture_failed: cap.failed };
  };

  const undeclared = refuseUndeclared(received, DECLARED, TOKEN);
  if (undeclared) return refused(undeclared);

  const call = mergeKnockoutRegisterCall(lastAccepted(paths.accepted, readFileSync), received);
  const verdict = acceptKnockoutRegister(call);
  if (!verdict.ok) return refused(verdict.reason);
  const joined = checkKnockoutRegisterAgainstRun(verdict.model, dir);
  if (!joined.ok) return refused(joined.reason);

  const file = knockoutRegisterFile(dir);
  try {
    writeFileSync(file, JSON.stringify(verdict.model, null, 2) + "\n");
    writeFileSync(paths.accepted, acceptedEnvelope(call, now()));
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: cap.failed };
  }
  return { written: file, refused: null, names: verdict.model.marks.length, captured: closeCapture({ ok: true }), capture_failed: cap.failed };
}

/** The refusals journalled for this run, newest last. The accessor a TOOL_WRITTEN_ARTIFACTS row carries. */
export function knockoutRegisterRefusalsFor(runDir) {
  try {
    return readFileSync(knockoutRegisterCallPaths(String(runDir ?? "")).refusals, "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { reason: l }; } });
  } catch { return []; }
}
