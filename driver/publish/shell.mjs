// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/shell.mjs — what publishing a report does whichever report it is. Both publishers call it; what a report says stays
// with its own renderer.
//
// A PART THAT FAILS DOES NOT STOP THE REPORT, and both publishers answer alike (design ruling, 2026-11-10). A workbook that
// cannot be built or a data file that cannot be written leaves the report in place, and nothing the run publishes names the
// missing file. A staff-page refresh that fails is recorded after the report is in place. The report page and `meta.json`
// are not parts: a failure to write either still throws, because then there is no report to deliver.
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runLog } from '../log.mjs';
import { RUN_DIR_MODE, atomicWrite, ensureDriverDir, paths } from '../run-record.mjs';
import { withWorkbook } from './report-document.mjs';

export const grpRead = (p, mode) => { try { chmodSync(p, mode); } catch { /* best-effort */ } };

const reasonOf = (e) => String(e?.message ?? e);
const record = (runDir, row) => { if (runDir) { try { runLog(runDir, row); } catch { /* meta.json and the return carry it too */ } } };
const removePart = (p) => { try { rmSync(p, { force: true }); } catch { /* nothing names it, so a leftover is never offered */ } };

/**
 * Create a run's folder in the report pool and return the ways a publisher puts a file there.
 *
 * The run dir inherits the web-server group + the set-GID bit AUTOMATICALLY from the set-GID pool root
 * (mode 2750, web-server group) — so files written inside take that group and the web server (Caddy in
 * the reference deployment, mode 0640) can read them. Do NOT chmod this dir: the service account is not
 * a member of the web-server group, and POSIX silently strips S_ISGID when a non-member sets it, leaving
 * the dir 0750 → new files fall back to the service account's primary group → every report 403s. (An explicit
 * `grpRead(poolRunDir, 0o2750)` here, added 2026-06-02, WAS that 403 bug; removed 2026-06-08.)
 *
 * The two parts a report can ship without go through the folder too. `buildWorkbook(name, build)` awaits `build(path)` and
 * returns `{ auditFile, auditError, built }`: the file's name and what `build` returned, or a null name and the reason when
 * it threw, with any part of the file it left removed. `writeDataFile(name, produce)` writes `produce()` as JSON and
 * returns the name, or null when either threw, so a caller claims a data file only when it exists. `copyPart(src, name)`
 * copies a run file into the folder the same way, and returns the name or null. All three record a failure in `runDir`'s
 * log when they are given one.
 */
export function openPoolRun(poolRoot, runId, { runDir = null } = {}) {
  const poolRunDir = join(poolRoot, runId);
  mkdirSync(poolRunDir, { recursive: true, mode: RUN_DIR_MODE });   // owner and group only; mkdir keeps the pool root's set-GID
  const writeRO = (name, data) => { const p = join(poolRunDir, name); writeFileSync(p, data); grpRead(p, 0o640); };
  const copyRO = (src, name) => { const p = join(poolRunDir, name); copyFileSync(src, p); grpRead(p, 0o640); };
  const buildWorkbook = async (name, build) => {
    const p = join(poolRunDir, name);
    try {
      const built = await build(p);
      grpRead(p, 0o640);
      return { auditFile: name, auditError: null, built };
    } catch (e) {
      removePart(p);
      const auditError = reasonOf(e);
      console.warn(`[audit-workbook] not built, the report ships without it: ${auditError.slice(0, 140)}`);
      record(runDir, { event: 'workbook-not-built', file: name, error: auditError.slice(0, 300) });
      return { auditFile: null, auditError, built: null };
    }
  };
  const writeDataFile = (name, produce) => {
    try { writeRO(name, JSON.stringify(produce(), null, 2)); return name; }
    catch (e) {
      removePart(join(poolRunDir, name));
      const error = reasonOf(e);
      console.warn(`[report-data] ${name} not written, the report ships without it: ${error.slice(0, 140)}`);
      record(runDir, { event: 'data-file-not-written', file: name, error: error.slice(0, 300) });
      return null;
    }
  };
  const copyPart = (src, name) => {
    try { copyRO(src, name); return name; }
    catch (e) {
      removePart(join(poolRunDir, name));
      const error = reasonOf(e);
      console.warn(`[publish] ${name} not copied, the report ships without it: ${error.slice(0, 140)}`);
      record(runDir, { event: 'data-file-not-written', file: name, error: error.slice(0, 300) });
      return null;
    }
  };
  return { poolRunDir, writeRO, copyRO, copyPart, buildWorkbook, writeDataFile };
}

