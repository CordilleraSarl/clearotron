// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PACKAGED INSTALL SHIPS NO OUTBOX WATCHER, AND THE ENGINE SAYS SO.
//
// The engine's comments described an outbox watcher that wakes the assistant when a run finishes: a `.path` unit firing
// an instant wake, with the reference wake script "paired" with it. Those units retired with the path-watcher posture,
// and nothing the packaged install ships watches the outbox; an integrator wakes itself. An assistant built from the
// comments would wait for a wake that never comes. This holds that no outbox unit ships, and that the outbox module,
// the configuration, the reference wake and the delivery document say what is true.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");
/** A source file's comments read as prose: the line breaks and their comment markers fold into one space. */
const prose = (rel) => read(rel).replace(/\n\s*(?:\/\/|#)\s?/g, " ").replace(/\s+/g, " ");
const NO_WATCHER = "The packaged install runs no watcher on";

test("no outbox unit ships with the systemd units", () => {
  const units = nonEmpty(readdirSync(join(ROOT, "driver", "systemd")).filter((f) => /\.(service|path|timer)$/.test(f)), "the shipped units");
  assert.deepEqual(units.filter((f) => /outbox/i.test(f)), [], "an outbox unit ships after all; the comments below would be wrong");
});

test("the outbox module, the configuration, the wake and the delivery document say no watcher ships", () => {
  const outbox = prose("driver/outbox.mjs");
  assert.ok(outbox.includes(`${NO_WATCHER} config.outboxDir: the integrator wakes itself and drains it over MCP (list_outbox_events)`));
  assert.ok(!outbox.includes("gets an instant wake"), "the outbox module still promises a watcher's wake");
  const config = prose("driver/driver.config.mjs");
  assert.ok(config.includes(`${NO_WATCHER} it: the integrator wakes itself and drains the outbox over MCP`));
  assert.ok(!config.includes("prelim-outbox.path unit fires"), "the configuration still names a unit that fires a wake");
  const wake = prose("driver/deliver-trigger.sh");
  assert.ok(!wake.includes("(paired with prelim-outbox.path/.service/.timer)"), "the reference wake still names units as its pair");
  assert.ok(wake.includes("units no longer ship, and the packaged install runs no outbox watcher"), "the reference wake does not say its units no longer ship");
  const delivery = flat("docs/DELIVERY.md");
  assert.ok(delivery.includes("Its units no longer ship, and the packaged install runs no outbox watcher: the integrator wakes itself."));
  assert.ok(!delivery.includes("reference units, which wake an agent"), "the delivery document still names units that wake an agent");
});
