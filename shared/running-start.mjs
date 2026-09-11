// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// running-start.mjs — which foreground `clearotron start` processes are serving on this machine, and where.
//
// `status` promises "is the product up, and on which ports", and knew only about background units. With
// the product running the way the README starts it — `clearotron start` in a terminal — it printed a
// sentence about units the reader never installed, and `stop` said nothing was running while the portal
// answered 200 (measured on a published beta, 2026-09-11). A foreground start now leaves one small record
// here while it serves, and both verbs read it.
//
// THE RECORD IS AN ADDRESS, NEVER PROOF OF LIFE. A start killed outright leaves its record behind, so a
// record whose process is gone is read as absent, and `status` asks the portal itself before saying the
// product is up. Three answers, all honest: up; started but not answering; not running.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the records live: one file per serving process, beside the settings and the revocation list.
 *
 * `~/.config/clearotron` is this product's per-user directory and the only one it reads. An XDG state
 * directory would be the tidier home for this, and it would be a NEW environment variable read by product
 * code — a thing this repo documents in two contract files and classifies in another repo. Not worth a
 * paired change for a file the reader never opens.
 */
export function runningDir({ home = homedir() } = {}) {
  return join(home, ".config", "clearotron", "running");
}

/** Is this process alive? EPERM means it exists and belongs to somebody else, which is alive. */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
}

/**
 * Record one serving start. Returns the function that removes the record; calling it twice is harmless,
 * so the caller can hang it on both its own shutdown and the process's `exit`.
 */
export function recordRunning(rec, { dir = runningDir() } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${rec.pid}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    try { rmSync(file, { force: true }); } catch { /* already gone */ }
  };
}

/** Every record whose process is alive, oldest pid first. Reads; removes nothing. */
export function readRunning({ dir = runningDir(), alive = pidAlive } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => /^\d+\.json$/.test(n))) {
    let rec;
    try { rec = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { continue; }
    if (!Number.isInteger(rec?.pid) || typeof rec?.url !== "string" || !rec?.ports) continue;
    if (!alive(rec.pid)) continue;   // a start that did not exit cleanly: its record says nothing now
    out.push(rec);
  }
  return out.sort((a, b) => a.pid - b.pid);
}

/** Does the portal at `url` answer? A timeout or a refusal is "no", never "unknown dressed as yes". */
export async function probe(url, { timeoutMs = 2000 } = {}) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok; } catch { return false; }
}
