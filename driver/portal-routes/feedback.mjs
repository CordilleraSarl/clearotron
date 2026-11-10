// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/feedback.mjs — /portal/api/feedback, a reader's flag on one finding of a delivered report.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { join } from "node:path";
import { engineCommit } from "../engine-build.mjs";
import { appendFlag, feedbackDir, MAX_WHY, VERDICTS } from "../feedback-store.mjs";
import { assertPrincipal, mayReadRun } from "../portal-access.mjs";
import { readJson } from "../run-record.mjs";

export async function feedbackRoutes({ poolRoot, audit, feedbackCapture }, { method, parts, principal, body }) {
  // POST /portal/api/feedback — a lawyer flags one finding on a delivered report.
  //
  // This is the SECOND POST under /portal/api that spends nothing (compose/read is the other). It
  // mints no confirmation token, queues nothing and changes no report: flagging is an observation
  // ABOUT a delivered artifact, never an instruction to the engine.
  //
  // THE RULE THAT MAKES A FLAG EVIDENCE: every identifying field is read SERVER-SIDE from the run's
  // own artifacts. The request supplies exactly three things — which run, which ordinal, and the
  // reader's own words. Mark, band, disposition, matter, account, engine build and the excerpt all
  // come from meta.json and report-data.json on disk. A client who could name the mark on a flag
  // could label another customer's finding with it, which is how the predecessor system's Triage
  // grouping was attacked (spec 61 critic finding 1) — and beyond the attack, a locator the reader
  // typed is a locator that cannot be trusted to still point anywhere.
  if (parts[1] === "api" && parts[2] === "feedback" && method === "POST") {
    assertPrincipal(principal, { door: true });
    // — RETIRED, 2026-08-20. It REFUSES; it does not disappear.
    //
    // AFTER assertPrincipal ON PURPOSE. A 410 says "this existed and is gone", which is exactly what
    // a reader on a report published before today needs to be told and exactly what an unauthenticated
    // prober should not learn. The door check runs first, so only a principal who could have used the
    // control sees the answer.
    //
    // 410 RATHER THAN 404, which is what every other refusal in this handler returns. The difference
    // is the audit log: `isAdminWrite` still names this path, so a POST here still files an outcome
    // row, and a retired-endpoint row is a different fact from a not-yours row. If an old open tab is
    // still clicking Flag, that is a thing worth being able to count.
    //
    // WHAT IS DELIBERATELY STILL BELOW THIS LINE: the whole resolver — the two-lane shape, the
    // disposition read, the server-side-locator rule. The owner ruled "disable services and any code",
    // and the acceptance criterion says re-enabling must be a switch and not a rebuild. Deleting 130
    // lines of hard-won doctrine would have made it a rebuild.
    if (!feedbackCapture) return { status: 410, json: { code: "retired", error: "Flagging a finding is switched off." } };
    const runId = typeof body?.runId === "string" ? body.runId : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes(".."))
      return { status: 404, json: { error: "not_found" } };
    const dir = join(poolRoot, runId);
    let meta; try { meta = readJson(join(dir, "meta.json")); } catch { return { status: 404, json: { error: "not_found" } }; }
    // Ownership, exactly as GET /portal/report/<id> checks it — foreign is 404, never 403, and
    // a Generic run is its organisation's. A reader who cannot READ the report cannot flag it either.
    const owner = meta.customerKey || "generic";
    if (!mayReadRun(principal, { owner, organisation: meta.organisation ?? null })) return { status: 404, json: { error: "not_found" } };

    const verdict = typeof body?.verdict === "string" ? body.verdict : "";
    if (!VERDICTS.has(verdict))
      return { status: 400, json: { code: "bad_verdict", error: "A flag is good or bad." } };
    const why = typeof body?.why === "string" ? body.why.trim() : "";
    if (!why) return { status: 400, json: { code: "why_required", error: "Say what is right or wrong about it — a flag with no reason cannot be acted on." } };
    if (why.length > MAX_WHY) return { status: 400, json: { code: "why_too_long", error: `That is longer than a note — keep it under ${MAX_WHY} characters.` } };

    // The ordinal names a POSITION; the finding's own facts are read back from the run so the flag
    // survives the contiguous renumber every republish performs.
    //
    // — THE TWO LANES SHAPE report-data.json DIFFERENTLY, and the resolver used to know one.
    //
    // Clearance writes a top-level `findings[]` numbered once across the document. Knockout writes
    // `marks.findings`, and restarts the ordinals at 1 FOR EACH MARK, so every mark in a
    // batch has a finding 1. Reading `data.findings` on a knockout run therefore found nothing, and
    // a flag on the knockout lane resolved to no facts at all — silently, because a flag with an
    // unresolved ordinal is a legitimate state (a run published before report-data.json existed).
    //
    // Branching on the SHAPE ON DISK rather than on what the request sent is the load-bearing part.
    // If a knockout flag arrives with no markIndex, this resolves NOTHING rather than falling back
    // to an ordinal lookup that would silently attach a lawyer's correction to the FIRST mark's
    // finding of that number. The issue is explicit that the wrong mark is worse than no mark.
    const ordinal = Number.isInteger(body?.ordinal) && body.ordinal > 0 ? body.ordinal : null;
    const markIndex = Number.isInteger(body?.markIndex) && body.markIndex >= 0 ? body.markIndex : null;
    let found = null, searchedMark = null, foundLane = null, engineCommitOf = meta.engineCommit ?? null;
    try {
      const data = readJson(join(dir, "report-data.json"));
      engineCommitOf = data.engineCommit ?? engineCommitOf;
      if (ordinal != null) {
        if (Array.isArray(data.findings)) {
          found = data.findings.find((f) => f.ordinal === ordinal) ?? null;
          if (found) foundLane = "clearance";
        } else if (Array.isArray(data.marks) && markIndex != null) {
          const m = data.marks[markIndex] ?? null;
          found = (m?.findings ?? []).find((f) => f.ordinal === ordinal) ?? null;
          if (found) { foundLane = "knockout"; searchedMark = m?.name ?? null; }
        }
      }
    } catch { /* a run published before report-data.json: the ordinal still locates, the facts do not */ }

    // — THE DISPOSITION COMES FROM findings.json, NOT FROM report-data.json.
    //
    // report-data.json is the CLIENT CUT by construction, and `disposition` is a placement key in the
    // engine's own spelling — it stopped being served there in the same commit as this read. That
    // deletion on its own would have started writing `null` into the locator of every flag captured
    // from that moment on, and a flag is already-minted evidence a revert cannot repair. So the source
    // moves rather than disappearing: publish copies the run's findings.json into the pool run dir
    // (publish/index.mjs copyRO, both the strict and the lenient parse), which satisfies the rule this
    // handler states above — every identifying field read SERVER-SIDE from the run's own artifacts.
    //
    // JOINED ON ORDINAL **AND** MARK, and it resolves NOTHING on a mismatch. report-data projects the
    // same parsed findings array publish read from that same findings.json, so the ordinals are one
    // set — but a wrong disposition on a lawyer's flag is worse than no disposition (the ruling on
    // the batch lane, applied here), so the mark is checked rather than assumed.
    //
    // CLEARANCE ONLY, on purpose. publish/knockout.mjs emits no disposition, so `found?.disposition`
    // was already null on that lane and this must not invent one from a differently-shaped file.
    //
    // ABSENT IS NULL, NEVER AN ERROR. A run with no findings.json (no register, or a top-level parse
    // failure that published a structured-light report) resolves to null — the same honest "the
    // ordinal locates, this fact does not" state a pre-report-data run records — and the flag still
    // saves. The audit line below records whether it resolved, so the absence is visible rather than
    // silent.
    let disposition = null;
    if (foundLane === "clearance") {
      try {
        const fj = readJson(join(dir, "findings.json"));
        const rec = (Array.isArray(fj?.findings) ? fj.findings : []).find((f) => f?.ordinal === ordinal) ?? null;
        if (rec && String(rec.mark ?? "") === String(found.mark ?? "")) disposition = rec.disposition ?? null;
      } catch { /* no findings.json in the run dir: the finding still locates, its posture does not */ }
    }

    let rec;
    try {
      rec = appendFlag(feedbackDir(poolRoot), {
        runId, verdict, why,
        capturedBy: principal.email ?? null,
        locator: {
          ordinal,
          // — the drill-through key the report page and the workbook both print
          // (`<MARK> #<ordinal>`,), read off the resolved finding rather than composed here or
          // taken from the request. It is what a human reading the flag store or a minted issue
          // needs in order to find the row again, and on a batch it is the only thing that says
          // WHICH mark. Null on the clearance lane, which has no such key.
          ref: found?.ref ?? null,
          // The searched mark on the knockout lane, where `mark` below is the CONFLICTING name.
          searchedMark,
          // Clearance calls the conflicting name `mark`; the knockout view calls it `name`.
          mark: found?.mark ?? found?.name ?? null,
          band: found?.band ?? null,
          // — read above, from findings.json. NOT `found.disposition`: report-data.json no
          // longer serves the placement key, and a `?? null` fallback onto it would read as working.
          disposition,
          section: typeof body?.section === "string" ? body.section.slice(0, 120) : null,
        },
        // The sentence the reader was looking at, from the RUN rather than the request — the same
        // reason as the locator, and it keeps from putting attacker-authored prose in an issue.
        excerpt: found ? (found.net ?? found.impact ?? null) : null,
        run: {
          account: owner, matter: meta.matter ?? null, markName: meta.markName ?? null,
          product: meta.searchLevel ?? null, issuedAt: meta.issuedAt ?? null,
          engineCommit: engineCommitOf, runDir: dir,
        },
      });
    } catch (e) {
      audit({ event: "report-feedback", by: principal.email, runId, ok: false, error: String(e?.message ?? e) });
      return { status: 500, json: { code: "not_saved", error: "The flag was not saved. Nothing was lost from the report — try again." } };
    }
    // Length and location, never the words. A why is the lawyer's own reading of a client matter,
    // and an audit log is a different disclosure surface from the flag store.
    //
    // — `dispositionResolved` rides here because the disposition now comes from a SECOND file:
    // a clearance flag that located its finding but read no posture means findings.json was absent or
    // did not agree, and a null that nobody can see is how the paired edit would have failed silently.
    // Only on the lane that can carry one, so a knockout flag's honest null is not logged as a miss.
    audit({
      event: "report-feedback", by: principal.email, runId, account: owner, verdict, ordinal, markIndex,
      resolved: Boolean(found), ...(foundLane === "clearance" ? { dispositionResolved: Boolean(disposition) } : {}),
      chars: why.length, id: rec.id, ok: true, status: 201,
    });
    return { status: 201, json: { id: rec.id } };
  }
  return undefined;
}
