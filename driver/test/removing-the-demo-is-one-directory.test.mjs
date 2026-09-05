// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 94, the demo's own promise — "removing it later is one directory".
//
// It was not quite true. The test lane drove the published 0.1.0 tarball on a wiped machine: after
// `rm -rf` of the demo base the sign-in passphrase was still there, in the shared default under
// `~/.cordillera/`, and `passphrase --reset` did not recover it. Reproduced on this tree as a stranger,
// the credential now lands inside the base — and a SECOND file did not: the revocation list, at
// `~/.config/clearotron/token-denylist`.
//
// A promise with an exception nobody names is worse than no promise, because the reader stops looking.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { childEnv, installPaths } from "../../bin/start.mjs";
import { denylistFor } from "../../shared/client-door.mjs";
import { credentialPathFor } from "../portal-local-auth.mjs";

// `/srv/...` RATHER THAN `/home/...` IN EVERY FIXTURE PATH. A corpus guard refuses an executable line
// naming a specific account's home directory, and it walks the tree itself — so it is reached by no
// derivation from this change's files and only fires on a full run. It cost this branch one.
const ports = { portal: 1, mcp: 2, client: 3 };
const demoEnv = (base) => childEnv({
  ports, paths: installPaths(base), user: "someone@example.com", staffDomains: [],
  portalSecret: "s", tokenSecret: "t", opsToken: "v1.x.y", demo: true, env: {},
});

test("94 everything a demo writes is inside the directory it says to remove", () => {
  const base = "/srv/stranger/trademark-demo";
  const env = demoEnv(base);
  // Every value in the demo's child environment that names a FILE must be under the base. Read as a
  // population rather than one key at a time: the credential was fixed this way once already, and the
  // revocation list — the same shape, one key along — was missed because nothing looked at the set.
  const outside = Object.entries(env.portal ?? {})
    .concat(Object.entries(env.mcp ?? {}), Object.entries(env.client ?? {}), Object.entries(env.worker ?? {}))
    .filter(([, v]) => typeof v === "string" && v.startsWith("/"))
    .filter(([, v]) => !v.startsWith(base));
  assert.deepEqual(outside, [],
    "a demo writes these outside the directory it tells the reader to remove: "
    + outside.map(([k, v]) => `${k}=${v}`).join(", "));
});

test("94 the revocation list is the demo's own, and only the demo's", () => {
  const base = "/srv/stranger/trademark-demo";
  // The CLIENT door is where account keys live, and where this key is composed.
  assert.equal(demoEnv(base).client.TRADEMARK_MCP_TOKEN_DENYLIST, join(base, "token-denylist"));

  // AND A REAL INSTALL'S DOES NOT MOVE. `installPaths` deliberately returns no `denylist`, so the
  // composition falls through to the operator's own setting or the shared default. Giving every install
  // one inside its base would move a LIVE revocation list: entries in the old file would stop being
  // read, and a revoked key would answer again.
  assert.equal(installPaths(base).denylist, undefined,
    "installPaths grew a denylist key — that moves every existing install's revocation list");
  const live = childEnv({
    ports, paths: installPaths("/srv/operator/trademark"), user: "op@example.com", staffDomains: [],
    portalSecret: "s", tokenSecret: "t", opsToken: "v1.x.y", demo: false, env: {},
  });
  assert.ok(!String(live.client?.TRADEMARK_MCP_TOKEN_DENYLIST ?? "").startsWith("/srv/operator/trademark/"),
    "a non-demo install's revocation list moved into its base");
});

test("94 the passphrase decision asks about the file the portal will use", () => {
  // The supervisor mints a passphrase only when there is not one already, and it used to ask that of the
  // SHARED default while handing the portal a different file. On any machine that already had one, a
  // demo minted nothing and the portal then said the passphrase "was minted on an earlier start and is
  // NOT reprinted" — over an empty credential file, to a visitor who could not sign in.
  const base = "/srv/stranger/trademark-demo";
  const env = demoEnv(base);
  assert.equal(credentialPathFor(env.portal), join(base, "portal-local-credential.json"),
    "the portal's own environment does not name the credential the mint decision must ask about");
  assert.notEqual(credentialPathFor(env.portal), credentialPathFor({}, "/srv/stranger"),
    "the demo's credential and the shared default are the same file — then this arm proves nothing");
});


test("94 the revocation list's path is composed once, so the door and the supervisor cannot disagree", () => {
  // THE ARM THAT WOULD HAVE CAUGHT THIS ONE. Scoping the demo's list in the child environment left the
  // stranger's file exactly where it was: the supervisor CREATES the file from a path it composed
  // separately, a few hundred lines from the door that reads it, and `connect` had a third. Every arm
  // about the environment passed while the thing on disk was unchanged.
  //
  // A source read, and named as one: the two callers now return the same value by construction, so an
  // arm comparing them proves nothing. What can still regress is a FOURTH site composing its own, and
  // that is what this refuses.
  const src = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "..", "bin", "start.mjs"), "utf8");
  // `bin/start.mjs` must not compose it at all now: the resolver lives in the file that owns the path,
  // beside the default it falls through to, which is what the tree's own one-owner guard requires.
  const lines = src.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /denylistPathFor\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/^import/.test(l));
  assert.deepEqual(lines.map(([n]) => n), [],
    "bin/start.mjs composes the revocation list's default itself — one of the copies will be the file "
    + "nobody reads. It has one owner, `shared/client-door.mjs`.");

  // The resolver itself still answers both questions.
  assert.equal(denylistFor({ paths: installPaths("/srv/example/trademark-demo"), demo: true }), "/srv/example/trademark-demo/token-denylist");
  assert.notEqual(denylistFor({ paths: installPaths("/srv/operator/trademark"), demo: false, env: {}, home: "/srv/operator" }), "/srv/operator/trademark/token-denylist");
});
