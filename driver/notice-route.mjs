// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// notice-route.mjs — the route a notice leaves this install by, when the install configures one, and the one send.
//
// WHY THERE IS A ROUTE AT ALL. The product writes its notices to the outbox for an outside courier
// (docs/DELIVERY.md), and an install with no courier, or a courier that cannot see a notice, told nobody: an order
// refused before it ran, or a run that stopped, reached neither the person who placed it nor the operator. An install
// may now name a route of its own, and notice-delivery.mjs sends through it. Nothing changes until one is named.
//
// WHY ONLY A RECEIVER ON THIS MACHINE. The route posts each notice as JSON to a receiver whose address is loopback:
// a bridge the install runs beside the product, which knows how to reach people. Any other address is refused, and
// doctor says so, until a channel that leaves the machine is chosen; that choice, and the words a recipient reads,
// are the owner's.
//
// THE RECEIVER'S CONTRACT. One POST per notice, `Content-Type: application/json`, carrying the notice's delivery id
// in the body and in `Idempotency-Key`. A 2xx answer takes the notice: the receiver accepted it, and it is not handed
// over again. It does not say the recipient was told (design, 2026-11-26). Where the receiver has sent the notice on
// to its recipient, its 2xx body says so, `{"sent":{"messageId":"<that message's id>"}}`: a downstream send receipt,
// which is what settles a stopped run's owed send. Any other answer, or no connection, leaves the notice to be sent
// again; the search is never repeated. A request that went out and got no answer is neither: the
// receiver may hold it. A receiver that drops a repeated delivery id says so through CLEAROTRON_NOTICE_DEDUPE=1,
// and only then is such a notice sent again.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { envFrom } from "../shared/env-aliases.mjs";

/** Who a notice is for: the person who placed the order (or forwarded it), and the install's operator. */
export const NOTICE_AUDIENCES = Object.freeze(["submitter", "operator"]);

const isLoopbackHost = (host) => host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);

/**
 * The route this install configures, read from `env`. PURE.
 *
 *   { configured: false }                                   no route: the install behaves exactly as before
 *   { configured: true, ok: false, problem, ... }           named but unusable: nothing is sent, and doctor says why
 *   { configured: true, ok: true, url, audiences, dedupe }  the audiences it serves; every other stays with a courier
 *
 * `problem` is one of `url-unreadable`, `url-not-http`, `url-not-loopback`, `no-audience`, `audience-unknown`.
 */
export function noticeRoute(env = process.env) {
  const raw = envFrom(env, "CLEAROTRON_NOTICE_URL");
  if (!raw) return { configured: false };
  let url;
  try { url = new URL(raw); } catch { return { configured: true, ok: false, problem: "url-unreadable" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { configured: true, ok: false, problem: "url-not-http" };
  if (!isLoopbackHost(url.hostname)) return { configured: true, ok: false, problem: "url-not-loopback" };
  const listed = String(envFrom(env, "CLEAROTRON_NOTICE_AUDIENCES") ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!listed.length) return { configured: true, ok: false, problem: "no-audience" };
  const unknown = listed.filter((a) => !NOTICE_AUDIENCES.includes(a));
  if (unknown.length) return { configured: true, ok: false, problem: "audience-unknown", unknown };
  return {
    configured: true, ok: true, url: url.href,
    audiences: NOTICE_AUDIENCES.filter((a) => listed.includes(a)),
    dedupe: envFrom(env, "CLEAROTRON_NOTICE_DEDUPE") === "1",
  };
}

/**
 * Send one notice to the receiver. Never throws. Resolves one of:
 *   { outcome: "confirmed", status, sent }    the receiver answered 2xx: it holds the notice. `sent` is its downstream
 *                                             send receipt, `{ messageId }`, where its body carried one, else null
 *   { outcome: "failed", status?, detail }    not reached, or the receiver answered that it did not take it
 *   { outcome: "ambiguous", detail }          the request went out and no answer came back: it may hold it
 */
export function postNotice(url, body, { deliveryId, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let sent = false, done = false, answered = null;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let data;
    try { data = Buffer.from(JSON.stringify(body)); } catch (e) { finish({ outcome: "failed", detail: `unserialisable: ${e?.message ?? e}` }); return; }
    let req;
    try {
      req = (url.startsWith("https:") ? httpsRequest : httpRequest)(url, {
        method: "POST", timeout: timeoutMs,
        headers: { "content-type": "application/json", "content-length": data.length, "idempotency-key": String(deliveryId ?? "") },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) { res.resume(); finish({ outcome: "failed", status, detail: `the receiver answered ${status}` }); return; }
        // Accepted. The body is read only for a downstream send receipt; a body that is cut off or is not one leaves
        // the notice accepted, with no receipt.
        answered = status;
        const chunks = [];
        let size = 0;
        res.on("data", (c) => { size += c.length; if (size <= 65_536) chunks.push(c); });
        res.on("end", () => finish({ outcome: "confirmed", status, sent: sendReceiptIn(Buffer.concat(chunks).toString("utf8")) }));
        res.on("error", () => finish({ outcome: "confirmed", status, sent: null }));
        res.on("aborted", () => finish({ outcome: "confirmed", status, sent: null }));
      });
    } catch (e) { finish({ outcome: "failed", detail: e?.code ?? String(e?.message ?? e) }); return; }
    req.on("timeout", () => req.destroy(Object.assign(new Error("no answer in time"), { code: "ETIMEDOUT" })));
    req.on("error", (e) => finish(answered != null ? { outcome: "confirmed", status: answered, sent: null }
      : { outcome: sent ? "ambiguous" : "failed", detail: e?.code ?? String(e?.message ?? e) }));
    req.end(data, () => { sent = true; });
  });
}

/** The downstream send receipt a receiver's 2xx body carries, `{ messageId }`, or null. PURE. */
export function sendReceiptIn(text) {
  try {
    const id = JSON.parse(text)?.sent?.messageId;
    return typeof id === "string" && id.trim() ? { messageId: id.trim().slice(0, 500) } : null;
  } catch { return null; }
}
