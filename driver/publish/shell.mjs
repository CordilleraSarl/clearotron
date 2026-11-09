// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/shell.mjs — what publishing a report does whichever report it is. Both publishers call it; what a report says stays
// with its own renderer.
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RUN_DIR_MODE } from '../run-record.mjs';

export const grpRead = (p, mode) => { try { chmodSync(p, mode); } catch { /* best-effort */ } };

/**
 * Create a run's folder in the report pool and return the two ways a publisher puts a file there.
 *
 * The run dir inherits the web-server group + the set-GID bit AUTOMATICALLY from the set-GID pool root
 * (mode 2750, web-server group) — so files written inside take that group and the web server (Caddy in
 * the reference deployment, mode 0640) can read them. Do NOT chmod this dir: the service account is not
 * a member of the web-server group, and POSIX silently strips S_ISGID when a non-member sets it, leaving
 * the dir 0750 → new files fall back to the service account's primary group → every report 403s. (An explicit
 * `grpRead(poolRunDir, 0o2750)` here, added 2026-06-02, WAS that 403 bug; removed 2026-06-08.)
 */
export function openPoolRun(poolRoot, runId) {
  const poolRunDir = join(poolRoot, runId);
  mkdirSync(poolRunDir, { recursive: true, mode: RUN_DIR_MODE });   // owner and group only; mkdir keeps the pool root's set-GID
  const writeRO = (name, data) => { const p = join(poolRunDir, name); writeFileSync(p, data); grpRead(p, 0o640); };
  const copyRO = (src, name) => { const p = join(poolRunDir, name); copyFileSync(src, p); grpRead(p, 0o640); };
  return { poolRunDir, writeRO, copyRO };
}
