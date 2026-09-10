// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// staff-domain.mjs — the sign-in addresses setup and `clearotron start` refuse, and why.
//
// This module used to decide what a staff-domain rule would admit, because the install built one from
// everything after the `@` of the address it was given. That rule is deleted: a person is admitted by
// their own entry in the grants file (shared/scope.mjs `resolvePerson`), and nothing about the part of an
// address after its `@` admits anyone. The person who installs is the first person, with access to
// everything (bin/start.mjs `installerGrants`).
//
// Two refusals about the ADDRESS ITSELF outlive the rule, and this module owns the second:
//
//   not a single email address   refused where it is typed (bin/onboard.mjs `askSignIn`, bin/start.mjs),
//                                because the portal refuses a multi-`@` identity outright.
//   a public or reserved domain  refused here. The address becomes the first person, with access to
//                                everything, and a personal mailbox at a webmail provider is not an
//                                address an organisation controls. A domain reserved for documentation
//                                receives no real mail, so an address there is a placeholder somebody
//                                typed — which is how an outside install came to be set up in the name of
//                                nobody.
//
// The lists stay short on purpose. An unlisted provider is accepted, and since the domain rule went an
// accepted address admits that one address and nobody else, so a miss admits no stranger.

/** Last-@ semantics, matching shared/scope.mjs `resolvePerson`. */
export function domainOfEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : "";
}

/**
 * Webmail and shared mailbox providers, exactly.
 *
 * Not a census of the internet, and deliberately not growing into one: an unlisted provider is accepted.
 * What this list buys is that the commonest addresses a person types — their own personal mail — are
 * sent back with a sentence about why.
 */
export const PUBLIC_EMAIL_DOMAINS = Object.freeze(new Set([
  "gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "mail.com", "gmx.com", "gmx.de", "gmx.net", "web.de", "t-online.de",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "tuta.io", "tutanota.com",
  "fastmail.com", "fastmail.fm", "hey.com", "zoho.com", "hushmail.com",
  "mail.ru", "inbox.ru", "list.ru", "bk.ru", "rambler.ru",
  "qq.com", "163.com", "126.com", "sina.com", "naver.com", "daum.net",
  "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "libero.it", "virgilio.it", "tiscali.it",
  "free.fr", "orange.fr", "wanadoo.fr", "laposte.net", "sfr.fr", "bbox.fr",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net", "cox.net",
  "btinternet.com", "sky.com", "virginmedia.com", "ntlworld.com", "talktalk.net",
  "bigpond.com", "optusnet.com.au", "shaw.ca", "sympatico.ca", "rogers.com",
  "xs4all.nl", "ziggo.nl", "telenet.be", "uol.com.br", "bol.com.br", "terra.com.br",
  "rediffmail.com", "yandex.com", "yandex.ru", "ya.ru",
]));

/**
 * Providers that sell the same mailbox under a per-country domain.
 *
 * Matched on the FIRST label, so `yahoo.co.uk` and `yahoo.fr` are covered without listing every
 * country. Kept to names that are a provider and nothing else — a first label like `free` or `orange`
 * is a real company's name somewhere, so those stay in the exact list above.
 */
export const PUBLIC_EMAIL_FAMILIES = Object.freeze(new Set([
  "yahoo", "ymail", "rocketmail", "hotmail", "outlook", "live", "msn", "gmx", "yandex", "googlemail",
]));

/**
 * Reserved for documentation and testing — RFC 2606 §2 and §3.
 *
 * `example.com`, `example.net`, `example.org` and everything under them, plus the whole of the
 * `.example`, `.invalid`, `.test` and `.localhost` top-level names. Real mail is never delivered to
 * any of them, so an address at one is a placeholder somebody typed.
 *
 * `localhost` ITSELF IS NOT HERE. A bare `localhost` is the local-account default, `<account>@localhost`,
 * and every first install takes it; only `something.localhost` reaches this test.
 */
function isReservedDomain(domain) {
  if (/^example\.(com|net|org)$/.test(domain)) return true;
  if (/\.example\.(com|net|org)$/.test(domain)) return true;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return domain.includes(".") && ["example", "invalid", "test", "localhost"].includes(tld);
}

/**
 * Whether an address at this domain may be the one that signs in.
 *
 * @param {string} domain a bare domain — `domainOfEmail` produces one.
 * @returns {"public"|"reserved"|"accepted"|""}  "" only when there is no domain to classify.
 */
export function classifyAddressDomain(domain) {
  const d = String(domain ?? "").trim().toLowerCase();
  if (!d) return "";
  if (isReservedDomain(d)) return "reserved";
  if (PUBLIC_EMAIL_DOMAINS.has(d)) return "public";
  if (d.includes(".") && PUBLIC_EMAIL_FAMILIES.has(d.slice(0, d.indexOf(".")))) return "public";
  return "accepted";
}

/**
 * Why this address cannot be the one that signs in, or null when it can.
 *
 * NAMES THE SETTING, because the reader's next act is to change it: the address is `PORTAL_LOCAL_USER`
 * whether it arrived from setup's question, from `--user` or from the environment file.
 */
export function addressRefusal(email) {
  const d = domainOfEmail(email);
  const verdict = classifyAddressDomain(d);
  if (verdict === "public") {
    return `${d} is a public email provider. The address that signs in here becomes the first person on `
      + "this install, with access to everything, and a personal mailbox is not an address your "
      + "organisation controls. Refusing it.\n"
      + "  Use an address at your organisation's own domain as PORTAL_LOCAL_USER, or, if this machine is "
      + "only yours, the local-account form <account>@localhost.";
  }
  if (verdict === "reserved") {
    return `${d} is reserved for documentation and receives no real mail (RFC 2606), so this is an `
      + "address somebody typed as a placeholder rather than one that signs in. Refusing it.\n"
      + "  Set PORTAL_LOCAL_USER to the address you actually sign in with, or to the local-account form "
      + "<account>@localhost if this machine is only yours.";
  }
  return null;
}
