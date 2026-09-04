// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Is this data plane production?
//
// An UNSET pool root is not "no pool". It was PRODUCTION: the driver read
// `process.env.CLEAROTRON_REPORTS_DIR || "/srv/trademark-archive"`, so a forgotten export resolved to the
// client archive, which is lethal for anything that means to exercise deployed code harmlessly.
//
// REMOVED THAT FALLBACK — `config.poolRoot` now refuses when the variable is unset — AND THIS GUARD
// IS UNCHANGED BY IT, deliberately. Two different jobs that happen to have named the same directory:
// the code default was a guess about where to write, and `PRODUCTION_POOL` below is a FACT about where
// the client archive is. Production still publishes to /srv/trademark-archive; it now says so in its
// EnvironmentFile instead of inheriting it. So this constant keeps naming the real archive, and a
// blanket rename of the literal across the tree would have turned the one guard that refuses production
// into a guard that refuses nothing.
//
// It has already cost. A deploy runbook prescribed a free post-deploy validation beginning
// "source /home/operator/trademark-dev/dev.env". That file did not exist on the machine, and
// `set -a; . dev.env` on a missing file is NOT an error in bash — it prints to stderr and carries on
// with nothing set. Following the documented step would have written a mock run straight into the
// production pool, and the operator would have believed they validated against a dev one. Of 17
// published production reports found during the 2026-08-08 deploy, 8 were E2E suite marks.
//
// A pure function, so the refusal can be tested and so the two callers that need it cannot drift into
// two different opinions about what "production" means.
//
// WHERE THIS MUST NOT GO: any path production's own runner executes. Production legitimately uses
// /srv/trademark-archive; a guard on the enqueue or runner path would refuse every real run on the
// next redeploy. This belongs to validation and test tooling only.

// STILL A PURE FUNCTION, AND STILL DEPENDENCY-FREE. `shared/env-aliases.mjs` is a frozen table and
// three pure functions — no node imports, no I/O — so importing it keeps every property the header
// above claims, and the refusals stop naming a variable a migrated operator never typed.

export const PRODUCTION_POOL = "/srv/trademark-archive";

/**
 * @param {object} o
 * @param {string|undefined} o.poolRoot   the reports/pool root as the environment has it, under EITHER
 *                                        spelling — resolve it with `envFrom` at the call site
 *                                        (undefined = unset)
 * @param {string|undefined} [o.queueDir] the queue directory, same
 * @param {string} [o.productionPool]     override for tests only
 * @returns {{refuse: boolean, reason: string|null}}
 */
export function productionPoolRefusal({ poolRoot, queueDir, productionPool = PRODUCTION_POOL } = {}) {
  const set = (v) => typeof v === "string" && v.trim().length > 0;

  // UNSET IS THE DANGEROUS CASE, not the safe one, and it is checked first because it is the one that
  // looks like nothing is wrong. This is the shape the 2026-08-08 deploy would have hit.
  if (!set(poolRoot)) {
    return { refuse: true, reason:
      `CLEAROTRON_REPORTS_DIR is unset, and this tool will not guess. Unset is NOT "no pool": the driver's `
      + `fallback used to be ${productionPool}, which is PRODUCTION, and this refusal is what stood `
      + `between a forgotten export and the client archive. #774 removed the fallback — the driver now `
      + `refuses too — so both ends agree. Set an isolated dev pool before running anything here.` };
  }
  if (queueDir !== undefined && !set(queueDir)) {
    return { refuse: true, reason:
      `CLEAROTRON_QUEUE_DIR is unset, so this would claim work out of the driver's default queue. Set it to `
      + "an isolated dev queue." };
  }

  // Prefix, not equality: /srv/trademark-archive/anything is still inside the production pool.
  const p = String(poolRoot).replace(/\/+$/, "");
  const prod = String(productionPool).replace(/\/+$/, "");
  if (p === prod || p.startsWith(`${prod}/`)) {
    return { refuse: true, reason:
      `CLEAROTRON_REPORTS_DIR is ${poolRoot}, which is the PRODUCTION pool. A run written here is `
      + `indistinguishable from real client matter: it lands in the archive the matter ledger and `
      + `replay-archive.mjs read as genuine. There is no override.` };
  }
  return { refuse: false, reason: null };
}
