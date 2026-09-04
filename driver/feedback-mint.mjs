// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// feedback-mint.mjs — carry each captured flag to the issue list, exactly once.
//
// `createIssue` is INJECTED, so the whole drain tests offline against a fake. The real GitHub call lives
// in scripts/feedback-mint.mjs, which is the only file in this feature that touches the network.
//
// EXACTLY ONCE is the property, and it is enforced by stamping the FLAG rather than by keeping a list of
// what has been minted. A separate ledger is a second thing that can be lost, restored from a stale
// backup, or disagree with the store; the flag file is the same file either way, so a flag that carries
// an issue number has one and a flag that does not, does not.
//
// A flag whose mint FAILS is left unstamped and retried next drain. That is the safe direction: a
// duplicate issue is a nuisance a human closes in ten seconds, and a lost flag is lawyer feedback nobody
// knows was given.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { issueForFlag } from "./feedback-issues.mjs";

/** A flag that has not yet become an issue. */
export const isPending = (flag) => !!flag && !flag.issue;

/**
 * Mint every pending flag in `dir`.
 *
 * @param {object} a
 * @param {string} a.dir                  the feedback store
 * @param {(issue: {title,body,labels}) => Promise<{number:number,url:string}>} a.createIssue
 * @param {(msg: string) => void} [a.log]
 * @param {() => string} [a.now]          injectable clock, so a test can assert the stamp
 * @returns {Promise<{minted: object[], failed: object[], skipped: number}>}
 */
export async function mintPending({ dir, createIssue, log = () => {}, now = () => new Date().toISOString() }) {
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort(); }
  catch { return { minted: [], failed: [], skipped: 0 }; }

  const minted = [], failed = [];
  let skipped = 0;

  for (const name of names) {
    const path = join(dir, name);
    let flag;
    // A half-written or hand-edited file is not a reason to stop draining the other seventy-four.
    try { flag = JSON.parse(readFileSync(path, "utf8")); }
    catch { log(`skip ${name}: not readable as JSON`); skipped++; continue; }
    if (!isPending(flag)) { skipped++; continue; }

    let res;
    try { res = await createIssue(issueForFlag(flag)); }
    catch (e) { log(`FAILED ${name}: ${String(e?.message ?? e)}`); failed.push({ flag, error: String(e?.message ?? e) }); continue; }
    if (!res || typeof res.number !== "number") {
      log(`FAILED ${name}: the creator returned no issue number`);
      failed.push({ flag, error: "no issue number" });
      continue;
    }

    // Stamp AFTER the issue exists. The other order would mark a flag done and then fail to mint it,
    // which loses the feedback silently — the one outcome worth avoiding at the cost of a duplicate.
    const stamped = { ...flag, issue: { number: res.number, url: res.url ?? null, mintedAt: now() } };
    try { writeFileSync(path, JSON.stringify(stamped, null, 2) + "\n", { mode: 0o640 }); }
    catch (e) {
      // The issue is real and the stamp is not, so the next drain will mint a duplicate. Say so loudly
      // rather than pretending: a human closing one duplicate beats a silent divergence.
      log(`WARNING ${name}: issue #${res.number} was created but the flag could not be stamped (${String(e?.message ?? e)}) — the next drain will duplicate it`);
    }
    log(`#${res.number} ← ${name}`);
    minted.push(stamped);
  }
  return { minted, failed, skipped };
}
