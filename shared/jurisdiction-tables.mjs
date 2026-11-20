// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// shared/jurisdiction-tables.mjs — the hand-written tables a jurisdiction is, in one place.
//
// A new jurisdiction used to be an edit to about ten modules, each holding its own list, and nothing
// said whether those lists agreed. They are here now, one section per module that reads them; each of
// those modules imports its tables from here and exports them as before, so no reader changed.
// test/a-jurisdiction-s-tables-agree.test.mjs reads them side by side and names every place they differ.
//
// PURE DATA, AND IT IMPORTS NOTHING, so the driver, the publisher and the providers' shared code can all
// read it. Each table is as it was, frozen or not: freezing one would be a change of its own.
//
// Kept where they are: each register's own office table (in its provider folder), the names derived
// from the runtime's region data, the geography rules, which are functions, and the model's
// transliteration manual.

// ── read by driver/jurisdiction-codes.mjs ───────────────────────────────────────────────────────────────────

// Aliases → canonical code. GB is the ISO 3166-1 code (UK is a habit, not a code); EU is the driver's
// canonical EUIPO token (EM is Compumark's spelling of the same office, EUTM/EUIPO are prose).
export const JURISDICTION_CODE_FOLD = Object.freeze({
  UK: "GB",
  EM: "EU",
  EUTM: "EU",
  EUIPO: "EU",
});

// The known universe: ISO 3166-1 alpha-2 (officially assigned) + the register-world extras — EU
// (EUIPO, canonical), WO (WIPO / Madrid International Register), AP (ARIPO), OA (OAPI), BX (Benelux),
// EA (Eurasian), IB (International Bureau), plus the X*/ZZ extension codes observed in live provider
// office enums (XK Kosovo et al.). A code outside this set is not necessarily wrong — it is UNKNOWN,
// and A12's contract is that it surfaces loudly instead of being silently recorded as a jurisdiction.
export const KNOWN_JURISDICTION_CODES = Object.freeze(new Set([
  // ISO 3166-1 alpha-2, officially assigned
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS",
  "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
  // register-world extras (WIPO ST.3 / regional offices / provider extension codes)
  "EU", "WO", "AP", "OA", "BX", "EA", "IB",
  "XA", "XG", "XK", "XS", "XW", "ZZ",
]));

// ── read by providers/_shared/territory-codes.mjs ───────────────────────────────────────────────────────────

// Keys are strip()-normalized display names and common aliases. Values are the ISO 3166-1 alpha-2
// code (WIPO ST.3 for the regional systems). "" = worldwide sentinel.
export const TERRITORY_TO_CODE = Object.freeze({
  "WORLDWIDE": "", "GLOBAL": "", "ALL": "",
  "EUROPEAN UNION": "EU", "EUIPO": "EU", "EUTM": "EU",
  "BENELUX": "BX",
  "AFRICAN REGIONAL ARIPO": "AP", "ARIPO": "AP", "AFRICAN REGIONAL": "AP",
  "INTERNATIONAL": "WO", "INTERNATIONAL MADRID": "WO", "MADRID": "WO", "WIPO": "WO",
  "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "USA": "US", "U S": "US", "U S A": "US",
  "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB",
  "IRELAND": "IE",
  "FRANCE": "FR",
  "GERMANY": "DE",
  "SPAIN": "ES",
  "ITALY": "IT",
  "NETHERLANDS": "NL",
  // THE OTHER TWO BENELUX MEMBERS, and their absence was not a typo — it is the shape this table has.
  // A clearance ordered for "Belgium" in words resolved to nothing and was carried as an unrecognized
  // territory, while "BE" and "Netherlands" both resolved. Belgium and Luxembourg have no national
  // register of their own (the Benelux office stands in its place, which `binding-layers.mjs` already
  // models), and the entry for BENELUX above is easy to read as covering them. It does not: this table
  // answers "what did the requester type", not "which register is that".
  "BELGIUM": "BE",
  "LUXEMBOURG": "LU",
  "SWITZERLAND": "CH",
  "AUSTRIA": "AT",
  "SWEDEN": "SE",
  "NORWAY": "NO",
  "POLAND": "PL",
  "BULGARIA": "BG",
  "GREECE": "GR",
  "TURKEY": "TR", "TURKIYE": "TR",
  "CANADA": "CA",
  "MEXICO": "MX",
  "BRAZIL": "BR",
  "ARGENTINA": "AR",
  "CHINA": "CN", "PEOPLES REPUBLIC OF CHINA": "CN",
  "HONG KONG": "HK",
  "TAIWAN": "TW",
  "MACAU": "MO", "MACAO": "MO",
  "JAPAN": "JP",
  "SOUTH KOREA": "KR", "KOREA": "KR", "REPUBLIC OF KOREA": "KR",
  "SINGAPORE": "SG",
  "INDIA": "IN",
  "THAILAND": "TH",
  "AUSTRALIA": "AU",
  "NEW ZEALAND": "NZ",
  "UNITED ARAB EMIRATES": "AE", "UAE": "AE",
  "SAUDI ARABIA": "SA",
  "SOUTH AFRICA": "ZA",
});

