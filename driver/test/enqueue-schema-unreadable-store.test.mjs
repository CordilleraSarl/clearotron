// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// follow-up — when the profile STORE cannot be read, the door refuses at intake and lets an
// already-admitted job through at claim.
//
// THE BUG THIS PINS WAS INTRODUCED BY 'S OWN FIX, and it is only reachable because of it.
//
// Before that gate consulted the inheritance ladder, a job with no request classes and no goods could
// never be admitted at all — so refusing it again at claim cost nothing, because no such job could be
// sitting in the queue. Once one CAN be admitted on a project's or an account's classes, that population
// exists. `validateJob` runs a second time when the runner claims the job, and an error on that path
// reaches `failAtIntake`: the job parks as `.failed` and the requester is notified, for work that was
// legitimately accepted, possibly days earlier.
//
// The trigger is not a bad profile for this customer. `loadProfiles()` validates every bundle at load, so
// ONE malformed file anywhere makes it throw for EVERY job — a store-wide outage parking unrelated
// accepted work. Measured: a bundle with `platforms: []` is enough.
//
// Same distinction the archived-project rule draws in the same file, in its own words: archive is "stop
// offering this", not "cancel what is already agreed". A store that cannot be READ is even weaker
// evidence than that — it is a failure to look, not a finding that the scope is gone.
//
// Its own file because profiles.mjs freezes PROFILE_DIR from CLEAROTRON_CUSTOMERS_DIR at module load: the env
// must be set before enqueue-schema.mjs is imported, and ESM hoisting rules that out inside a file that
// has already imported it against a good store. (A `?query=` cache-bust does not work either — it makes a
// fresh enqueue-schema, which still resolves the SAME cached profiles.mjs.)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const dir = mkdtempSync(join(tmpdir(), "enqueue-unreadable-"));
writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
// `platforms: []` fails loadProfiles' own shape check ("must be a non-empty array of store-domain
// strings"), and it throws for the whole store rather than for this bundle.
writeFileSync(join(dir, "wrecked.json"), JSON.stringify({ name: "Wrecked Co", matchDomains: ["wrecked.example"], platforms: [] }));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", dir);

// No classes, no marks[].classes, no goods, no use — the only shape that reaches the ladder at all.
const UNSCOPED = { id: "msg-1", msgId: "<msg-1@x>", forwarder: "staff-a", ref: "TMP9001", markName: "QUEUE PROBE", product: "knockout-search" };

let validateJob;
before(async () => { ({ validateJob } = await import("../enqueue-schema.mjs")); });

test("#707 the store really is unreadable — otherwise both tests below prove nothing", () => {
  // A guard on the FIXTURE, not on the code. If loadProfiles ever stops throwing on this shape, the two
  // assertions after it would pass for the wrong reason and quietly stop testing the claim path.
  const v = validateJob({ ...UNSCOPED, profileKey: "anyone", projectKey: "anything" });
  assert.match(v.errors.join(" | "), /could not be read/,
    "the fixture no longer makes loadProfiles throw, so this file is asserting nothing about an unreadable store");
});

test("#707 AT INTAKE: an unreadable store refuses — it cannot prove the subject is scopable", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "anyone", projectKey: "anything" });
  assert.equal(v.ok, false);
  assert.equal(v.classify, "clarify", "the fix is a question back to the requester, not a rejection");
  const e = v.errors.join(" | ");
  assert.match(e, /missing classes AND goods description \(either one suffices\)/, "the original sentence stays");
  assert.match(e, /failure to look, not a finding that nothing is set/,
    "and it must not claim the profile HAS no classes — it was never read");
});

test("#707 AT CLAIM: an already-admitted job is NOT parked because the store went unreadable under it", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "anyone", projectKey: "anything" }, { atClaim: true });
  assert.equal(v.ok, true, "an error here reaches failAtIntake and destroys legitimately accepted work");
  assert.equal(v.classify, "run");
  assert.ok(!v.errors.some((x) => /classes/.test(x)), "no class error may reach the claim path on a store read failure");
  // Visible rather than silent, exactly as the archived-project claim path records its own reason.
  assert.match(v.warnings.join(" | "), /already admitted/);
  assert.match(v.warnings.join(" | "), /not evidence its scope is gone/);
});
