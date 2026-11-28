// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// shown-address.mjs — a configured address, as a line read in a terminal or a log may show it.
//
// A CONFIGURED ENDPOINT CAN CARRY A CREDENTIAL (design, 2026-11-27): a user and password before the host, or a key in
// the query. The lines that name an address are read in an administrator's terminal, pasted into tickets and kept in
// scrollback, so they show the scheme, the host and the path, and never the user, the password, the query or the
// fragment. An address that does not parse is not shown at all, because which part of it is secret cannot be told.

/** `raw` as `scheme://host[:port][/path]`, or null when it is not an address with a host. */
export function shownAddress(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch { return null; }
  if (!u.host) return null;
  // `new URL` gives a bare origin the path "/"; it is shown only where the configured value wrote one.
  const wrotePath = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*\//i.test(text);
  return `${u.protocol}//${u.host}${wrotePath ? u.pathname : ""}`;
}