// ── read by driver/publish/regions.mjs ──────────────────────────────────────────────────────────────────────

export const COMMON_LAW = 'C/L';

export const REGION_NAMES = {
  US: 'United States', EU: 'European Union', UK: 'United Kingdom', CN: 'China', JP: 'Japan',
  KR: 'South Korea', CA: 'Canada', AU: 'Australia', IN: 'India', BR: 'Brazil', RU: 'Russia',
  BX: 'Benelux', CH: 'Switzerland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy',
  NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', SG: 'Singapore', WO: 'WIPO (Madrid)',
  TR: 'Turkey', NZ: 'New Zealand', PH: 'Philippines', ID: 'Indonesia', ZA: 'South Africa',
  MX: 'Mexico', TW: 'Taiwan', HK: 'Hong Kong', SA: 'Saudi Arabia', AE: 'United Arab Emirates',
  DK: 'Denmark', FI: 'Finland', PL: 'Poland', PT: 'Portugal', AT: 'Austria', BE: 'Belgium',
  IE: 'Ireland', GR: 'Greece', IL: 'Israel', TK: 'Tokelau',
  // XS is no country: it is the code the US state registers are filed under beside the federal one, read as they are
  // named (owner, 2026-11-18). It printed as "XS".
  XS: 'US state registers',
  // Two regional offices and a user-assigned code, by the names a lawyer knows them (owner, 2026-11-19). They printed
  // as codes in a report's list of places where nothing was found. XA, XG and XW stay as the register records them
  // until the register's own names for them are verified.
  AP: 'ARIPO', OA: 'OAPI', XK: 'Kosovo',
  CL: 'Chile', [COMMON_LAW]: 'Common-law',
};

// doc-55 B — Madrid/WIPO international records surface from corsearch as jurisdiction "INT" (URI
// /mark/int/…); normalize them to the existing WO ('WIPO (Madrid)') so the WIPO international register
// reads consistently everywhere (one recent run showed "WO", another "INT"). NOTE: we do NOT alias "IR"
// — IR is ISO-3166 Iran, not "international registration" (the same CL=Chile collision REGION_NAMES guards
// against). euipo IR-designating-EU records already carry jurisdiction "EU"; corsearch Madrid = "INT".
export const REGION_ALIAS = { GB: 'UK', EM: 'EU', EUTM: 'EU', EUIPO: 'EU', INT: 'WO' };

// ── read by driver/territory-tiers.mjs ──────────────────────────────────────────────────────────────────────

/** The supranational codes: one entry covering many countries. Post-fold — EM/EUTM/EUIPO arrive as EU. */
export const REGION_CODES = Object.freeze(new Set(["EU", "WO", "AP", "OA", "BX", "EA", "IB"]));