/**
 * Write the run's `meta.json` and refresh the pool's index, and return the index's count (null when the caller asked for
 * no refresh). `meta.json` is the last file a publisher writes, because the index lists only folders that hold one: every
 * document is in place before the run becomes visible. `regenIndex` is passed in because it lives with the clearance
 * publisher, which imports this module.
 */
export function finishPoolRun({ writeRO, meta, poolRoot, skipRegen, regenIndex }) {
  writeRO('meta.json', JSON.stringify(meta, null, 2));
  return skipRegen ? null : regenIndex(poolRoot);
}

/**
 * Refresh the staff pages once the report and its `meta.json` are in place. A failure is recorded and returned, never
 * thrown: the report is already delivered, and the next publish refreshes the pages again. `regenSurfaces` is passed in for
 * the reason `regenIndex` is. Returns null when the refresh ran or was not asked for.
 */
export async function refreshStaffPages({ regenSurfaces, poolRoot, skipRegen, runDir = null }) {
  if (skipRegen) return null;
  try { await regenSurfaces(poolRoot); return null; }
  catch (e) {
    const error = reasonOf(e);
    console.warn(`[publish] staff pages not refreshed, the report is in place: ${error.slice(0, 140)}`);
    record(runDir, { event: 'staff-pages-not-refreshed', error: error.slice(0, 300) });
    return error;
  }
}

/**
 * Publish one run, in the order every report shape follows. `shape` supplies what differs between the shapes; this holds
 * the order, so a step added to publishing is added once:
 *
 *   read the run → open its pool folder → keep the run's working record there → build the report document → build the
 *   workbook → name the workbook on the document → write the document to the run → write the pages and data files →
 *   write `meta.json` → refresh the staff pages.
 *
 * The document is built once and kept in the run's own record, never the pool. A build that throws costs every surface
 * that reads it, as a throw in any of them always has: `shape.surfaces` and `shape.meta` read only the document, and the
 * record fails the publish when there is none. `shape.warn(what, error)` says so in the shape's own words, `what` being
 * 'not built' or 'not written'. `regenIndex` and `regenSurfaces` come with the shape for the reason `finishPoolRun` takes
 * them as arguments.
 *
 * @param {{ read(input): Promise<object>, keep(pool, read): object|void, document(read, kept): object,
 *   workbook(pool, document, read): Promise<{auditFile: string|null, auditError: string|null, built: any}>,
 *   surfaces(pool, document, read, kept, workbook): object, meta(document, surfaces): object,
 *   result(parts): object, warn(what: string, e: unknown): void, regenIndex: Function, regenSurfaces: Function }} shape
 * @param {{ poolRoot: string, runId: string, runDir?: string|null, skipRegen?: boolean }} input  the publisher's arguments
 */
export async function publishRun(shape, input) {
  const { poolRoot, runId, runDir = null, skipRegen = false } = input;
  const read = await shape.read(input);
  const pool = openPoolRun(poolRoot, runId, { runDir });
  const kept = shape.keep(pool, read) ?? {};
  let document = null;
  try { document = shape.document(read, kept); } catch (e) { shape.warn('not built', e); }
  const workbook = await shape.workbook(pool, document, read);
  if (document) document = withWorkbook(document, { auditFile: workbook.auditFile, auditError: workbook.auditError });
  if (document && runDir) {
    try { ensureDriverDir(runDir); atomicWrite(paths(runDir).reportDocument, JSON.stringify(document, null, 1) + '\n'); }
    catch (e) { shape.warn('not written', e); }
  }
  const surfaces = shape.surfaces(pool, document, read, kept, workbook);
  const total = finishPoolRun({ writeRO: pool.writeRO, poolRoot, skipRegen, regenIndex: shape.regenIndex, meta: shape.meta(document, surfaces) });
  await refreshStaffPages({ regenSurfaces: shape.regenSurfaces, poolRoot, skipRegen, runDir });
  return shape.result({ read, pool, kept, workbook, surfaces, total });
}
