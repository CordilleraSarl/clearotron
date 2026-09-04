// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/ratelimit.mjs — tiny in-memory per-identity token bucket. Bounds abuse/runaway clients on the remote
// face. Single-instance only (state is per-process); good enough for a small internal user base. `now` is
// injectable for tests.

export class RateLimiter {
  constructor({ perMinute = 120, max } = {}) {
    this.perMinute = perMinute;
    this.max = max ?? perMinute; // bucket capacity (burst)
    this.buckets = new Map();
    this._lastPrune = 0;
  }
  // Drop idle (full-bucket, >10min untouched) entries so a long-lived process doesn't retain departed
  // identities forever. Bounded work: runs at most every 5 min. Identities are verified emails, so the key
  // space is org-bounded regardless — this is just hygiene.
  _prune(now) {
    for (const [k, b] of this.buckets) if (b.tokens >= this.max && now - b.last > 600000) this.buckets.delete(k);
  }
  take(key, now = Date.now()) {
    if (now - this._lastPrune > 300000) { this._prune(now); this._lastPrune = now; }
    const k = key || "anon";
    const refillPerMs = this.perMinute / 60000;
    let b = this.buckets.get(k);
    if (!b) { b = { tokens: this.max, last: now }; this.buckets.set(k, b); }
    b.tokens = Math.min(this.max, b.tokens + (now - b.last) * refillPerMs);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
