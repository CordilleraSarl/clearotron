// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// skeptic-search.mjs — the skeptic's SANCTIONED READ SURFACE: literal substring search over the run's
// own artifact tree. 's ratification hold, unlock path 1.
//
// ── WHAT THIS REPLACES, measured and nothing more ───────────────────────────────────────────────────
//
// O3c measured the tool-free skeptic's entire Bash use: 7 calls, 0 writes, across 11 attempts — every
// one a read, and the run-artifact half of them all one shape: `grep -n -i "tok1\|tok2\|…"` over the
// run's own register-findings.md / common-law-findings.md, answering "does token X appear in the
// artifact I am skeptical of, and on which line". That is what this module serves: OR-matched LITERAL
// substrings, case-insensitive by default, answering with 1-based line numbers. The remaining two reads
// targeted the stage's own served skill doc, which the seat's seeded `Read` grant already covers.
//
// Terms are literals and never regex — the measured patterns were alternations of fixed tokens
// (`jd\.com` is the literal "jd.com"), and a regex engine here would add ReDoS and over-match while
// replacing nothing that was measured.
//
// ── SCOPE: THE RUN'S OWN TREE, held at the RESOLVED path ────────────────────────────────────────────
//
// The run directory arrives from the caller (the server reads CLEAROTRON_BAND_RUN_DIR at call time — the
// run is not the seat's to name,). Inside it, everything except `_driver/` is searchable;
// `_driver/` is the driver's own bookkeeping (attempt records, tool logs, call captures), not a run
// artifact, and the measured reads never touched it. Absolute paths and `..` segments are refused on
// the input string; the containment and the `_driver` exclusion are then re-checked on the REALPATH,
// because a symlink inside the tree can point anywhere and an input-string check cannot see that.
//
// ── READ-ONLY BY CONSTRUCTION ───────────────────────────────────────────────────────────────────────
//
// The import list is the property: readFileSync / realpathSync / statSync and nothing else, pinned by
// skeptic-search.test.mjs. No shell, no process, no network, no write capability to misuse.
//
// Every refusal is `{ refused: "<token>: …" }`, token-first like the recording transports, so the seat
// reads the defect in this turn. Found-nothing is NOT a refusal: it is `{ matches: [], total_matches:
// 0, lines_scanned: N }` — a measured zero, from an instrument the answer itself shows can count.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep, isAbsolute } from "node:path";
import { DRIVER_DIR } from "../shared/driver-dir.mjs";   //

/**
 * Which refusal a failed path resolution earns, from the error's CODE.
 *
 * item 1 — EXPORTED AND PURE BECAUSE THE FAULT CANNOT BE INJECTED WHERE THE SUITE RUNS. Every
 * container here runs as uid 0, and root reads through mode 000, so a test that chmods a directory and
 * expects EACCES gets a successful read and asserts nothing. A test that quietly passes because the
 * fault could not be injected is the exact shape this issue is about, so the decision is separated from
 * the syscall and checked directly.
 *
 * EACCES/EPERM mean the artifact EXISTS and could not be read. Everything else — ENOENT, ENOTDIR,
 * ELOOP — means there is nothing at that path.
 */
export const isPermissionError = (code) => code === "EACCES" || code === "EPERM";

export const SEARCH_LIMITS = Object.freeze({
  maxTerms: 16,        // the widest measured alternation carried 8 tokens
  maxTermChars: 80,
  maxMatches: 50,      // the measured calls bounded themselves with `| head -5` when they expected many
  maxLineChars: 400,
  maxFileBytes: 5 * 1024 * 1024,  // the measured targets were ~100KB findings files
});

/**
 * Search ONE run artifact for OR-matched literal substrings. Returns bounded matches with 1-based line
 * numbers, or `{refused}` with a token-first reason. Never throws on bad input; never writes.
 */
