// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// staff-domain.mjs — what a staff-domain rule ADMITS, decided before one is written.
//
// `PORTAL_STAFF_DOMAINS` is a list of email domains, and every address at a listed domain that gets
// past this instance's sign-in door is staff: it sees every brand owner on the instance
// (driver/portal-access.mjs). That is a rule about a set of people, not about one person.
//
// The install used to build that rule by taking everything after the last `@` of the one address it
// was given. On a laptop that address is `<account>@localhost` and the rule admits the one identity
// that can sign in, which is why it was safe and why nobody looked at it again. Given a real address
// the same line turns a person into their whole employer, or into every customer of a webmail
// provider, with nothing said to the operator and nothing to undo. A stranger's install granted a
// documentation domain that way, read its own settings page back, and reported it as a back door.
//
// So the derivation is classified before it is used, and there are three answers:
//
//   "narrow"    the domain cannot name a second person on this machine — `localhost`, or any bare
//               hostname with no dot. Deriving a rule from it is what it always was: safe, silent.
//   "public"    a webmail or shared provider. Never a staff rule: it would admit strangers, and no
//               deployment can want it. Refused outright, and the refusal names the domain.
//   "reserved"  a domain reserved for documentation and testing (RFC 2606). Nobody's real mail lives
//               there, so a rule built from one is always an address somebody typed as a placeholder.
//               Refused for the same reason, with a different sentence, because the remedy differs.
//   "wide"      an ordinary routable domain. It may well be the right rule — it is how a firm admits
//               its own lawyers — but it admits people the operator has not met, so it is stated in
//               the words the settings page will use and confirmed before it is written. It is never
//               derived silently from one address.
//
// FAIL-CLOSED, in the direction of a smaller grant. A domain wrongly classified `public` refuses, and
// the operator sets `PORTAL_STAFF_DOMAINS` themselves in one line — an explicit decision, recorded
// where the settings page can name it. A domain wrongly classified `wide` asks a question. Neither
// outcome grants anything, which is why the lists below are allowed to be short and stay short: the
// `wide` branch is what actually protects an operator, and the lists only decide whether the product
// asks a question or refuses to ask one.

/** Last-@ semantics, matching driver/portal-access.mjs and shared/scope.mjs `isFirmDomain`. */
export function domainOfEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : "";
}

/**
 * Webmail and shared mailbox providers, exactly.
 *
 * Not a census of the internet, and deliberately not growing into one: an unlisted provider still
 * lands in `wide`, where it is stated and confirmed rather than written silently. What this list buys
 * is that the commonest addresses a person types — their own personal mail — are refused with a
 * sentence about why, instead of being offered as a rule somebody might say yes to.
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
 * any of them, so an address at one is a placeholder somebody typed — which is exactly what happened.
 *
 * `localhost` ITSELF IS NOT HERE. A bare `localhost` is the local-account default and is classified
 * `narrow` below; only `something.localhost` reaches this test.
 */
function isReservedDomain(domain) {
  if (/^example\.(com|net|org)$/.test(domain)) return true;
  if (/\.example\.(com|net|org)$/.test(domain)) return true;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return domain.includes(".") && ["example", "invalid", "test", "localhost"].includes(tld);
}

/** A domain that cannot name a second person on this machine: `localhost`, or any dotless hostname. */
function isNarrowDomain(domain) {
  return domain === "localhost" || domain === "localhost.localdomain" || !domain.includes(".");
}

/**
 * What a staff rule built from this domain would admit.
 *
 * @param {string} domain a bare domain, already lowercased — `domainOfEmail` produces one.
 * @returns {"narrow"|"public"|"reserved"|"wide"|""}  "" only when there is no domain to classify.
 */
export function classifyStaffDomain(domain) {
  const d = String(domain ?? "").trim().toLowerCase();
  if (!d) return "";
  if (isNarrowDomain(d)) return "narrow";
  if (isReservedDomain(d)) return "reserved";
  if (PUBLIC_EMAIL_DOMAINS.has(d)) return "public";
  if (PUBLIC_EMAIL_FAMILIES.has(d.slice(0, d.indexOf(".")))) return "public";
  return "wide";
}

/**
 * The rule in the words the settings page uses, so the operator recognises what they agreed to.
 *
 * ONE COMPOSER FOR BOTH SURFACES. The People & access screen renders "Anyone at <domain>" under a
 * heading that calls it a config rule rather than a person, and describes staff as capable of seeing
 * every brand owner. A consent prompt phrased any other way asks about one thing and shows another.
 */
export function staffGrantSentence(domain, { staffLabel = "Staff" } = {}) {
  return `Anyone at ${domain} — a rule, not a person. ${staffLabel}: capable to see every brand owner `
    + "on this instance.";
}

/**
 * Why this domain cannot become a staff rule, and what to do instead.
 *
 * Returns null for a domain that CAN — `narrow` and `wide` are not refusals, and `wide` is answered by
 * the confirmation the caller runs, not by this function.
 */
export function staffDomainRefusal(domain, { variable = "PORTAL_STAFF_DOMAINS" } = {}) {
  const d = String(domain ?? "").trim().toLowerCase();
  const verdict = classifyStaffDomain(d);
  if (verdict === "public") {
    return `${d} is a public email provider, so a staff rule built from it would admit anyone with an `
      + `address there — not your colleagues. Refusing to write one.\n`
      + `  Use an address at a domain your organisation controls, or set ${variable} yourself to the `
      + "domain you mean.\n"
      + "  If this machine is only yours, the local-account form takes no rule at all: leave the "
      + "address as <account>@localhost.";
  }
  if (verdict === "reserved") {
    return `${d} is reserved for documentation and receives no real mail (RFC 2606), so it is an `
      + "address somebody typed as a placeholder rather than one that signs in. Refusing to build a "
      + "staff rule from it.\n"
      + "  Use the address you actually sign in with, or the local-account form <account>@localhost "
      + "if this machine is only yours.";
  }
  return null;
}
