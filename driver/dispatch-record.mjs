// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// dispatch-record.mjs —: what a stage was TOLD, kept beside what it sent back.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// A run recorded everything about a dispatch except the one thing that decides most arguments: the
// message. `reads` says which FILES the turn opened, which is a different question — the deferred-slice
// hint, the rulings tail and the owner-cross screen all ride the message BODY and are not files, so a
// run could not answer "was the model given this?" about any of them. turned on exactly that: the
// reasons were on disk before the digest started, and nothing recorded whether they reached the prompt.
//
// The message goes down VERBATIM, one file per dispatch, and the row that describes the attempt names
// it. `cat` is the whole reading tool.
//
// ── why the full text and not a hash ─────────────────────────────────────────────────────────────────
//
// The hash-plus-input-list design already exists — `journalStageInputs` fingerprints every DECLARED
// input — and it already failed on for the reason above: a hint composed into the message body is
// not an input file, so it fingerprints nothing. A hash answers "did this change between attempts". It
// cannot answer "did it contain the qid", and that is the question that gets asked. The sha stays, as
// an index on the row, never as the record.
//
// ── written BEFORE the dispatch, deliberately ────────────────────────────────────────────────────────
//
// A turn that is walled, stalled or SIGKILLed is exactly the turn whose prompt someone will want, and a
// record written afterwards is the record that is missing then.
//
// ── these files carry client identity, verbatim ──────────────────────────────────────────────────────
//
// The message contains the matter frame: the mark, the owner, the goods. That is fine — a run directory
// is a client-matter store and already holds the findings. It is NOT fine anywhere else. These files are
// deliberately absent from the artifact table (`artifactPath` / `listArtifacts` resolve only the named
// P artifacts plus status.json and run.jsonl), and a future "let the portal browse the run dir" change
// must not pick them up by accident. If you are here because you are writing that change: this comment
// is the reason to stop.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

export const DISPATCH_SUFFIX = "dispatch.txt";

/** `_driver/<label>.attempt<N>.dispatch.txt`, or `…attempt<N>.repair<M>.dispatch.txt`. */
export function dispatchFileName(stage, attempt, repair = 0) {
  return `${stage}.attempt${attempt}${repair ? `.repair${repair}` : ""}.${DISPATCH_SUFFIX}`;
}

const shaOf = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

// ── — WHAT THE STAGE WAS GRANTED, BESIDE THE SHA THAT PROVES WHAT IT WAS ASKED ────────────────
//
// The dispatch row recorded the envelope — file, sha, bytes, chars, kind, present — and not one word
// about what the stage could CALL. So on a preserved run, "the seat was offered the tool and declined
// it" and "the tool was never offered" are the same bytes: no call directory, and nothing to say which
// silence it is. That distinction is the difference between a seat that made a judgment and a driver
// that never gave it the option, and it is unrecoverable after the fact.
//
// THE TRAP THIS AVOIDS, which the issue names and which nearly cost me a second walk of it:
// `dispatch.txt` is the PROMPT. A tool grant rides in the spawn arguments, so grepping the dispatch
// bytes for `--allowedTools` returns nothing ON A RUN WHERE THE TOOL WAS GRANTED. An absence measured
// on a surface that cannot carry the signal reads exactly like an answer.
//
// IT GOES IN THIS OBJECT, not a sibling file, for the same reason. The next auditor looks where the
// dispatch metadata is; a grant recorded elsewhere reads as "not recorded" rather than "recorded over
// there", and that reader is precisely who this issue was filed for.
//
// `[]` IS A RECORD AND ABSENCE IS NOT. A tool-free judgment stage writes an explicit empty array — it
// was offered nothing, deliberately, and omission cannot carry that. A row with NO `grant` key at all
// is a row written before this existed, which `dispatchGrantState` reports as `unrecorded` rather than
// folding into "never offered". Reading an old artifact as a stronger claim than it makes is the same
// class of error one level up.
const grantList = (grant) => {
  if (Array.isArray(grant)) return grant.map((t) => String(t ?? "").trim()).filter(Boolean);
  const s = String(grant ?? "").trim();
  return s ? s.split(/\s+/) : [];
};

/**
 * What a preserved run can say about one stage's tools, from its dispatch row and its call evidence.
 *
 * @param {object|null} dispatch  the row's `dispatch` object, as written above
 * @param {boolean} ranTools      did this stage actually call anything (a call directory, a tool log)
 * @returns {"used"|"declined"|"never-offered"|"unrecorded"}
 *
 *   used          — it called something. The grant is moot; the evidence is positive.
 *   declined      — it was granted tools and called none. A JUDGMENT the seat made.
 *   never-offered — it was granted none. Not the seat's judgment at all; the driver's.
 *   unrecorded    — the row predates the grant field. NOT the same as never-offered, and reporting it
 *                   as such would manufacture a fact about a run nobody measured.
 *
 * PURE.
 */
export function dispatchGrantState(dispatch, ranTools) {
  if (ranTools) return "used";
  const grant = dispatch?.grant;
  if (!Array.isArray(grant)) return "unrecorded";
  return grant.length ? "declined" : "never-offered";
}

/**
 * Write the message this dispatch is about to send, VERBATIM, and return the pointer for the row.
 *
 * NEVER THROWS — the same doctrine as the methodology witness: a record that cannot be kept must not
 * fail a turn. NEVER TRUNCATES — a message too large to keep would be a refusal that says so, not a
 * quiet slice, because a sliced prompt answers the question wrongly rather than not at all.
 *
 * Three-valued, like `outputMeta`: `null` when there is no run directory, `{present:false, error}` when
 * the write failed, `{present:true, …}` when it landed. An absence is a record, never a silence.
 *
 * A COLLISION PRESERVES THE LOSER. `<label>.attempt1` repeats when a recovery park re-enters a stage and
 * dispatches its attempt 1 again. Overwriting would leave the EARLIER attempt row's `sha` pointing at a
 * file whose bytes no longer match it — a record that lies, which is worse than one that is missing. So
 * a differing predecessor is moved aside to `<name>.prev-<sha>` and named in the return.
 */
export function recordDispatch(runDir, stage, { attempt, repair = 0, kind = "fresh", message, grant } = {}) {
  if (!runDir) return null;
  const name = dispatchFileName(stage, attempt, repair);
  try {
    const text = String(message ?? "");
    const buf = Buffer.from(text, "utf8");
    const sha = shaOf(buf);
    const dir = driverDir(runDir);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    let superseded = null;
    if (existsSync(p)) {
      try {
        const prev = readFileSync(p);
        const prevSha = shaOf(prev);
        if (prevSha !== sha) { renameSync(p, `${p}.prev-${prevSha}`); superseded = prevSha; }
      } catch { /* unreadable predecessor: the write below still lands, and says nothing it cannot back */ }
    }
    writeFileSync(`${p}.tmp`, buf);
    renameSync(`${p}.tmp`, p);   // atomic: a torn record must never read as the whole message
    return {
      file: `_driver/${name}`, sha, bytes: buf.length, chars: text.length, kind, present: true,
      // — ALWAYS present, `` when the stage was offered nothing. See grantList above.
      grant: grantList(grant),
      ...(superseded ? { superseded } : {}),
    };
  } catch (e) {
    return { file: `_driver/${name}`, sha: null, bytes: null, chars: null, kind, present: false,
      // The write failed; the GRANT is still known and still true of this dispatch. Dropping it here
      // would make a disk fault look like a stage that was offered nothing.
      grant: grantList(grant),
      error: String(e?.message ?? e).slice(0, 120) };
  }
}
