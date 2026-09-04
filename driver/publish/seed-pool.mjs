// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// seed-pool.mjs —: an installed product comes up with something in it.
//
// `npm start` on a fresh machine produced a portal with an empty archive. Everything worked and there
// was nothing to look at, which is the worst first impression a clearance engine can make: the one
// thing a visitor wants is to see what a report looks like, and the only way to get one was to run a
// real clearance with real credentials.
//
// `npm run example` already replays a frozen example through the ordinary publisher. This does the same
// thing for the real install, once, at first start — same publisher, same artifacts, no credentials,
// no model, no engine.
//
// ── EMPTINESS IS THE GUARD, AND IT IS THE ONLY ONE THAT STAYS TRUE ───────────────────────────────────
//
// The obvious guard is a list of paths that must never be seeded — /srv/trademark-archive and whatever
// else. `bin/example.mjs` carries exactly that list, correctly, because a demo picks its own pool and can
// be pointed anywhere. This cannot use the same shape, for two reasons:
//
//   1. A blacklist has to know every archive that exists. On a customer's machine THEIR pool is the
//      real archive, it is not on any list we can write, and a guard that passes there is worthless.
//   2. `driver/production-pool-guard.mjs` says in its own header where it must not go: "any path
//      production's own runner executes". This runs inside the product's start command.
//
// So the guard is a property of the TARGET rather than of its name: **seed only a pool that holds no
// runs at all.** An archive with client matter in it is never empty, on any machine, under any name,
// and no rename or redeploy can make that false. A pool that already holds one run is left alone —
// including a pool this seeded yesterday, so restarting the product does not re-publish anything.
//
// ── WHAT IT REFUSES TO DO SILENTLY ───────────────────────────────────────────────────────────────────
//
// An absence is a finding. Zero frozen examples found, a example directory with no manifest, a publish
// that throws — each comes back named in the result so the caller can SAY it. None of them returns a
// shape that reads like "seeded nothing, all good", because "the archive is empty" and "the archive is
// empty and nobody noticed why" look identical from the browser.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A pool "run" is a directory holding meta.json. Mirrors pool-admin.mjs's listRuns and regenIndex's
 *  scan filter — `customer` is the per-customer page tree, not a run. */
export function poolRunIds(pool) {
  let entries;
  try { entries = readdirSync(pool, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isDirectory() && d.name !== "customer" && existsSync(join(pool, d.name, "meta.json")))
    .map((d) => d.name)
    .sort();
}

/**
 * Every frozen example under `examplesDir`, in a stable order.
 *
 * A frozen example is what `scripts/freeze-example-run.mjs` writes: a directory holding `meta.json` with
 * a `runId`, beside a `run/` directory of the finished run's artifacts. A directory that looks like a
 * sample but has no usable manifest is returned as a PROBLEM rather than skipped — `examples/` is a
 * short, hand-curated list, so something in it that cannot be read is a mistake somebody wants to hear
 * about, not a file to step over.
 *
 * @param {string} examplesDir
 * @returns {{samples: Array<{dir: string, name: string, meta: object}>, problems: string[]}}
 */
export function frozenSamples(examplesDir) {
  const samples = [];
  const problems = [];
  let entries;
  try { entries = readdirSync(examplesDir, { withFileTypes: true }); }
  catch (e) { return { samples, problems: [`${examplesDir} could not be read (${String(e?.message ?? e)})`] }; }

  for (const d of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(examplesDir, d.name);
    const manifest = join(dir, "meta.json");
    // Not every directory under examples/ is a sample and never has been — grants.example.json and
    // job.euipo.json sit beside it. A directory with no manifest AND no run/ payload is simply not one
    // of these; a directory with one and not the other is a broken sample and says so.
    const hasRun = existsSync(join(dir, "run"));
    if (!existsSync(manifest)) {
      if (hasRun) problems.push(`${dir} has a run/ directory but no meta.json — not a usable frozen example`);
      continue;
    }
    let meta;
    try { meta = JSON.parse(readFileSync(manifest, "utf8")); }
    catch (e) { problems.push(`${manifest} is not readable JSON (${String(e?.message ?? e)})`); continue; }
    if (!meta?.runId) { problems.push(`${manifest} names no runId — it is not a frozen example manifest`); continue; }
    if (!hasRun) { problems.push(`${dir} names runId ${meta.runId} but has no run/ directory to publish`); continue; }
    samples.push({ dir, name: d.name, meta });
  }
  return { samples, problems };
}

/**
 * Publish every frozen example into `pool`, but ONLY if the pool holds no runs.
 *
 * `republish` is injected rather than imported so this can be tested without the publisher, and so the
 * one caller keeps deciding which publisher it means. In the product that is
 * `driver/publish/report-registry.mjs`'s `republishRun`, which is the same function `npm run example`
 * uses and which handles both the clearance and the knockout templates — so when the remaining three
 * products have captures to freeze, they seed through this unchanged.
 *
 * @param {object} o
 * @param {string} o.pool                 the install's pool root, already created
 * @param {string} o.examplesDir
 * @param {(a: {runId: string, meta: object, pool: string, poolUrl: string, runDir: string}) => Promise<any>} o.republish
 * @returns {Promise<{seeded: string[], skipped: string|null, problems: string[]}>}
 */
export async function seedPool({ pool, examplesDir, republish }) {
  const existing = poolRunIds(pool);
  if (existing.length) {
    // Named with the count, not just refused. "It did not seed" and "it did not seed BECAUSE there are
    // already 14 runs here" are the same non-event to the code and different facts to a reader.
    return { seeded: [], skipped: `the pool already holds ${existing.length} run(s)`, problems: [] };
  }

  const { samples, problems } = frozenSamples(examplesDir);
  if (!samples.length) {
    // The empty archive is now the SYMPTOM of something, and this is where the something is named.
    return { seeded: [], skipped: null, problems: [...problems, `no frozen example was found under ${examplesDir}`] };
  }

  const seeded = [];
  const failures = [];
  for (const s of samples) {
    // Belt and braces against a partial pool: the emptiness check above already means nothing is here,
    // but a sample list carrying the same runId twice would otherwise overwrite silently.
    if (seeded.includes(s.meta.runId)) { failures.push(`${s.name}: runId ${s.meta.runId} appears twice under ${examplesDir}`); continue; }
    try {
      // poolUrl "" for the same reason the demo passes it: the report's link block addresses a
      // deployment that serves the pool at a public URL, and this one is served from this machine.
      await republish({ runId: s.meta.runId, meta: s.meta, pool, poolUrl: "", runDir: join(s.dir, "run") });
      seeded.push(s.meta.runId);
    } catch (e) {
      // One bad sample must not cost the others. Every failure is carried out to the caller.
      failures.push(`${s.name}: ${String(e?.message ?? e)}`);
    }
  }
  return { seeded, skipped: null, problems: [...problems, ...failures] };
}
