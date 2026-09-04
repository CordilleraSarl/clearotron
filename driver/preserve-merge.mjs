// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// preserve-merge.mjs — THE SHARED HALF OF "A REPAIR KEEPS WHAT IT DID NOT RE-SEND".
//
// ── THE DEFECT CLASS, MEASURED ACROSS THE POPULATION ────────────────────────────────────────────────
//
// A typed transport that writes its artifact WHOLESALE, and whose schema makes a content field
// OPTIONAL, accepts a call carrying only part of the document and silently deletes the rest. Five of
// the fifteen return-path transports were measured with that hole:
//
//   record_report_overview   actions, methodology, handling_note   (a section of the client's report)
//   record_prelim_variants   incumbent_classes, watchlist_owners, search_floor
//   record_blind_frame       sources
//   record_matter_frame      scope_jurisdictions, excluded_jurisdictions
//   record_unit_note         null_result, note
//
// ── PRESERVE, NOT REFUSE — a product decision, not a style one ──────────────────────────────────────
//
// Requiring the fields instead would turn a legitimate omission into a REFUSAL on stages that produce
// what the client reads. None of these transports can tell a first call from a repair, so a partial is
// indistinguishable from a first call — and a product refusal is never a pass, however correct the
// reason. Preserving is the answer that cannot fail closed.
//
// ── WHY THIS IS ONE MODULE AND NOT FIVE COPIES ──────────────────────────────────────────────────────
//
// The first fix (report-overview) was landed alone as the pattern, deliberately: five acceptor rewrites
// in one diff is not one reviewable story, and being wrong once beats being wrong five ways. The
// pattern held, so the shared half moves here and the five transports keep only what is genuinely
// theirs — WHICH keys they declare, and WHAT the rule is per key. Those two things differ per
// transport and must stay visible at each site; everything else is identical and now has one home.

/**
 * Refuse a key the schema does not declare, BY ITS PATH — at DEPTH, not only at the top.
 *
 * ── WHY DEPTH IS THE WHOLE POINT ───────────────────────────────────────────────
 *
 * Measured on a delivered run: the synthesis seat was ordered to add a top-level `corrections` marker
 * and sent it as `narrative.corrections` instead. `corrections` is a real field in its proper place, so
 * nothing looked malformed; `narrative` is a TYPED object that does not declare it; and because
 * `serve()` validates nothing against `inputSchema`, the call was accepted and the note reached no
 * delivered artifact. A top-level-only unknown-key check passes on exactly that call.
 *
 * So the refusal names the PATH. A seat that put a legitimate value in the wrong object learns where it
 * belongs, in the turn it happens, instead of being told the call was well-formed.
 *
 * Run this BEFORE the merge: a misplaced key must never reach the stored base, or the next repair
 * inherits it.
 *
 * @param {object} params    the received call
 * @param {object} declared  path → allowed keys. "" is the top level; a nested key's own path is its
 *                           entry. A path with NO entry is not policed — an untyped object accepts
 *                           anything by declaration, and pretending otherwise would refuse legitimate
 *                           values.
 * @param {string} token     the transport's refusal prefix, e.g. "reportoverview"
 * @returns {string|null}    the refusal reason, or null
 */
export function refuseUndeclared(params, declared, token, path = "") {
  if (!params || typeof params !== "object") return null;
  const allowed = declared[path];
  if (!allowed) return null;
  for (const [k, v] of Object.entries(params)) {
    // ── REFUSED INSIDE A DECLARED SUB-OBJECT, TOLERATED AT THE TOP LEVEL ──────────────────────────
    //
    // The measured defect is a legitimate key placed in a TYPED SUB-OBJECT that
    // does not declare it: `narrative.corrections`, accepted and dropped. That is what this refuses.
    //
    // Refusing unknown TOP-LEVEL keys as well was the first cut, and it was wrong. Real traffic carries
    // envelope fields the tool schema does not declare — the prelim-variants mock sends
    // `schema_version`, which `acceptPrelimVariants` ignores because it writes its OWN
    // `schema_version: SCHEMA_VERSION` into the model. Inert for as long as it has existed, and the
    // strict version made it FATAL: the whole stage refused, the run dead, for a key nobody reads.
    //
    // A product refusal is never a pass, however correct the reason. The narrow rule catches the defect
    // that was measured and cannot kill a stage over a field that changes nothing. CI caught this; the
    // arms did not, because they only checked that every DECLARED field is accepted — never that an
    // undeclared one at the top is survivable.
    if (path !== "" && !allowed.includes(k)) {
      const at = path ? `${path}.${k}` : k;
      return `${token}_undeclared_field:${at} — this tool declares no \`${at}\`. If the value belongs `
        + `somewhere, it is not here: a real field in the wrong object is accepted by every check that only `
        + `looks at the top level, and is then silently dropped.`;
    }
    const childPath = path ? `${path}.${k}` : k;
    const child = declared[childPath] ? childPath : (declared[k] ? k : null);
    if (!child) continue;
    for (const row of (Array.isArray(v) ? v : [v])) {
      const bad = refuseUndeclared(row, declared, token, child);
      if (bad) return bad;
    }
  }
  return null;
}

/**
 * KEEP-IF-ABSENT, and the absent/empty distinction is the whole care in it.
 *
 * `undefined` is "I did not speak about this" — the stored value stands.
 * `[]` and `""` are "I say there is none" — a deliberate statement, honoured as one.
 *
 * Collapsing the two turns a preserve-merge into a replace-merge for any seat that sends an empty
 * value, and a replace-merge into a preserve-merge for any seat that means to clear a field. Both are
 * silent.
 */
export const keepIfAbsent = (now, was) => (now === undefined ? was : now);

/**
 * The last ACCEPTED call for a run, or null. Written only after a call's values pass — a refused call
 * must never become the base a later repair builds on, or one bad turn poisons every turn after it.
 */
export function lastAccepted(acceptedPath, readFileSync) {
  // ✕ THE READER IS INJECTED, AND ITS ABSENCE IS A WIRING BUG — NOT AN ABSENT FILE.
  //
  // `null` from this function means "nothing has been accepted yet", which is the legitimate answer on a
  // first call and the base every merge starts from. A caller that forgot the second argument used to get
  // that SAME answer, because `undefined(...)` threw a TypeError straight into the catch below. The
  // transport then merged every repair onto an empty base and refused it for a field the seat had already
  // sent — silently, and only on the second call, which no happy-path arm reaches.
  //
  // knockout-frame shipped exactly that ( item C): six of seven transports passed the
  // reader and one did not, so every repair turn on that stage was refused by name. Absence of a FILE is
  // still null; absence of the READER now says so.
  if (typeof readFileSync !== "function") {
    throw new TypeError(
      "lastAccepted(acceptedPath, readFileSync): the reader is a required injected argument and was "
      + `${readFileSync === undefined ? "not passed" : typeof readFileSync}. Without it every call reads as `
      + "\"nothing stored yet\" and every merge silently loses what the previous call supplied.");
  }
  try { return JSON.parse(readFileSync(acceptedPath, "utf8"))?.params ?? null; }
  catch { return null; }
}

/** The stored-base envelope, so every transport writes the same shape. */
export const acceptedEnvelope = (params, at) => JSON.stringify({
  _provenance: "the last ACCEPTED call, merged if it arrived carrying only part of the document — the base a later repair keeps",
  acceptedAt: at, params,
}, null, 2) + "\n";
