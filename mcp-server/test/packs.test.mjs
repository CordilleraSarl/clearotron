// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Connector-pack integrity: the packs are versioned product artifacts — a manifest that names a
// missing file or a tool the server doesn't expose ships a broken integration guide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_SCOPES } from "../lib/scope.mjs";

const PACKS = join(dirname(fileURLToPath(import.meta.url)), "..", "packs");
const load = (pack) => JSON.parse(readFileSync(join(PACKS, pack, "manifest.json"), "utf8"));

// The ACCOUNT pack shipped uncovered: this loop named two packs while instructions.mjs served three, so
// its manifest could reference a tool the server does not expose and nothing would say so.
const AUDIENCE = { client: "client", ops: "integrator", account: "account" };

for (const pack of ["client", "ops", "account"]) {
  test(`${pack} pack: manifest parses, files exist, version is semver`, () => {
    const m = load(pack);
    assert.match(m.version, /^\d+\.\d+\.\d+$/);
    assert.equal(m.audience, AUDIENCE[pack]);
    for (const f of m.files) assert.ok(existsSync(join(PACKS, pack, f)), `${pack}/${f} named in manifest but missing`);
  });

  test(`${pack} pack: every manifest tool is a real server tool`, () => {
    for (const t of load(pack).tools)
      assert.ok(t in TOOL_SCOPES, `${pack} pack references unknown tool "${t}" — TOOL_SCOPES doesn't know it`);
  });
}

test("client pack stays inside the client (user-token) layer — clientSafe tools only", () => {
  for (const t of load("client").tools)
    assert.ok(TOOL_SCOPES[t]?.clientSafe, `"${t}" is not clientSafe — a run-bound user token cannot call it`);
});

// The same rule one layer out. A pack that names a tool the session cannot call teaches the assistant to
// reach for something it will be refused — and the account pack now leads with describe_options, which
// is exactly the kind of thing that gets added to a manifest and forgotten in the registry.
test("account pack stays inside the account layer — accountSafe tools only, describe_options first", () => {
  const tools = load("account").tools;
  for (const t of tools)
    assert.ok(TOOL_SCOPES[t]?.accountSafe, `"${t}" is not accountSafe — a client account session cannot call it`);
  assert.equal(tools[0], "describe_options", "the pack teaches option discovery first; the manifest should read the same way");
});

test("ops pack: its write verbs match the recommended mint (intake + courier, no stop_run in the default recipe)", () => {
  const writes = load("ops").tools.filter((t) => TOOL_SCOPES[t]?.write);
  assert.deepEqual(writes.sort(), ["ack_event", "feed_context", "mark_sent", "start_run", "stop_run"].sort());
  const connect = readFileSync(join(PACKS, "ops", "CONNECT.md"), "utf8");
  assert.match(connect, /--verbs start_run,feed_context,mark_sent,ack_event/, "the least-privilege mint recipe drifted");
});
