// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 161 — the portal's trigger key ran down to expiry with nothing counting it.
//
// TWO HALVES, AND ONLY ONE OF THEM IS THE FIX. A `--background` install stores the key in `~/.env`, the
// file the units load, minted with a thirty-day life. The merge that writes it was add-only, so every
// later start left the first one in place; thirty days after an install, on a server nobody had
// touched, every Start stopped, and the portal reported the refusal as an upstream fault — which reads
// like a broken engine rather than an expired key card.
//
// So: the launcher re-mints it, and `doctor` counts it down. The second half matters on its own,
// because the first only helps an operator who restarts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { homeEnvUpdate, LAUNCHER_MINTED } from "../../bin/start.mjs";
import { opsTokenPosture } from "../portal-service.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

/**
 * A trigger key that expires `days` from now, built the way the posture reader sees one.
 *
 * The signature is not verified by the reader under test — it decodes an unverified payload on purpose
 * — so this needs no secret and the arm stays hermetic.
 */
function keyExpiringIn(days) {
  const exp = Math.floor(Date.now() / 1000) + Math.round(days * 86_400);
  const payload = Buffer.from(JSON.stringify({ scope: "ops", sub: "portal", verbs: ["start_run", "stop_run"], accounts: ["demo-brand-owner"], exp }), "utf8").toString("base64url");
  return `v1.${payload}.not-a-real-signature`;
}

function doctorWithHomeEnv(body) {
  const home = mkdtempSync(join(tmpdir(), "trigger-key-home-"));
  try {
    if (body !== null) writeFileSync(join(home, ".env"), body, { mode: 0o600 });
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"],
      { cwd: ROOT, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home } });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("161 a start re-mints the stored trigger key, and leaves everything a person typed alone", () => {
  const before = "# their own file\nPERPLEXITY_API_KEY=typed-by-the-operator\nPORTAL_OPS_TOKEN=v1.first.start\nPORTAL_SECRET=also-theirs\n";
  // Driven through the launcher's OWN function, not through the merge with a hand-supplied policy: an
  // arm that passes `refresh` itself proves the merge works and says nothing about what the launcher
  // asks for, and the call site can then be reverted with every arm still green.
  const r = homeEnvUpdate(before, {
    PORTAL_OPS_TOKEN: "v1.second.start",
    PERPLEXITY_API_KEY: "the-launcher-should-not-write-this",
    PORTAL_MCP_URL: "http://127.0.0.1:18790/mcp",
  });
  assert.deepEqual([...LAUNCHER_MINTED], ["PORTAL_OPS_TOKEN"],
    "the launcher's minted-value list is not the one this arm is about");

  assert.deepEqual(r.refreshed, ["PORTAL_OPS_TOKEN"], "the key the launcher mints was not re-minted");
  assert.match(r.text, /^PORTAL_OPS_TOKEN=v1\.second\.start$/m, "the stored key is still the first start's");
  assert.equal((r.text.match(/^PORTAL_OPS_TOKEN=/gm) ?? []).length, 1,
    "the file now assigns the key twice — which of them wins depends on who is reading");
  // THE ADD-ONLY RULE STILL HOLDS FOR EVERYTHING ELSE, and that is what makes this safe: a launcher
  // that rewrote collected values would be a launcher that can lose an operator's credentials.
  assert.match(r.text, /^PERPLEXITY_API_KEY=typed-by-the-operator$/m, "a value the operator typed was overwritten");
  assert.match(r.text, /^PORTAL_SECRET=also-theirs$/m, "a value the operator typed was overwritten");
  assert.deepEqual(r.added, ["PORTAL_MCP_URL"], "a genuinely new name was not added");
  assert.match(r.text, /# their own file/, "the file lost a comment it had");
});

test("161 the posture the counter reads is the one the key carries", () => {
  const fresh = opsTokenPosture(keyExpiringIn(30));
  assert.equal(fresh.readable, true);
  assert.equal(fresh.expired, false);
  assert.ok(fresh.daysLeft >= 29 && fresh.daysLeft <= 30, `daysLeft read as ${fresh.daysLeft}`);
  const gone = opsTokenPosture(keyExpiringIn(-1));
  assert.equal(gone.expired, true, "a lapsed key did not read as expired");
});

test("161 doctor names the trigger key's remaining life", { timeout: 120_000 }, () => {
  const { status, out } = doctorWithHomeEnv(`PORTAL_OPS_TOKEN=${keyExpiringIn(25)}\n`);
  assert.match(out, /Portal trigger key/, "doctor printed no trigger-key section at all");
  assert.match(out, /good for 2[0-9] more day\(s\)/, "doctor did not say how long the key has");
  assert.notEqual(status, null, "doctor did not run");
});

test("161 doctor refuses on a key that has lapsed, and on one about to", () => {
  const lapsed = doctorWithHomeEnv(`PORTAL_OPS_TOKEN=${keyExpiringIn(-1)}\n`);
  assert.match(lapsed.out, /expired/, "doctor said nothing about a key that has already lapsed");
  assert.equal(lapsed.status, 1, "doctor exited 0 over an expired trigger key — every Start is refused");

  // Three days out reads as two: a whole day has to have passed for the counter to move, and it counts
  // whole days remaining rather than rounding up. Matching the exact number here would be an arm about
  // the clock rather than the deadline.
  const soon = doctorWithHomeEnv(`PORTAL_OPS_TOKEN=${keyExpiringIn(3)}\n`);
  assert.match(soon.out, /expires in [0-9]+ day\(s\), on \d{4}-\d{2}-\d{2}/, "doctor did not name the deadline it is about to hit");
  assert.equal(soon.status, 1, "a key days from expiry read as nothing to act on");
});

test("161 a malformed key is a refusal, and a foreground install is not", () => {
  const bad = doctorWithHomeEnv("PORTAL_OPS_TOKEN=an-opaque-32-byte-value\n");
  assert.match(bad.out, /cannot be read as one/, "a key of the wrong KIND read as a key");
  assert.equal(bad.status, 1, "doctor exited 0 over a key the portal will refuse every Start with");

  // No stored key is the ordinary foreground install, and must not be reported as a problem — but it
  // must not be silence either, which is what the reader used to get in every one of these cases.
  const none = doctorWithHomeEnv("PERPLEXITY_API_KEY=x\n");
  assert.match(none.out, /Portal trigger key/);
  assert.match(none.out, /runs in the foreground/, "an install with no stored key was not told which case it is in");
});
