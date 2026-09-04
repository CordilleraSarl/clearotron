// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pool-admin-reassign.test.mjs — `pool-admin reassign <id> <accountKey>` changes which customer OWNS a
// delivered run, which is the ONLY thing in the pool that decides who may open its report.
//
// WHY THIS IS TESTED HARDER THAN IT LOOKS. The write itself is one field. What matters is the two ways
// of getting it wrong, and both have bitten this system before:
//
//   • validating the key against the BUNDLED demo roster, which shares not one key with the config
//     store (driver/profiles.mjs header; the same split refused every real customer on 2026-07-22) —
//     so every genuine account looks unknown and the operator is told the customer does not exist;
//   • filing a run under a key nobody holds, which is indistinguishable from deleting it: the run is
//     in the pool, the report is on disk, and no login on earth can list or open it.
//
// SAFETY GUARD: env pinned before the dynamic import — driver.config freezes roots at import time, and
// pool-admin reads CLEAROTRON_REPORTS_DIR at module load.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { pinEnv, pinEnvAll } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
const POOL = __mkdtemp(__join(__tmpdir(), "reassign-pool-"));
const PROFILES = __mkdtemp(__join(__tmpdir(), "reassign-profiles-"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", POOL);
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, "..", "publish", "pool-admin.mjs");

// A profile store with the shape loadProfiles insists on. generic.json is REQUIRED (it is the universal
// fallback, and its absence would mis-profile every job), and the shape gate denies unknown keys — every
// field must have a live consumer — so this mirrors a shipped profile rather than inventing one.
const profile = (key) => ({
  name: key, matchDomains: [], platforms: ["amazon.com"],
  defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [],
  delivery: { email: "summary", privileged: false },
});
for (const k of ["generic", "aurora", "zephyr"]) {
  writeFileSync(join(PROFILES, `${k}.json`), JSON.stringify(profile(k)));
}

const RUN = "tmp9001-aquaplus-2026-07-13-ashen-bastion";
function seedRun(customerKey) {
  mkdirSync(join(POOL, RUN), { recursive: true });
  writeFileSync(join(POOL, RUN, "meta.json"), JSON.stringify({
    runId: RUN, customerKey, codename: "ashen-bastion", date: "2026-07-13",
    matter: "AQUAPLUS", title: "VIBRANT AQUAPLUS", client: "Zephyr Beverages Ltd",
    overall: "MEDIUM", badge: "l3", kind: "clearance",
  }, null, 2));
  writeFileSync(join(POOL, RUN, "report.html"), "<title>AQUAPLUS</title>ok");
}

function admin(args, env = {}) {
  return execFileSync(process.execPath, [ADMIN, ...args], {
    encoding: "utf8",
    // — `pinEnvAll`, not a spread. The parent env now carries BOTH spellings of
    // each of these, so an override that empties one leaves the other standing and the child reads a
    // value the caller meant to clear. The unset-roster arm below is exactly that case.
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_REPORTS_DIR: POOL, CLEAROTRON_CUSTOMERS_DIR: PROFILES, ...env }),
  });
}
function adminFails(args, env = {}) {
  try {
    admin(args, env);
    return null;   // caller asserts on non-null
  } catch (e) {
    return String(e.stderr ?? e.message);
  }
}

const metaNow = () => JSON.parse(readFileSync(join(POOL, RUN, "meta.json"), "utf8"));

test("reassign moves customerKey, and leaves every other field of the meta alone", () => {
  seedRun("aurora");
  const out = admin(["reassign", RUN, "zephyr"]);
  assert.equal(metaNow().customerKey, "zephyr");
  assert.match(out, /aurora → zephyr/);
  // The rest of the meta is the run's identity and its published facts. Reassignment is an access
  // decision; rewriting anything else here would be forging the record.
  const m = metaNow();
  assert.equal(m.runId, RUN);
  assert.equal(m.title, "VIBRANT AQUAPLUS");
  assert.equal(m.overall, "MEDIUM");
  assert.equal(m.client, "Zephyr Beverages Ltd");
});

test("the report still names the ORIGINAL client, and the command says so out loud", () => {
  seedRun("aurora");
  const out = admin(["reassign", RUN, "zephyr"]);
  // THE TRADE BEING MADE. A delivered report is frozen: the findings, the narrative and the risk
  // framework all carry the original customer's name and are not re-rendered. So this moves who may
  // OPEN the document, not one word of what they read — handing one customer a report that names
  // another is a disclosure decision, and it has to be visible at the moment it is taken rather than
  // discovered by whoever opens it.
  assert.match(out, /still names "Zephyr Beverages Ltd"/);
  assert.match(readFileSync(join(POOL, RUN, "report.html"), "utf8"), /AQUAPLUS/);
});

test("an account key that is not in the roster is REFUSED, and the refusal lists what is", () => {
  seedRun("aurora");
  const err = adminFails(["reassign", RUN, "zeyphr"]);   // a plausible typo for zephyr
  assert.ok(err, "a bad key must be a non-zero exit, not a warning");
  assert.match(err, /not a customer/);
  assert.match(err, /aurora, generic, zephyr/, "the refusal names the roster it checked against");
  assert.equal(metaNow().customerKey, "aurora", "and nothing was written");
});

test("with CLEAROTRON_CUSTOMERS_DIR unset it REFUSES rather than validating against the demo roster", () => {
  // The MCP door only WARNS about this, because failing closed there would take a read-only service
  // down over a config slip. This is a one-shot curation command: writing the wrong owner is worse
  // than not running, so the same condition is fatal here. Two doors, same fact, different verdicts —
  // deliberately.
  seedRun("aurora");
  const err = adminFails(["reassign", RUN, "zephyr"], { CLEAROTRON_CUSTOMERS_DIR: "" });
  assert.ok(err, "unset roster must be fatal");
  assert.match(err, /CLEAROTRON_CUSTOMERS_DIR is unset/);
  assert.match(err, /BUNDLED demo/);
  assert.equal(metaNow().customerKey, "aurora", "and nothing was written");
});

test("reassigning to the key it already has is a no-op that says so", () => {
  seedRun("zephyr");
  const out = admin(["reassign", RUN, "zephyr"]);
  assert.match(out, /already owned by "zephyr"/);
  assert.equal(metaNow().customerKey, "zephyr");
});

test("an unknown run is refused, by the same resolver archive/unarchive use", () => {
  // The roster is checked BEFORE the run id, deliberately: a missing CLEAROTRON_CUSTOMERS_DIR or a bad key
  // is an environment problem that blocks every invocation, and reporting it first spares the operator
  // fixing a runId only to hit the real obstacle on the next attempt.
  seedRun("aurora");
  const err = adminFails(["reassign", "no-such-run", "zephyr"]);
  assert.ok(err);
  assert.match(err, /no run matches/);
});

test("reassign needs both arguments", () => {
  seedRun("aurora");
  const err = adminFails(["reassign", RUN]);
  assert.ok(err);
  assert.match(err, /needs <runId\|codename> <accountKey>/);
});
