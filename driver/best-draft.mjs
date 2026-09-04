// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// best-draft.mjs —: carry the best REJECTED draft of a stage across a recovery park.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// A content rejection is not a lost turn. The document on disk is that attempt's work, and already
// scores it: `quantity` is how many of the thing are still wrong. What was missing is anything that keeps
// the score.
//
// Measured on the 2026-08-05 R2 run, both common-law halves independently: the halves converged 27→4→1
// and 21→3→2 INSIDE one dispatch, the recovery park re-commissioned the stage from `def.message(ctx)`,
// and the next cycle restarted at 21 and 13. Three cycles of converge-then-reset is exactly what the
// defect budget allows before terminal. The run did not fail because the work was impossible. It failed
// because the work was discarded.
//
// ── what it refuses, and why each refusal is the point ───────────────────────────────────────────────
//
// ABSENT IS NOT ZERO — the rule this module would break most silently. A failure with no quantity must
// never become "the best draft": 0 reads as "nothing left wrong", which is what a PASS looks like. So a
// non-finite score never wins, and `beatsBest` is pure and unit-tested for exactly that.
//
// A KILL-TORN DRAFT IS NEVER PRESERVED. That guard lives at the call site in gateway.mjs, where
// `killClass`/`killSeen` are in scope, and it is not optional: `wrote` is a MUTATION, not a proof of a
// complete rewrite, and a stage validator is a SHAPE check. This is the artifact half of the same rule
// the exit-1 rescue makes — a kill-torn file is not a trustworthy base to patch. Without it this
// mechanism hands a torn document to the next cycle and calls it the floor.
//
// The store lives under `_driver/` — it survives a park and a `--resume`, and it is deliberately NOT an
// artifact version (`_history/` is where superseded outputs go for compare.mjs). Keyed by STAGE LABEL, so
// `common-law-half:a` and `common-law-half:b` never collide.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

const safe = (label) => String(label).replace(/[^\w.:-]/g, "_");

export function bestDraftDir(runDir, label) { return driverDir(runDir, "best-draft", safe(label)); }

/**
 * PURE. Does a draft scoring `quantity` beat the recorded best?
 * A non-finite score NEVER wins — see ABSENT IS NOT ZERO above. A tie never wins either: the incumbent
 * draft is the one already proven to have been written by a non-kill attempt, so an equal newcomer buys
 * nothing and only risks replacing it with something later and no better.
 */
export function beatsBest(quantity, prior) {
  if (!Number.isFinite(quantity)) return false;
  if (!prior || !Number.isFinite(prior.quantity)) return true;
  return quantity < prior.quantity;
}

/** {file, quantity, fail, attempt, key, ts, path} | null. Absent or unreadable ⇒ null; never throws. */
export function readBestDraft(runDir, label) {
  try {
    const d = bestDraftDir(runDir, label);
    const rec = JSON.parse(readFileSync(join(d, "score.json"), "utf8"));
    const p = join(d, rec.file);
    return existsSync(p) ? { ...rec, path: p } : null;
  } catch { return null; }
}

/**
 * Best-effort. Returns true when this draft became the new best.
 * NEVER throws — a preservation failure must not fail a turn that was otherwise going to be recorded
 * honestly. The copy lands through a .tmp + rename so a reader can never see it torn.
 */
export function recordBestDraft(runDir, label, outPath, { quantity, fail, attempt, key }) {
  try {
    if (!existsSync(outPath)) return false;
    const prior = readBestDraft(runDir, label);
    if (!beatsBest(quantity, prior)) return false;
    const d = bestDraftDir(runDir, label);
    mkdirSync(d, { recursive: true });
    const file = basename(outPath);
    copyFileSync(outPath, join(d, `${file}.tmp`));
    renameSync(join(d, `${file}.tmp`), join(d, file));
    writeFileSync(join(d, "score.json"), `${JSON.stringify({
      file, quantity, fail: String(fail ?? "").slice(0, 300), attempt, key, ts: new Date().toISOString(),
    }, null, 2)}\n`);
    return true;
  } catch { return false; }
}
