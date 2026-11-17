// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-confirmation.mjs — the token that confirms an order: an HMAC over the exact job a person confirmed and who
// confirmed it, short-lived and spent once. Moved out of portal-service.mjs unchanged; the service exports it as before.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ── the confirmation token (the what_if_plan → what_if_run idiom): HMAC over the EXACT server-
// stamped job the user confirmed (classes/goods/marks/markName/selector — review 2026-07-18: a
// names-only binding let a mutated resubmit spend) + the confirming identity, short TTL, ONE-SHOT
// (jti consumed on fire — a replay within the TTL never spends twice). ─────────────────────────────
const canonical = (o) => JSON.stringify(o, Object.keys(o).sort());
// The trigger-identity hash: every field of the server-stamped job that shapes scope/cost/identity.
// Sorted-array JSON (never a delimiter join — a '|' in a mark name aliased two mark sets to one key).
export function jobHashOf(job) {
  const marks = (job.marks ?? (job.markName ? [{ name: job.markName }] : []))
    .map((m) => ({ name: String(m?.name ?? m).trim().toLowerCase(), classes: Array.isArray(m?.classes) ? [...m.classes].sort() : undefined, ref: m?.ref }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHmac("sha256", "job-id").update(canonical({
    marks: JSON.stringify(marks), markName: String(job.markName ?? "").toLowerCase(),
    classes: JSON.stringify([...(job.classes ?? [])].sort()), goods: String(job.goods ?? ""),
    product: job.product ?? null, recipeKey: job.recipeKey ?? null,
  })).digest("base64url");
}
export function mintConfirmation({ secret, account, email, jobHash, now = Date.now(), ttlMs = 10 * 60 * 1000 }) {
  const jti = createHmac("sha256", secret).update(`${account}|${jobHash}|${now}|${randomBytes(16).toString("hex")}`).digest("base64url").slice(0, 24);
  const payload = { account, email, jobHash, jti, exp: now + ttlMs };
  const body = Buffer.from(canonical(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyConfirmation({ secret, token, account, email, jobHash, now = Date.now(), usedJtis = null }) {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return "confirmation token malformed — re-run the plan step";
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "confirmation token invalid — re-run the plan step";
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return "confirmation token unreadable — re-run the plan step"; }
  if (!(typeof p.exp === "number" && p.exp >= now)) return "confirmation expired — review the plan again and re-confirm";
  if (p.account !== account || p.jobHash !== jobHash)
    return "the request changed after confirmation — review the plan again and re-confirm";
  if (p.email !== email) return "this confirmation belongs to a different sign-in — review the plan and confirm yourself";
  if (usedJtis) {
    if (usedJtis.has(p.jti)) return "this confirmation was already used — plan again for another run";
    usedJtis.set(p.jti, p.exp);   // consume (one-shot); the caller sweeps expired entries
  }
  return null;
}
