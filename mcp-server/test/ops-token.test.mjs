// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Ops-token issuance (INSTALL.md §8): principal binding (sub), verb-scoped least
// privilege, the mint CLI — and full backward compatibility for legacy tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken, verifyToken, resolveScope, authorize } from "../lib/scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "mint-token.mjs");
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "test-secret-ops-token";

test("sub + verbs roundtrip; resolveScope carries the principal", () => {
  const tok = mintToken({ scope: "ops", sub: "connector-intake", verbs: ["start_run", "feed_context"] });
  const v = verifyToken(tok);
  assert.equal(v.sub, "connector-intake");
  assert.deepEqual(v.verbs, ["start_run", "feed_context"]);
  const scope = resolveScope({ innerToken: tok });
  assert.equal(scope.kind, "ops");
  assert.equal(scope.sub, "connector-intake");
  assert.deepEqual(scope.verbs, ["start_run", "feed_context"]);
  // trusted local stdio names itself
  assert.equal(resolveScope({ local: true }).sub, "local");
});

test("verb-scoped ops token: allowed verbs + all reads pass, off-list writes are refused", () => {
  const scope = resolveScope({ innerToken: mintToken({ scope: "ops", sub: "connector-intake", verbs: ["start_run", "feed_context"] }) });
  // start_run args pass through untouched: the forwarder stamp is plan_run-only (shared/scope.mjs).
  assert.deepEqual(authorize(scope, "start_run", { markName: "X" }), { markName: "X" });
  assert.deepEqual(authorize(scope, "feed_context", { runId: "r1" }), { runId: "r1" });
  assert.deepEqual(authorize(scope, "list_runs", {}), {}, "reads stay unrestricted for ops");
  assert.deepEqual(authorize(scope, "brief", { runId: "r1" }), { runId: "r1" });
  assert.throws(() => authorize(scope, "stop_run", { id: "j1" }), /verb-scoped/);
  assert.throws(() => authorize(scope, "what_if_run", {}), /verb-scoped/);
});

test("legacy ops token (no sub/verbs) keeps FULL authority — nothing regresses", () => {
  const scope = resolveScope({ innerToken: mintToken({ scope: "ops" }) });
  assert.equal(scope.sub, null);
  assert.equal(scope.verbs, null);
  assert.deepEqual(authorize(scope, "stop_run", { id: "j1" }), { id: "j1" });
});

test("mint validation: unknown verb, verbs-on-user, empty verbs all refused", () => {
  assert.throws(() => mintToken({ scope: "ops", verbs: ["rm_rf"] }), /unknown write verb/);
  assert.throws(() => mintToken({ scope: "ops", verbs: ["brief"] }), /unknown write verb/, "reads are not verbs");
  assert.throws(() => mintToken({ scope: "user", runId: "r1", verbs: ["start_run"] }), /only meaningful on an ops token/);
  assert.throws(() => mintToken({ scope: "ops", verbs: [] }), /non-empty/);
});

test("mint CLI: mints a verifiable token; fails closed on missing sub/run/secret", () => {
  const env = { ...process.env, TRADEMARK_MCP_TOKEN_SECRET: "cli-secret" };
  const run = (args, e = env) => spawnSync(process.execPath, [CLI, ...args], { env: e, encoding: "utf8" });

  const ok = run(["--scope", "ops", "--sub", "connector-intake", "--verbs", "start_run,feed_context", "--ttl-days", "7"]);
  assert.equal(ok.status, 0, ok.stderr);
  process.env.TRADEMARK_MCP_TOKEN_SECRET = "cli-secret";
  const v = verifyToken(ok.stdout.trim());
  process.env.TRADEMARK_MCP_TOKEN_SECRET = "test-secret-ops-token";
  assert.equal(v.sub, "connector-intake");
  assert.deepEqual(v.verbs, ["start_run", "feed_context"]);
  assert.ok(v.exp - Date.now() / 1000 < 8 * 24 * 3600, "ttl honored");
  assert.match(ok.stderr, /minted: scope=ops sub=connector-intake/);

  assert.notEqual(run(["--scope", "ops"]).status, 0, "ops without --sub refused (audit must name the principal)");
  assert.notEqual(run(["--scope", "user"]).status, 0, "user without --run refused");
  assert.notEqual(run(["--scope", "ops", "--sub", "x"], { ...env, TRADEMARK_MCP_TOKEN_SECRET: "" }).status, 0, "no secret → fail closed");
  const full = run(["--scope", "ops", "--sub", "admin"]);
  assert.equal(full.status, 0);
  assert.match(full.stderr, /FULL ops authority/, "un-scoped ops mint warns loudly");
});

// ---- jti revocation + two-secret rotation (INSTALL.md §8) --------------------------------------

