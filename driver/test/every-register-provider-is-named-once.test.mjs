// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY REGISTER PROVIDER IS NAMED ONCE (providers/registers.mjs), and the four tables built from that list hold what
// each provider's folder declares, in the orders their readers print.
//
// The adapter map, the register server's grants and the planner's capabilities keep the key order every "Known: …"
// message prints. The list an operator is shown when no register is set keeps ADR-0001's ladder, the order setup
// offers. Each entry is the very object its provider's folder exports, so nothing is copied, and every provider folder
// that ships an adapter is in the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REGISTERS, byRegister, registerLadder } from "../../providers/registers.mjs";
import { KNOWN_REGISTER_PROVIDERS, PROVIDERS } from "../driver.config.mjs";
import { REGISTER_SERVERS } from "../engine/mcp/gather-config.mjs";
import { PROVIDER_CAPABILITIES, capabilitiesFor } from "../register-capabilities.mjs";

const PROVIDERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "providers");
const TABLE_ORDER = ["corsearch", "clarivate", "signa", "euipo", "uspto-local", "free-tier"];
const LADDER = ["signa", "free-tier", "euipo", "uspto-local", "corsearch", "clarivate"];

test("each table lists the registers in the order its readers print", () => {
  assert.deepEqual(REGISTERS.map((r) => r.id), TABLE_ORDER);
  for (const [name, table] of [["PROVIDERS", PROVIDERS], ["REGISTER_SERVERS", REGISTER_SERVERS], ["PROVIDER_CAPABILITIES", PROVIDER_CAPABILITIES]])
    assert.deepEqual(Object.keys(table), TABLE_ORDER, name);
  assert.deepEqual(KNOWN_REGISTER_PROVIDERS, LADDER, "the refusal for an unset register lists ADR-0001's ladder");
  assert.deepEqual(registerLadder(), LADDER);
  assert.ok(Object.isFrozen(PROVIDER_CAPABILITIES), "the capability map stays frozen");
  assert.throws(() => capabilitiesFor("invented-register"),
    new RegExp(`Known: ${TABLE_ORDER.join(", ")}\\. A provider with no declared capability`));
});

test("each entry is the object its provider's folder exports, never a copy", async () => {
  for (const id of TABLE_ORDER) {
    const at = (file) => pathToFileURL(join(PROVIDERS_DIR, id, "src", file)).href;
    const [{ adapter }, { REGISTER_GRANT }, { CAPABILITIES }] = await Promise.all(
      [at("adapter.js"), at("register-grant.mjs"), at("capabilities.js")].map((u) => import(u)));
    assert.equal(PROVIDERS[id], adapter, `${id}: adapter`);
    assert.equal(REGISTER_SERVERS[id], REGISTER_GRANT, `${id}: grant`);
    assert.equal(PROVIDER_CAPABILITIES[id], CAPABILITIES, `${id}: capabilities`);
  }
});

test("every provider folder that ships an adapter is in the list, and the list names each once", () => {
  const shipped = readdirSync(PROVIDERS_DIR).filter((d) => existsSync(join(PROVIDERS_DIR, d, "src", "adapter.js"))).sort();
  assert.deepEqual([...REGISTERS.map((r) => r.id)].sort(), shipped);
  assert.equal(new Set(REGISTERS.map((r) => r.id)).size, REGISTERS.length);
  assert.equal(new Set(REGISTERS.map((r) => r.ladder)).size, REGISTERS.length, "two registers share a place on the ladder");
  assert.notEqual(byRegister("adapter"), byRegister("adapter"), "each table is its own object");
});
