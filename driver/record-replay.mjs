// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// record-replay.mjs — an offline resume answers a record fetch from the run's own saved records, and sends nothing
// to the register.
//
// A resume from a later stage still checks every registration its findings cite, and a citation the run's record set
// lacks is fetched from the register by the driver (the record closure, the screen gate's repair, the senior-right
// check). On saved data that cannot happen: the register's key is absent, a run refuses to start without it, and a
// stand-in key would send real register requests. With `--records replay` the resume answers each such fetch from the
// records the run already holds under `_records/`, and refuses a record it does not hold, by name. A refused citation
// ships unverified with that cause, as a failed fetch does.
//
// THE REGISTER'S KEY MUST BE ABSENT. The driver's fetches are not the only way to the register: a stage's own register
// tools read the same key. So the resume refuses to start while any of the register's credentials is set, and with
// none set every tool the run holds refuses before it sends anything.
//
// A pure leaf: registry-fidelity.mjs only.
import { normalizeRecordUri, readRecordArtifacts } from "./registry-fidelity.mjs";

/** How a resume's record fetches are answered: from the register, or from the run's own saved records. */
export const RECORDS_MODES = ["live", "replay"];

export const RECORD_REPLAY_REFUSAL = "offline resume (--records replay): this run holds no saved record of this registration, and nothing was sent to the register";

/**
 * Answer one record fetch from the records the run at `runDir` holds: `{ ok: true, saved: true }` when the run already
 * holds the record, so the caller's next assembly finds it; otherwise the named refusal. Nothing is fetched either way.
 * IMPURE (reads `_records/`).
 */
export async function savedRecordFetch(runDir, uri) {
  const key = normalizeRecordUri(uri);
  if (runDir && key && readRecordArtifacts(runDir).has(key)) return { ok: true, saved: true };
  return { ok: false, cause: RECORD_REPLAY_REFUSAL };
}

/** The register credentials `provider` reads that are set in `env`: under `--records replay`, any one is a refusal. PURE. */
export const heldRegisterCredentials = (provider, env = process.env) =>
  [provider?.credEnv, ...(Array.isArray(provider?.credEnvAlso) ? provider.credEnvAlso : [])]
    .filter((k) => k && String(env[k] ?? "").trim());
