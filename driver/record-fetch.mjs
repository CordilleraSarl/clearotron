// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-fetch.mjs — one full record, fetched from the register a run used, never the deployment's.
//
// A record id is the id one register gave it. The frozen plan names the register the run listed its records
// from, and the deployment may have moved to another since; opened at another register, the same id is
// another record or none. A run whose register this build does not know, or which fetches no record, has
// its fetch refused by name, never sent to the active register in its place. The fetch is the provider's
// own `recordFetch`, the call the record closure makes, and it writes the body to the run's record log,
// where the pile reads full records from. Each fetch is a billed call. Two callers: a judge opening a
// record (owner-server.mjs), and the judged step fetching its opening records first (owner-judgment-run.mjs).

import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";

/** A fetch that does not answer in this long is answered as a failure: a hung register reads nothing. */
export const FETCH_MS = 90_000;

/** Fetch one record. Resolves to the provider's `{ ok, cause? }`; never throws. */
export async function fetchRunRecord({ runDir, providerId, id, agentId = "", sessionKey = "", recordLog = null, timeoutMs = FETCH_MS }) {
  if (!providerId) return { ok: false, cause: "this run's plan names no register, so no record is fetched" };
  let provider;
  try {
    const { PROVIDERS } = await import("./driver.config.mjs");
    provider = Object.hasOwn(PROVIDERS, providerId) ? PROVIDERS[providerId] : null;
  } catch (e) { return { ok: false, cause: `the register list could not be read: ${String(e?.message ?? e).slice(0, 120)}` }; }
  if (!provider) return { ok: false, cause: `the register this run used, ${providerId}, is not one this build knows, so no record is fetched` };
  if (typeof provider.recordFetch !== "function") return { ok: false, cause: `the register this run used, ${providerId}, fetches no record` };
  let timer;
  try {
    return await Promise.race([
      provider.recordFetch(id, { agentId, sessionKey, recordLog: recordLog || runRecordLogPath(runDir) }),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, cause: `the register did not answer in ${timeoutMs / 1000}s` }), timeoutMs); }),
    ]);
  } catch (e) { return { ok: false, cause: `the fetch failed: ${String(e?.message ?? e).slice(0, 120)}` }; }
  finally { clearTimeout(timer); }
}
