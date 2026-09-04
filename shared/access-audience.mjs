// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// access-audience.mjs — which Access application audiences a deployment accepts, and the client/staff line.
//
// — F54. Two rules, in one file, because THEY UNDO INDEPENDENTLY AND EACH IS A
// FAIL-OPEN WHEN UNDONE. Splitting them across modules is how one gets "simplified" by a reader who has
// only met the other.
//
// ── WHY NOT IN mcp-server/lib/cf-access.mjs, BESIDE THE VERIFIER THAT USES THEM ──────────────────────
//
// That module statically imports `jose`, and three of the five callers here deliberately do not: the
// portal, profile and recipe services import it LAZILY, inside the branch that actually needs a
// verifier, so a laptop install never loads a JWT library it will never call. `portal-service.mjs`
// states that reasoning at its own LocalAuthError and declines the import for the same reason. Parsing
// an environment variable needs no crypto, so it does not get to drag one in.
/**
 * The audience or audiences this deployment accepts, from one environment value.
 *
 * — F54. A deployment runs one Access application PER AUDIENCE — the portal,
 * the staff door, the client door — and the verification path has always supported that: jose's
 * `audience` takes a string OR an array and passes on any match. What limited a deployment to one was
 * every caller reading the variable as a single string. Measured against the install's own jose with
 * three real application audiences: all three accepted, an unrelated one refused; and under the
 * single-audience configuration a valid token from any application but one was refused.
 *
 * ── WHY THIS RETURNS A STRING FOR 0 AND 1, AND ONLY AN ARRAY FOR 2 OR MORE ────────────────────────
 *
 * AN EMPTY ARRAY IS TRUTHY. Every caller guards with `!AUD` and refuses to start when it is falsy, and
 * `makeAccessVerifier` below refuses to build for the same reason. Returning `[]` for an unset variable
 * would satisfy all of them — turning three fail-CLOSED checks fail-OPEN at once, which is the class
 * this codebase writes its guards against. So the empty case must stay a falsy string, and the
 * one-value case stays a string because there is no reason for it to become a container.
 *
 * `list[0]` rather than the raw value for the single case: identical for every caller here, because
 * `envFrom` already trims and returns undefined for empty, and correct rather than accidental for a
 * caller that does not.
 */
export function accessAudience(raw) {
  const list = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 1 ? list : (list[0] ?? "");
}

/**
 * Is `candidate` one of the audiences `staff` accepts? — F54.
 *
 * The client door asserts its audience DIFFERS from the staff one, and did so with `===`. That stops
 * expressing the boundary the moment staff is a list: with staff "portal,ops" and a client audience of
 * "ops", `!==` is true and the door starts — sharing an audience the staff surface accepts, which is
 * the client/staff collapse that assertion exists to refuse. Membership is the question, not equality.
 */
export function audienceIncludes(staff, candidate) {
  if (!candidate) return false;
  const list = Array.isArray(staff) ? staff : (staff ? [staff] : []);
  return list.includes(candidate);
}

/**
 * The audience(s) as a BOOT LOG should print them — truncated, one per application.
 *
 * — F54, and this exists because of a defect this change introduced. Every
 * caller logged `aud=${AUD.slice(0, 8)}…`, which is correct for a string and silently wrong for a list:
 * `Array.prototype.slice` takes ELEMENTS, so a two-audience deployment printed both values IN FULL and
 * appended a single ellipsis that was no longer true. The line intends a recognisable fragment; with a
 * list it produced the opposite of a fragment.
 *
 * Truncating each entry keeps what the line was for — an operator matching the log against the Access
 * application they configured — for both shapes.
 */
export function audienceLabel(aud) {
  const list = Array.isArray(aud) ? aud : (aud ? [aud] : []);
  if (!list.length) return "(none)";
  return list.map((a) => `${String(a).slice(0, 8)}…`).join(",");
}
