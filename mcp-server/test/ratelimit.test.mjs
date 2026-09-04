// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Rate-limiter unit tests (token bucket, injectable clock).

import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../lib/ratelimit.mjs";

test("allows up to capacity, then blocks, then refills over time", () => {
  const rl = new RateLimiter({ perMinute: 60 }); // capacity 60, refill 1/sec
  const t = 1_000_000;
  for (let i = 0; i < 60; i++) assert.equal(rl.take("a", t), true, `token ${i} should pass`);
  assert.equal(rl.take("a", t), false, "61st in the same instant is blocked");
  assert.equal(rl.take("a", t + 1000), true, "after 1s, ~1 token refilled");
  assert.equal(rl.take("a", t + 1000), false, "…but only one");
});

test("identities are independent", () => {
  const rl = new RateLimiter({ perMinute: 2 });
  const t = 5;
  assert.equal(rl.take("a", t), true);
  assert.equal(rl.take("a", t), true);
  assert.equal(rl.take("a", t), false); // a exhausted
  assert.equal(rl.take("b", t), true);  // b unaffected
});