export function searchRunArtifacts(runDir, params, { limits = SEARCH_LIMITS } = {}) {
  const dir = typeof runDir === "string" ? runDir : "";
  if (!dir) {
    return { refused: "search_no_run: no run directory is wired — the driver sets it per run; there is no parameter for it and this tool never guesses one" };
  }

  const file = params?.file;
  if (typeof file !== "string" || !file.trim()) {
    return { refused: "search_file_missing: `file` must name one artifact, RELATIVE to the run directory — e.g. \"register-findings.md\"" };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\0\r\n]/.test(file)) {
    return { refused: "search_file_invalid: the path carries a control character" };
  }
  if (isAbsolute(file)) {
    return { refused: `search_file_absolute:${file.slice(0, 120)} — paths are relative to the run directory; the run is not the seat's to name` };
  }
  const segments = file.split("/").filter(Boolean);
  if (segments.includes("..")) {
    return { refused: `search_file_traversal:${file.slice(0, 120)} — \`..\` leaves the run's own artifact tree, which this surface does not reach` };
  }
  if (segments[0] === DRIVER_DIR) {
    return { refused: `search_file_driver_internal:${file.slice(0, 120)} — _driver/ is the driver's own bookkeeping, not a run artifact` };
  }

  const terms = params?.terms;
  if (!Array.isArray(terms)) {
    return { refused: "search_terms_missing: `terms` must be an array of literal substrings — they are OR-matched per line, like grep alternation" };
  }
  if (terms.length === 0) {
    return { refused: "search_terms_empty: an empty term list matches nothing — name what you are looking for" };
  }
  if (terms.length > limits.maxTerms) {
    return { refused: `search_terms_too_many:${terms.length} — at most ${limits.maxTerms} terms per call; split the question` };
  }
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (typeof t !== "string" || !t.length) {
      return { refused: `search_term_empty:${i} — every term is a non-empty literal substring` };
    }
    if (/[\r\n]/.test(t)) {
      return { refused: `search_term_multiline:${i} — a term is matched within single lines and cannot span them` };
    }
    if (t.length > limits.maxTermChars) {
      return { refused: `search_term_too_long:${i} — at most ${limits.maxTermChars} characters per term` };
    }
  }

  // Containment at the RESOLVED path. realpath both ends: a symlink inside the tree can point out of
  // it (refused as an escape) or back into _driver/ (refused as driver-internal) — the input-string
  // checks above cannot see either.
  let realRun;
  try { realRun = realpathSync(dir); } catch {
    return { refused: `search_no_run: the wired run directory does not resolve — infrastructure, not a judgment defect` };
  }
  const abs = resolve(realRun, file);
  let real;
  try { real = realpathSync(abs); } catch (e) {
    // ── item 1 — A PRIVILEGE FAILURE IS NOT AN ABSENCE ────────────────────────────────────────
    //
    // Every `realpathSync` failure used to answer `search_file_not_found`, whose own text tells the seat
    // "An absence is a finding: say so in your flags if you expected it". So a file the seat could not
    // READ was reported as a file that does not EXIST, and the tool then instructed the seat to write
    // that non-existence into its findings.
    //
    // That is a privilege fault MANUFACTURING a finding, in the direction of confidence, out of a
    // question nobody answered. It is the same class as every other absence-reading-as-a-pass in this
    // repo, with the failure arriving through the refusal vocabulary instead of through a grep.
    //
    // EACCES and EPERM are the two the kernel raises here, and they are split off by CODE rather than by
    // message text. Anything else — ENOENT, ENOTDIR, ELOOP — genuinely means there is nothing at that
    // path, and keeps the absence wording it has always had.
    if (isPermissionError(e?.code)) {
      return { refused: `search_file_unreadable:${file.slice(0, 120)} — this artifact exists and could not be read (${e.code}). DO NOT treat this as an absence: nothing about the run has been established, and a finding written from it would be asserting something no one checked. Report the read failure itself.` };
    }
    return { refused: `search_file_not_found:${file.slice(0, 120)} — no such artifact in this run. An absence is a finding: say so in your flags if you expected it` };
  }
  if (real !== realRun && !real.startsWith(realRun + sep)) {
    return { refused: `search_file_escapes_run:${file.slice(0, 120)} — resolves outside the run's own artifact tree, which this surface does not reach` };
  }
  const realRel = real === realRun ? "" : real.slice(realRun.length + 1);
  // item 2 — ANY segment, not just the first. `_driver/` is the driver's own bookkeeping wherever
  // it sits, and the check read `[0]` only, so a nested one was reachable. None exists in the tree today,
  // which is exactly why it would not announce itself if one ever did — the single-member-population
  // shape this repo keeps paying for. The test plants one rather than trusting that none appears.
  if (realRel.split(sep).includes(DRIVER_DIR)) {
    return { refused: `search_file_driver_internal:${file.slice(0, 120)} — resolves into _driver/, the driver's own bookkeeping` };
  }

  let st;
  try { st = statSync(real); } catch {
    return { refused: `search_file_not_found:${file.slice(0, 120)} — vanished between resolve and read` };
  }
  if (!st.isFile()) {
    return { refused: `search_file_not_a_file:${file.slice(0, 120)} — this surface searches one artifact at a time and serves no listing` };
  }
  if (st.size > limits.maxFileBytes) {
    return { refused: `search_file_too_large:${st.size} — over the ${limits.maxFileBytes}-byte cap; no run artifact this stage reads is that size` };
  }

  const caseSensitive = params?.case_sensitive === true;
  const needles = caseSensitive ? terms : terms.map((t) => t.toLowerCase());
  const lines = readFileSync(real, "utf8").split("\n");
  const matches = [];
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
    if (!needles.some((n) => hay.includes(n))) continue;
    total++;
    if (matches.length < limits.maxMatches) {
      matches.push({ line: i + 1, text: lines[i].slice(0, limits.maxLineChars) });
    }
  }
  return {
    file,
    matches,
    total_matches: total,
    lines_scanned: lines.length,
    truncated: total > matches.length,
  };
}
