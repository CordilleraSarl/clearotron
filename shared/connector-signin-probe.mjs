// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// connector-signin-probe.mjs — can a cloud assistant actually register at this door's sign-in?
//
// ── why this exists ─────────────────────────────────────────────────────────────
//
// Two settings at the identity provider decide whether a remote assistant can sign
// in at all, and this product could see neither. The first — the challenge form — is covered:
// `shared/mcp-challenge.mjs` reads it out of an unauthenticated response and `doctor` reports it.
//
// This module is the second, which 149 calls the one with no symptom a reader can interpret. With the
// application's allowed-redirect list empty, dynamic client registration REFUSES every cloud assistant:
//
//     {"error":"invalid_client_metadata","error_description":"redirect_uri is not allowed by the
//      account configuration"}
//
// The localhost and loopback toggles most consoles offer cover only clients on the reader's own
// machine, so the list looks configured and is not. What the reader sees is the connector failing
// AFTER the browser opens — which looks like a different bug entirely, and cost an afternoon on a
// working system.
//
// ── PROVIDER-AGNOSTIC, BECAUSE THE INTERFACE WAS WIDENED ON PURPOSE ─────────────────────────────────
//
// The registration endpoint is READ, never composed. RFC 8414's discovery document
// (`/.well-known/oauth-authorization-server`) carries `registration_endpoint`, and any provider that
// speaks the flow an assistant can follow publishes it. The reference implementation this was built
// from composed Cloudflare's path by hand, which is correct on one provider and silently wrong on
// every other — and 149 asks for the general rule with Cloudflare as the worked example, not a
// Cloudflare remedy.
//
// ── THE CONTROL IS THE WHOLE INSTRUMENT ─────────────────────────────────────────────────────────────
//
// 149 states it as an acceptance criterion: *"A registration refusal means nothing without the
// localhost control passing first; without it, a broken endpoint reads as a policy refusal."* A door
// that is down, rate-limiting, or behind a proxy that eats POSTs refuses everything, and every refusal
// then reads as a setting somebody forgot. So the control runs FIRST and its failure ends the probe —
// `looked: false`, no vendor results, and nothing that reads as a finding.
//
// ── IT WRITES, WHICH IS WHY IT IS NEVER DEFAULT ─────────────────────────────────────────────────────
//
// Every successful registration CREATES AN OAUTH CLIENT on the operator's account. INSTALL.md promises
// `doctor` "reads; writes nothing, calls nobody", and that sentence is load-bearing — it is why a
// reader runs `doctor` on a production box without thinking about it. So this is opt-in at the command
// line, it says what it is about to create before it creates it, and it reports what it left behind.

/**
 * The redirect address each vendor's cloud sends a reader back to after sign-in.
 *
 * A VENDOR FACT WITH A DATE ON IT. These are not ours and they change without telling us; an entry
 * with no date and no source is a value nobody can re-check, and `driver/test/` refuses one. When a
 * probe below reports a vendor as refused, the reader adds THIS address to their application — so a
 * stale entry sends them to add the wrong one, which is worse than not naming it.
 */
export const VENDOR_REDIRECTS = Object.freeze([
  Object.freeze({ vendor: "claude.ai", uri: "https://claude.ai/api/mcp/auth_callback",
    measured: "2026-09-04", source: "registered successfully against a live Access application" }),
  Object.freeze({ vendor: "claude.com", uri: "https://claude.com/api/mcp/auth_callback",
    measured: "2026-09-04", source: "registered successfully against a live Access application" }),
  Object.freeze({ vendor: "chatgpt.com", uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    measured: "2026-09-04", source: "registered successfully against a live Access application" }),
]);

/**
 * The redirect the control registers with.
 *
 * Loopback, because that is the one shape a console's own toggle already allows — so a control failure
 * says the ENDPOINT is not working, and never that this particular address is disallowed. Any port
 * does; the client is thrown away and never used.
 */
export const CONTROL_REDIRECT = "http://localhost:9999/callback";

/** The body a registration request carries. Minimal on purpose — nothing here should need a secret. */
export function registrationBody(redirectUri, { clientName = "clearotron doctor probe" } = {}) {
  return { client_name: clientName, redirect_uris: [redirectUri], grant_types: ["authorization_code"],
    response_types: ["code"], token_endpoint_auth_method: "none" };
}