/**
 * — KNOWN, AND STILL NOT A COUNTRY.
 *
 * `KNOWN_JURISDICTION_CODES` is the set of codes the engine RECOGNIZES on a record, which is a wider
 * question than "does this name one country". Its tail carries WIPO ST.3 register-world extras, and
 * `ZZ` is ST.3's code for UNSPECIFIED — the literal "nowhere" token. Tiered by membership alone it came
 * back "country", so a Full country search over `["ZZ"]` named nowhere and satisfied the one-country
 * rule at every door.
 *
 * That is precisely the failure territory-tiers.mjs was written to prevent — its header says "QQ would
 * otherwise look exactly like a country code and satisfy a one-country rule while naming nowhere" —
 * arriving from INSIDE the known set instead of outside it, which is why the guard did not see it.
 *
 * KEPT KNOWN, TIERED HONESTLY. Removing `ZZ` from the known set would be the other repair and it is the
 * wrong one: a provider may legitimately stamp it on a record, and an unknown code there is dropped or
 * warned about. What must not happen is a REQUEST naming it passing a geography rule. Membership answers
 * "can we read this"; the tier answers "is this one country"; they were the same answer and are not the
 * same question.
 *
 * DELIBERATELY ONLY `ZZ` TODAY. The siblings beside it in that list — XA, XG, XS, XW — are provider
 * extension codes whose register semantics I could not establish at source, and XK is Kosovo, which
 * registers do treat as a territory. Guessing which of those name a country would trade a measured bug
 * for an unmeasured one. The MECHANISM is the fix and the roster is explicit: adding a code here is one
 * line once somebody can say what it means.
 */
export const KNOWN_NON_COUNTRY_CODES = Object.freeze(new Set(["ZZ"]));

/** The four answers. Exported so a caller cannot misspell one in a comparison. */
export const TERRITORY_TIERS = Object.freeze(["worldwide", "region", "country", "unrecognized"]);

// ── read by driver/binding-layers.mjs ───────────────────────────────────────────────────────────────────────

// The Benelux register's members. It is their national register, not a layer over one: binding-layers.mjs says
// why that matters.
export const BENELUX_MEMBERS = Object.freeze(["NL", "BE", "LU"]);

