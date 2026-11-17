// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stamps.mjs — what the `engine` word on a saved attempt row means.
//
// It imports nothing, so the rollup readers can ask it without joining an import loop or loading an adapter.
// The word on a row is wider than the registered engines: this table is about rows already on disk.
//
// A CLOSED TABLE, NOT A PREFIX RULE. `anthropic-*` → anthropic is shorter and would silently adopt any
// future engine whose name began that way, which is how a vendor claim becomes a guess. An engine this
// table does not know is reported BY NAME and blocks the single-vendor claim, because "I do not know who
// billed this" and "one vendor" are different answers and only one of them is safe to print.
//
// THE NATIVE-LANGUAGE ROWS STAMP THE VENDOR ITSELF. jxBillingStamp (jx-lanes.mjs) writes as the row's
// engine the provider the engine door resolved, `anthropic` or `openai` (engine/auth.mjs), so those two
// names are engines this table must place. Without them an Anthropic-only run with a native-language turn
// named `anthropic` as an engine that bills to no vendor, in the same sentence that named anthropic as its
// one vendor. Two exact names, still a closed table.
//
// `catalog` says how to key a row with no `modelUsed`: "tier" reads its `model` through Claude's catalog
// (`resolveModel`), "served" keys it as the id it carries, and a stamp without the field has no honest key.
// `nativeLanguage` marks a row whose `model` is the id that served the turn and not the tier it asked for.
const ENGINE_STAMPS = Object.freeze({
  "anthropic-agent": { vendor: "anthropic", catalog: "tier" },
  "anthropic-direct": { vendor: "anthropic" },
  "anthropic-completions": { vendor: "anthropic" },
  "openai-agent": { vendor: "openai" },
  "anthropic": { vendor: "anthropic", catalog: "tier", nativeLanguage: true },
  "openai": { vendor: "openai", catalog: "served", nativeLanguage: true },
});

/** What this table says about a stamp, or an empty record when it does not name it. */
export const engineStamp = (engine) => (Object.hasOwn(ENGINE_STAMPS, String(engine ?? "")) ? ENGINE_STAMPS[String(engine)] : {});

/** The vendor an engine bills to, or null when the table does not name one. */
export const vendorOf = (engine) => engineStamp(engine).vendor ?? null;