/**
 * Where this door's sign-in takes registrations, read out of its discovery document.
 *
 * @returns {{endpoint: string|null, looked: boolean, why: string|null}}
 *   `looked: false` means the document could not be read, which is never the same as a provider that
 *   does not accept registrations.
 */
export function registrationEndpointFrom({ status = null, document = null, error = null } = {}) {
  if (error) return { endpoint: null, looked: false, why: `the discovery document could not be read: ${error}` };
  if (status !== 200) {
    return { endpoint: null, looked: false,
      why: `the discovery document answered ${status ?? "nothing"} — with no document there is nothing `
        + "that says where registrations go, and a door that redirects a browser here answers the wrong "
        + "challenge anyway (which is the check one step above this one)" };
  }
  const endpoint = typeof document?.registration_endpoint === "string" ? document.registration_endpoint.trim() : "";
  if (!endpoint) {
    return { endpoint: null, looked: true,
      why: "the discovery document carries no `registration_endpoint`, so this provider does not take "
        + "dynamic registrations — an assistant here needs a client the operator created by hand" };
  }
  return { endpoint, looked: true, why: null };
}

/**
 * What a registration attempt's status code means.
 *
 * 201 IS THE ONLY YES, and 200 is accepted beside it because RFC 7591 names 201 while providers have
 * been seen to answer 200 with the client document. Everything else is reported with its code rather
 * than translated: a 429 is not a policy refusal and telling a reader to edit their redirect list
 * because they were rate-limited is exactly the wrong instruction.
 */
export function registrationAccepted(status) {
  return status === 201 || status === 200;
}

/**
 * The whole probe, over an injected `post` so it is drivable without a network.
 *
 * @param {object} o
 * @param {(url: string, body: object) => Promise<{status: number|null, error?: string|null}>} o.post
 * @param {string} o.endpoint
 * @param {readonly {vendor: string, uri: string}[]} [o.vendors]
 * @returns {Promise<{looked: boolean, why: string|null, control: object|null, vendors: object[]}>}
 */
export async function probeRegistration({ post, endpoint, vendors = VENDOR_REDIRECTS }) {
  // THE CONTROL FIRST, AND ITS FAILURE ENDS THIS. Reporting vendor refusals from an endpoint that
  // refuses everything is the fault 149 names by name.
  const control = await post(endpoint, registrationBody(CONTROL_REDIRECT));
  if (!registrationAccepted(control?.status)) {
    return { looked: false, control,
      why: `the localhost control answered ${control?.status ?? control?.error ?? "nothing"} rather than 201, so `
        + "the registration endpoint itself is not working normally. A refusal for a vendor below would "
        + "not mean what it looks like, so none was asked for.",
      vendors: [] };
  }
  const rows = [];
  for (const v of vendors) {
    const r = await post(endpoint, registrationBody(v.uri));
    rows.push({ vendor: v.vendor, uri: v.uri, status: r?.status ?? null, error: r?.error ?? null,
      accepted: registrationAccepted(r?.status) });
  }
  return { looked: true, why: null, control, vendors: rows };
}

/**
 * The lines a reader acts on. One sentence per vendor, and the remedy names the setting.
 *
 * PROVIDER-AGNOSTIC FIRST, worked example second — 149's own judging criterion, because the product's
 * identity interface is config on purpose and a Cloudflare-only remedy re-narrows it.
 */
export function describeRegistration(result, { host = "this address" } = {}) {
  if (!result.looked) return [{ state: "unknown", text: `${host}: ${result.why}` }];
  const out = [];
  for (const v of result.vendors) {
    if (v.accepted) { out.push({ state: "pass", text: `${v.vendor} can sign in here` }); continue; }
    out.push({ state: "fail",
      text: `${v.vendor} CANNOT sign in here — its registration was refused `
        + `(${v.status ?? v.error ?? "no answer"}), and the only symptom a reader sees is the connector `
        + `failing after the browser opens. Add ${v.uri} to the allowed redirect addresses of the `
        + "application in front of this hostname. Every provider that fronts an MCP route keeps such a "
        + "list; on Cloudflare Access it is the application's Allowed redirect URIs, and its "
        + "localhost/loopback toggles do NOT cover a vendor's cloud." });
  }
  return out;
}
