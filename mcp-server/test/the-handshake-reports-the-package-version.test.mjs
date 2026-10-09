// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The MCP handshake names the version the package is, the same answer `server_info` gives.
//
// It used to say 0.1.0 on every release, while `server_info` read the package. A listing that shows the
// handshake's version beside the package's then disagrees with itself, and a client debugging against
// one release cannot tell from the handshake which release it reached.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
pinEnv(process.env, "CLEAROTRON_WORK_DIR", mkdtempSync(join(tmpdir(), "handshake-ws-")));
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "handshake-test-secret";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { makeServer } = await import("../server.mjs");
const { productIdentity } = await import("../../shared/product-identity.mjs");

test("the handshake reports the package's own version, the one server_info reports", async () => {
  const want = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  assert.match(want, /^\d+\.\d+\.\d+/, "the root manifest names no version to compare with");
  const server = makeServer({ scope: { kind: "ops", verbs: null, accounts: "*" }, local: false });
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await server.connect(toServer);
  const client = new Client({ name: "handshake-test", version: "1" });
  await client.connect(toClient);
  try {
    assert.equal(client.getServerVersion()?.version, want, "the handshake names a version the package is not");
    assert.equal(client.getServerVersion()?.version, productIdentity().version,
      "the handshake and server_info give two different versions for one server");
  } finally {
    await client.close();
  }
});
