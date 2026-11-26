// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// registers.mjs — every register provider, named once.
//
// Each register's adapter, tool grant and capability contract live in its own folder (`<id>/src/`). This is the one
// list of which registers exist: the driver's adapter map (`PROVIDERS`, driver/driver.config.mjs), the list an
// operator is shown when none is set (`KNOWN_REGISTER_PROVIDERS`, same file), the register server's grants
// (`REGISTER_SERVERS`, driver/engine/mcp/gather-config.mjs) and the planner's capabilities (`PROVIDER_CAPABILITIES`,
// driver/register-capabilities.mjs) are each built from it. Adding a register is one row here.
//
// TWO ORDERS, BOTH KEPT. The rows are in the order the four tables have always listed their keys, which every message
// that names the known registers prints (`Known: …`). `ladder` is ADR-0001's order, the recommended register first and
// then the free tier, which is what the refusal for an unset register prints, so a reader is shown the order setup
// offers.
//
// NOT A VOCABULARY THE MODEL IS HANDED. A stage is never told a provider's name; this module is read by the driver,
// the register server and the planner, and never by a module that judges a stage's output (driver/record-origins.mjs).
import { adapter as corsearchAdapter } from "./corsearch/src/adapter.js";
import { adapter as clarivateAdapter } from "./clarivate/src/adapter.js";
import { adapter as signaAdapter } from "./signa/src/adapter.js";
import { adapter as euipoAdapter } from "./euipo/src/adapter.js";
import { adapter as usptoLocalAdapter } from "./uspto-local/src/adapter.js";
import { adapter as freeTierAdapter } from "./free-tier/src/adapter.js";
import { CAPABILITIES as CORSEARCH_CAPABILITIES } from "./corsearch/src/capabilities.js";
import { CAPABILITIES as CLARIVATE_CAPABILITIES } from "./clarivate/src/capabilities.js";
import { CAPABILITIES as SIGNA_CAPABILITIES } from "./signa/src/capabilities.js";
import { CAPABILITIES as EUIPO_CAPABILITIES } from "./euipo/src/capabilities.js";
import { CAPABILITIES as USPTO_LOCAL_CAPABILITIES } from "./uspto-local/src/capabilities.js";
// The only capability contract DERIVED rather than declared: pointwise-weakest across euipo and uspto-local.
import { CAPABILITIES as FREE_TIER_CAPABILITIES } from "./free-tier/src/capabilities.js";
import { REGISTER_GRANT as CORSEARCH_GRANT } from "./corsearch/src/register-grant.mjs";
import { REGISTER_GRANT as CLARIVATE_GRANT } from "./clarivate/src/register-grant.mjs";
import { REGISTER_GRANT as SIGNA_GRANT } from "./signa/src/register-grant.mjs";
import { REGISTER_GRANT as EUIPO_GRANT } from "./euipo/src/register-grant.mjs";
import { REGISTER_GRANT as USPTO_LOCAL_GRANT } from "./uspto-local/src/register-grant.mjs";
import { REGISTER_GRANT as FREE_TIER_GRANT } from "./free-tier/src/register-grant.mjs";

/** Every register: its id, its place on ADR-0001's ladder, and what its folder declares. */
export const REGISTERS = Object.freeze([
  Object.freeze({ id: "corsearch", ladder: 5, adapter: corsearchAdapter, grant: CORSEARCH_GRANT, capabilities: CORSEARCH_CAPABILITIES }),
  Object.freeze({ id: "clarivate", ladder: 6, adapter: clarivateAdapter, grant: CLARIVATE_GRANT, capabilities: CLARIVATE_CAPABILITIES }),
  Object.freeze({ id: "signa", ladder: 1, adapter: signaAdapter, grant: SIGNA_GRANT, capabilities: SIGNA_CAPABILITIES }),
  Object.freeze({ id: "euipo", ladder: 3, adapter: euipoAdapter, grant: EUIPO_GRANT, capabilities: EUIPO_CAPABILITIES }),
  Object.freeze({ id: "uspto-local", ladder: 4, adapter: usptoLocalAdapter, grant: USPTO_LOCAL_GRANT, capabilities: USPTO_LOCAL_CAPABILITIES }),
  // A TIER, not a seventh source: euipo and uspto-local composed into one register, so an EU+US clearance needs no paid vendor.
  Object.freeze({ id: "free-tier", ladder: 2, adapter: freeTierAdapter, grant: FREE_TIER_GRANT, capabilities: FREE_TIER_CAPABILITIES }),
]);

/** `{ id: row[field] }` for every register, in the rows' order: a new object each call, for its caller to freeze or not. PURE. */
export const byRegister = (field) => Object.fromEntries(REGISTERS.map((r) => [r.id, r[field]]));

/** The register ids on ADR-0001's ladder, recommended first: a new array each call. PURE. */
export const registerLadder = () => [...REGISTERS].sort((a, b) => a.ladder - b.ladder).map((r) => r.id);
