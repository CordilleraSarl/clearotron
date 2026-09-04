// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/report-registry.mjs — template name → the publisher that renders it.
//
// The product registry (search-policy.mjs PRODUCT_POLICIES) says which report a product produces:
// `report.template` is "clearance" or "knockout". This is the other half — the one place that turns that
// word into a call. Adding a level is a row there; adding a REPORT SHAPE is a row here, and nowhere else.
//
// Why this exists at all: the renderer used to be chosen implicitly, ~3000 lines upstream, by
// pipeline.mjs dispatching on `pipeline` and each lane hard-wiring its own publisher. That was fine while
// the only caller was the lane itself, and wrong for everybody else — pool-admin's republish assumed
// publishReport unconditionally, so `republish <a knockout run>` failed on a missing report.md and no
// knockout report could ever be re-rendered. A report shape you cannot re-render is a report shape you
// cannot fix after delivery.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driverDir } from '../../shared/driver-dir.mjs';   //
import { publishReport } from './index.mjs';
import { publishKnockout } from './knockout.mjs';
import { worstBand } from '../verify-knockout.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readJsonOr = (p, fallback = null) => { try { return readJson(p); } catch { return fallback; } };

/** The template a PUBLISHED run was rendered under, read from its meta.
 *
 *  `meta.template` has been stamped by both publishers since long before it was read by anything; this is
 *  the reader it was always waiting for. `kind` is the belt-and-braces fallback for a meta written before
 *  the stamp existed — `knockout-batch` has been on every knockout meta from the start.
 */
export function templateOfMeta(meta) {
  if (meta?.template === 'knockout' || meta?.kind === 'knockout-batch') return 'knockout';
  return 'clearance';
}

/** Re-render one run from its archived run WORKSPACE, through whichever publisher its shape calls for.
 *
 *  Both branches source the workspace rather than the pool dir: the pool keeps the rendered outputs, the
 *  workspace keeps the inputs (`_driver/` sidecars, the sweep receipts, the count sidecar). A "re-render"
 *  that read the pool would be re-rendering its own output.
 */
export async function republishRun({ runId, meta, pool, poolUrl, runDir, skipRegen = false }) {
  const template = templateOfMeta(meta);
  if (template !== 'knockout') {
    if (!existsSync(join(runDir, 'report.md'))) throw new Error(`${runDir} has no report.md — not a clearance run workspace.`);
    const prof = readJsonOr(driverDir(runDir, 'profile.json'));
    return publishReport({
      runId,
      codename: meta?.codename || '',
      reportMd: join(runDir, 'report.md'),
      auditMd: existsSync(join(runDir, 'audit.md')) ? join(runDir, 'audit.md') : undefined,
      findingsJson: join(runDir, 'findings.json'),
      poolRoot: pool,
      poolUrl,
      customerKey: prof?.profileKey ?? meta?.customerKey ?? 'generic',
      delivery: prof?.delivery,
      runDir,
      skipRegen,
    });
  }

  // Knockout: the batch findings ARE the report source (there is no report.md to parse — the markdown is
  // an output of publish, not an input to it). The framework must come from the run's own frozen sidecar
  // and never from today's config: the bands a run was rated under are part of what it said, and
  // re-rendering it under a framework it never saw would silently restate its verdict.
  const findingsPath = join(runDir, 'knockout-findings.json');
  if (!existsSync(findingsPath)) throw new Error(`${runDir} has no knockout-findings.json — not a knockout run workspace.`);
  const findings = readJson(findingsPath);
  const framework = readJsonOr(driverDir(runDir, 'framework.json'));
  if (!framework) throw new Error(`${runDir} has no _driver/framework.json — a knockout cannot be re-rendered without the bands it was rated under.`);
  const searchPolicy = readJsonOr(driverDir(runDir, 'search-policy.json'));
  const prof = readJsonOr(driverDir(runDir, 'profile.json'));
  return publishKnockout({
    runId,
    codename: meta?.codename || '',
    runDir,
    findings,
    plan: readJsonOr(join(runDir, 'knockout-plan.json')),
    framework,
    // Recomputed from the frozen framework + the frozen findings, exactly as the lane computed it. The
    // stored meta.overall is not trusted as an input: it is an OUTPUT of this same join, and feeding an
    // output back in is how a stale word survives a re-render that was meant to correct it.
    overall: worstBand(framework, findings.marks ?? []),
    poolRoot: pool,
    poolUrl,
    customerKey: prof?.profileKey ?? meta?.customerKey ?? 'generic',
    // — THE SEAM THAT FAILS SILENTLY IF IT IS MISSED. The clearance branch above has passed
    // `delivery: prof?.delivery` since the overlay existed; this one read the same `prof` and dropped it,
    // so a republished knockout re-rendered under whatever the template defaulted to. With the marking
    // now profile-decided that is not a cosmetic gap: a privileged customer's re-rendered knockout would
    // lose "Attorney Work Product" and nothing would raise an error — an absence, which this repo counts
    // as a finding rather than a pass. A run with no profile sidecar yields undefined, which is the
    // NO-OPINION state and the correct answer for an archive that never recorded one.
    delivery: prof?.delivery,
    searchPolicy,
    skipRegen,
  });
}
