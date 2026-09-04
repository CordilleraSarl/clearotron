// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Cross-process advisory lock used to serialize OAuth token refreshes across the
// per-session bridge fleet (see bridge.mjs). Extracted so the locking — the only
// concurrency-critical part — can be unit-tested without the MCP/OAuth machinery.
//
// Mechanism: an O_EXCL lockfile whose mtime is heartbeated while held. A waiter
// reclaims the lock only if its mtime is older than the lease (i.e. the holder is
// dead and stopped heartbeating), so a live holder's slow refresh is never stolen
// mid-flight — which would reintroduce the double-refresh race the lock exists to
// prevent. No external deps (this is `proper-lockfile`'s approach, hand-rolled to
// keep the bridge dependency-free).

import { open, unlink, stat, mkdir, utimes } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RefreshLock {
  constructor(
    lockPath,
    {
      leaseMs = 15_000, // reclaim a lock whose mtime is older than this
      heartbeatMs = 5_000, // a live holder bumps mtime this often
      pollMs = 100,
      waitMaxMs = 28_000, // just under the gateway's 30s MCP connect timeout
    } = {},
  ) {
    this.lockPath = lockPath;
    this.leaseMs = leaseMs;
    this.heartbeatMs = heartbeatMs;
    this.pollMs = pollMs;
    this.waitMaxMs = waitMaxMs;
    this._held = false;
    this._heartbeat = null;
  }

  get held() {
    return this._held;
  }

  // Re-entrant within a process: a second acquire() while already held is a no-op
  // (the SDK retries prepareTokenRequest after an InvalidGrant without releasing).
  async acquire() {
    if (this._held) return;
    const start = Date.now();
    for (;;) {
      try {
        const fh = await open(this.lockPath, "wx"); // O_CREAT | O_EXCL
        await fh.writeFile(String(process.pid));
        await fh.close();
        this._held = true;
        this._heartbeat = setInterval(() => {
          const now = new Date();
          utimes(this.lockPath, now, now).catch(() => {});
        }, this.heartbeatMs);
        this._heartbeat.unref?.();
        return;
      } catch (e) {
        if (e.code === "ENOENT") {
          await mkdir(path.dirname(this.lockPath), { recursive: true, mode: 0o700 });
          continue;
        }
        if (e.code !== "EEXIST") throw e;
        // Held by someone else — reclaim only if its lease has lapsed (holder dead).
        try {
          const st = await stat(this.lockPath);
          if (Date.now() - st.mtimeMs > this.leaseMs) {
            await unlink(this.lockPath).catch(() => {});
            continue;
          }
        } catch {
          continue; // lock vanished between EEXIST and stat — retry to grab it
        }
        if (Date.now() - start > this.waitMaxMs) {
          // Fail safe rather than refresh unlocked: a brick (family revocation) is
          // far worse than this session losing the tool until its next spawn.
          throw new Error(
            `refresh lock contended for >${this.waitMaxMs}ms; aborting to avoid an unsynchronized refresh`,
          );
        }
        await sleep(this.pollMs);
      }
    }
  }

  async release() {
    if (!this._held) return;
    this._held = false;
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
    await unlink(this.lockPath).catch(() => {});
  }

  // For an 'exit' handler, where only synchronous FS calls are usable.
  releaseSync() {
    if (!this._held) return;
    this._held = false;
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* lease will expire */
    }
  }
}