import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const b64u = (b) => Buffer.from(b).toString("base64url");
const rawToken = (payload, secret) => {
  const body = b64u(JSON.stringify(payload));
  return `v1.${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`;
};

test("jti: every minted token carries one; a legacy token without jti still verifies (jti=null)", () => {
  const v = verifyToken(mintToken({ scope: "ops", sub: "x" }));
  assert.match(v.jti, /^[0-9a-f]{12}$/);
  const legacy = rawToken({ scope: "ops", exp: Math.floor(Date.now() / 1000) + 60 }, process.env.TRADEMARK_MCP_TOKEN_SECRET);
  assert.equal(verifyToken(legacy).jti, null, "pre-jti tokens keep verifying");
});

test("revocation: a jti on the denylist is refused; others pass; comments are inert; a MISSING list refuses", () => {
  // THIS ARM USED TO ASSERT THE OPPOSITE OF ITS LAST CLAUSE, and the reversal was deliberate.
  //
  // It read "missing file are inert", with the reasoning in its own comment: "the denylist can never
  // take all auth down". That is a real trade and it was chosen knowingly — availability over
  // enforcement. bb8's F14 measured what it cost: on a default `clearotron start` install the door was
  // pointed at a denylist nothing created, so EVERY revocation check silently passed and a revoked key
  // completed a full handshake with nothing logged. The inert-missing-file rule is what made the hole
  // invisible rather than loud.
  //
  // Overwatch ruling (recorded on 1889 for the owner's review, reversal path is isRevoked alone): fail
  // CLOSED. `start` now creates the list before any door starts, so reaching the unreadable branch means
  // an operator removed it under a running door — rare, and its cost is now a visible outage that names
  // its own cause instead of a silent security hole.
  //
  // The other half of the old trade is preserved deliberately: an UNSET denylist is still inert, so a
  // deployment that never asked for one cannot be taken down by this.
  const dir = mkdtempSync(join(tmpdir(), "tm-denylist-"));
  const listPath = join(dir, "denylist.txt");
  const dead = mintToken({ scope: "ops", sub: "compromised" });
  const alive = mintToken({ scope: "ops", sub: "healthy" });
  try {
    process.env.TRADEMARK_MCP_TOKEN_DENYLIST = listPath;
    // A CONFIGURED LIST THAT IS NOT THERE IS A CHECK THAT COULD NOT RUN, and it refuses.
    assert.throws(() => verifyToken(dead), /revocation could not be checked/,
      "a named-but-absent denylist must refuse — assuming 'not revoked' here is what let a revoked key "
      + "keep answering 200 on every default install");
    // AND WITH NO LIST CONFIGURED AT ALL, nothing is refused: the two absences are different.
    delete process.env.TRADEMARK_MCP_TOKEN_DENYLIST;
    assert.equal(verifyToken(dead).sub, "compromised", "an unset denylist is single-tenant trust, unchanged");
    // The jti is read while NO denylist is configured — reading it under a configured-but-absent one
    // would now refuse, which is the very behaviour being set up here.
    const deadJti = verifyToken(dead).jti;
    process.env.TRADEMARK_MCP_TOKEN_DENYLIST = listPath;
    writeFileSync(listPath, `# emergency kills\n${deadJti}\n`);
    assert.throws(() => verifyToken(dead), /revoked/);
    assert.throws(() => resolveScope({ innerToken: dead }), /revoked/, "the session gate refuses it too");
    assert.equal(verifyToken(alive).sub, "healthy", "only the listed jti dies");
  } finally {
    delete process.env.TRADEMARK_MCP_TOKEN_DENYLIST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rotation: previous-secret tokens verify during the window; minting always uses the current secret", () => {
  const OLD = `old-${randomUUID()}`, NEW = `new-${randomUUID()}`;
  const saved = process.env.TRADEMARK_MCP_TOKEN_SECRET;
  try {
    process.env.TRADEMARK_MCP_TOKEN_SECRET = OLD;
    const oldTok = mintToken({ scope: "ops", sub: "connector-intake" });
    // rotate: NEW current, OLD in the window
    process.env.TRADEMARK_MCP_TOKEN_SECRET = NEW;
    process.env.TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS = OLD;
    assert.equal(verifyToken(oldTok).sub, "connector-intake", "old-secret token survives the rotation window");
    const newTok = mintToken({ scope: "ops", sub: "connector-intake" });
    // window closes: only NEW
    delete process.env.TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS;
    assert.throws(() => verifyToken(oldTok), /bad token signature/, "window closed → old tokens die");
    assert.equal(verifyToken(newTok).sub, "connector-intake", "new mints were signed with the CURRENT secret");
  } finally {
    process.env.TRADEMARK_MCP_TOKEN_SECRET = saved;
    delete process.env.TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS;
  }
});