// EU member states, for whom an EU trade mark is a binding regional right. An EUTM covering an
// instructed EU member blocks use there without appearing in that member's national register.
// Exported for the audit's register-presence store, which needs the CONVERSE
// direction — a member state's national right operates inside an EU-scoped matter's market — and must
// not carry a second copy of this list to drift from it.
export const EU_MEMBERS = Object.freeze([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/** The EU-wide register's office code, in the vocabulary the contracts use. */
export const EU_OFFICE = "EM";

/** The international (Madrid) register's office code. */
export const WO_OFFICE = "WO";

/** The Benelux register's office code. */
export const BX_OFFICE = "BX";

// ── read by driver/jurisdiction-systems.mjs ─────────────────────────────────────────────────────────────────

// Unregistered use creates enforceable rights (common-law family / use-based systems).
export const FIRST_TO_USE = [
  "US", "CA", "AU", "NZ", "IN", "PH",          // named in the spec
  "UK", "GB", "IE",                            // common-law core (passing off) — staff lawyer to confirm
];

// Registration is the source of rights; prior unregistered use gives little or no priority.
export const FIRST_TO_REGISTER = [
  "CH", "EU", "EM", "EUTM", "CN", "JP", "KR", "DE", "FR", "ES", "IT",   // named in the spec
  "BX", "NL", "BE", "AT", "PT", "SE", "NO", "DK", "FI", "PL", "CZ",     // EU/EFTA civil family
  "RU", "TR", "BR", "MX",                                                // well-established first-to-file
];

// ── read by driver/registration-scripts.mjs ─────────────────────────────────────────────────────────────────

/**
 * Territory → the scripts a mark could plausibly hold a registration in there.
 *
 * Keys are canonical jurisdiction codes (jurisdiction-codes.mjs vocabulary). A territory that is not
 * listed is Latin-only, which is the honest default: adding a script to this table widens what every
 * run in that territory must state, so an unresearched row would cost real work on every matter.
 */
export const REGISTRABLE_SCRIPTS = Object.freeze({
  // ── Han-script markets. A foreign mark is commonly registered BOTH in Latin and in a Chinese
  // rendering (transliterated for sound, translated for meaning, or a coined pairing) — and the Chinese
  // rendering is the one local consumers use, so a conflict found only there is the one that bites.
  CN: ["latin", "han"],
  TW: ["latin", "han"],
  HK: ["latin", "han"],
  MO: ["latin", "han"],
  SG: ["latin", "han"],   // English and Chinese both official; marks routinely file in both

  // ── Japan: katakana, NOT the four writing systems. Katakana is the script Japanese uses for foreign
  // words, and it is what a foreign word mark is transliterated into on the register. Kanji and hiragana
  // renderings exist for marks that are Japanese words to begin with — a matter shaped that way earns a
  // row here by judgment, not by a table demanding it of every mark.
  JP: ["latin", "katakana"],

  // ── Korea: hangul, same reasoning as katakana.
  KR: ["latin", "hangul"],

  // ── Cyrillic markets. A Latin mark is routinely registered alongside its Cyrillic transliteration,
  // and the local trade uses the Cyrillic form.
  RU: ["latin", "cyrillic"],
  UA: ["latin", "cyrillic"],
  BY: ["latin", "cyrillic"],
  KZ: ["latin", "cyrillic"],
  RS: ["latin", "cyrillic"],
  BG: ["latin", "cyrillic"],

  // ── Arabic-script markets. The Arabic rendering is a separate registration in practice.
  SA: ["latin", "arabic"],
  AE: ["latin", "arabic"],
  EG: ["latin", "arabic"],
  QA: ["latin", "arabic"],
  KW: ["latin", "arabic"],
  BH: ["latin", "arabic"],
  OM: ["latin", "arabic"],
  JO: ["latin", "arabic"],
  IR: ["latin", "arabic"],   // Perso-Arabic script
  PK: ["latin", "arabic"],   // Urdu, Perso-Arabic script

  IL: ["latin", "hebrew"],
  GR: ["latin", "greek"],
  CY: ["latin", "greek"],
  TH: ["latin", "thai"],
  IN: ["latin", "devanagari"],   // Devanagari is the single most-registered Indic script; others are matter-specific
});

/**
 * Scripts a territory's register also holds marks in, beyond the ones its row above demands of every
 * matter. Read only to scope a question the plan already asks, never to demand a rendering: Japan's
 * register holds kanji marks (see its row), so a kanji question on a matter that names Japan is asked
 * there as well as in the Han-script markets.
 */
export const ALSO_REGISTERED_IN = Object.freeze({
  JP: ["han"],
});

/**
 * Scripts a market's buyers read that its row above does not demand of a manifest: the plan asks a form in one of them
 * when the manifest has one, and the script floor never requires it. The EU register holds Greek and Cyrillic marks
 * (Greece and Cyprus read Greek, Bulgaria Cyrillic), and an EU matter asked both before the plan held a script question
 * to a market; demanding them of every EU manifest would be a new duty no ruling sets.
 */
export const SCRIPTS_ASKED_IN = Object.freeze({
  EU: Object.freeze(["greek", "cyrillic"]),
});

// ── read by driver/register-coverage.mjs ────────────────────────────────────────────────────────────────────

// THE 37 LABELS THE FORM CARRIED BEFORE register-coverage.mjs's RULE, frozen. They are shipped strings, so
// each place keeps the label a client already reads — "Hong Kong", "Macau", "Turkey", where the runtime's
// standard names differ — and the two regional systems whose only names are these. Frozen HERE rather than
// read from the form's live list, because that list is now minted FROM that rule, and a rule that read its
// own output would lose its labels the first time the file was regenerated from scratch.
export const LABELS_OFFERED_BEFORE_THE_RULE = Object.freeze([
  "European Union", "Benelux", "African Regional (ARIPO)",
  "United States", "United Kingdom", "Ireland", "France", "Germany", "Spain", "Italy", "Netherlands",
  "Switzerland", "Austria", "Sweden", "Norway", "Poland", "Bulgaria", "Greece", "Turkey", "Canada",
  "Mexico", "Brazil", "Argentina", "China", "Hong Kong", "Taiwan", "Macau", "Japan", "South Korea",
  "Singapore", "India", "Thailand", "Australia", "New Zealand", "United Arab Emirates", "Saudi Arabia",
  "South Africa",
]);

// ── read by driver/jx-lanes.mjs ─────────────────────────────────────────────────────────────────────────────

// ── Jurisdiction → lane adapters (closed; conservative — only registers where Han-script filings are
// the norm; multilingual registers (e.g. SG) stay out of slice 1 rather than half-covered) ──────────
export const JURISDICTION_ADAPTERS = {
  CN: { lane: "zh", note: "first-to-file; subclass system (CNIPA similarity groups)" },
  HK: { lane: "zh" },
  TW: { lane: "zh" },
  MO: { lane: "zh" },
  JP: { lane: "ja", note: "JPO similar-group codes (類似群コード) — awareness table lands with its own slice" },
  KR: { lane: "ko", note: "KIPO similar-group codes (유사군코드) — awareness table lands with its own slice" },
};
