// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Nice classification, as something you can look a class UP in rather than have to already know.
//
// The composer used to take classes as a comma-separated box of numbers. That is a fine input for the
// person who wrote the classification and a bad one for everyone else: it asks for a fact the user has to
// go and find, accepts anything, and shows nothing back. This module carries the 45 class headings and a
// matcher, so "software", "9", or "drinks" all reach the right row and the chip that lands says what the
// class IS.
//
// WHY NOT A `<datalist>`: the design comp uses one, and this codebase already learned better on the
// territory field — a native datalist substring-matches, so typing two letters offers a menu that hides
// the entry you wanted. `classMatches` is the same custom, whole-word matcher `territoryMatches` is, for
// the same reason. The comp's use of a datalist is the INTENT (a chip reading `9 · Electrical &
// software`); the mechanism is ours.
//
// The headings are SHORT — "Electrical & software", not the WIPO paragraph. They exist to confirm a
// choice at a glance, not to advise on specification drafting; the goods field is where the actual
// specification goes, and it is what the search is scoped to.

/** The 45 Nice classes, by number, with a short heading. 1–34 are goods, 35–45 are services. */
export const NICE_CLASSES: Readonly<Record<number, string>> = {
  1: 'Chemicals', 2: 'Paints', 3: 'Cosmetics & cleaning', 4: 'Fuels', 5: 'Pharmaceuticals',
  6: 'Metals', 7: 'Machines', 8: 'Hand tools', 9: 'Electrical & software', 10: 'Medical devices',
  11: 'Lighting & heating', 12: 'Vehicles', 13: 'Firearms', 14: 'Jewellery', 15: 'Instruments',
  16: 'Paper & printed', 17: 'Rubber & plastics', 18: 'Leather goods', 19: 'Building materials',
  20: 'Furniture', 21: 'Household utensils', 22: 'Ropes & textiles', 23: 'Yarns', 24: 'Fabrics',
  25: 'Clothing', 26: 'Lace & trimmings', 27: 'Floor coverings', 28: 'Games & sporting goods',
  29: 'Meat & prepared foods', 30: 'Coffee, snacks & staples', 31: 'Fresh produce',
  32: 'Non-alcoholic drinks', 33: 'Alcoholic drinks', 34: 'Tobacco', 35: 'Advertising & retail',
  36: 'Financial', 37: 'Construction & repair', 38: 'Telecommunications', 39: 'Transport',
  40: 'Treatment of materials', 41: 'Education & entertainment', 42: 'Science & technology',
  43: 'Food & drink services', 44: 'Medical & beauty', 45: 'Legal & security',
}

export const ALL_CLASSES: readonly number[] = Object.keys(NICE_CLASSES).map(Number)

/** True for a number the engine will accept. The ONLY place in this stack that checks the range. */
export const isClassNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 45

/** `9 · Electrical & software`. An unknown number still renders — it is the user's, not ours to hide. */
export function classLabel(n: number): string {
  const heading = NICE_CLASSES[n]
  return heading ? `${n} · ${heading}` : String(n)
}

/**
 * Extra words that should find a class its heading does not literally contain.
 *
 * Kept deliberately short. This is a lookup aid, not a goods-classification engine — the moment it starts
 * deciding that "app" means class 9 rather than 42 it is giving legal advice through a search box. Every
 * entry here is a plain synonym of the heading itself.
 */
const ALIASES: Readonly<Record<number, readonly string[]>> = {
  3: ['perfume', 'soap', 'skincare'],
  5: ['pharma', 'medicine', 'supplements'],
  9: ['software', 'app', 'apps', 'computer', 'hardware', 'electronics'],
  25: ['apparel', 'footwear', 'shoes', 'fashion'],
  28: ['toys', 'sport', 'sports'],
  30: ['coffee', 'tea', 'snacks'],
  32: ['beer', 'water', 'juice', 'soft drinks', 'energy drinks'],
  33: ['wine', 'spirits', 'alcohol'],
  35: ['retail', 'marketing', 'advertising', 'shop', 'ecommerce', 'e-commerce'],
  36: ['finance', 'insurance', 'banking', 'crypto'],
  38: ['telecoms', 'telecom', 'streaming'],
  41: ['education', 'training', 'entertainment', 'games', 'publishing'],
  42: ['saas', 'software services', 'tech', 'technology', 'research', 'design'],
  43: ['restaurant', 'cafe', 'hotel', 'catering'],
  44: ['clinic', 'salon', 'beauty', 'healthcare'],
  45: ['legal', 'law', 'security'],
}

/**
 * Classes matching what was typed, minus the ones already chosen.
 *
 * NUMBERS FIRST, and exactly: typing "4" offers class 4, not classes 4, 14, 24, 34, 40–45 with 4 buried
 * among them. A digit string is a class number if it is one — anything else falls through to the words.
 *
 * Words match on WHOLE-WORD PREFIXES of the heading and the aliases, never on a bare substring. The
 * territory field learned this the expensive way: contains-matching turns "in" into India, China,
 * Singapore and Argentina at once, which is a menu that hides the answer.
 */
export function classMatches(query: string, chosen: readonly number[], limit = 8): readonly number[] {
  const q = query.trim().toLowerCase().replace(/^(class|cl\.?)\s+/, '')
  if (!q) return []

  const free = (n: number) => !chosen.includes(n)

  // A bare number is an exact answer, so it is offered alone rather than ranked among word matches.
  if (/^\d{1,2}$/.test(q)) {
    const n = Number(q)
    return isClassNumber(n) && free(n) ? [n] : []
  }

  const hit = (n: number): boolean => {
    const words = `${NICE_CLASSES[n] ?? ''}`.toLowerCase().split(/[\s&,]+/).filter(Boolean)
    if (words.some((w) => w.startsWith(q))) return true
    return (ALIASES[n] ?? []).some((a) => a.startsWith(q) || a.split(/\s+/).some((w) => w.startsWith(q)))
  }
  return ALL_CLASSES.filter((n) => free(n) && hit(n)).slice(0, limit)
}

// Parsing a typed list stays where it is: `compose.ts::parseClasses`, which drops out-of-range values
// because a class number is the scope of the search and therefore of the bill. There was a second
// parser alongside it — the retired saved-search editor kept out-of-range values so its own message
// could name them — and it went with that screen. One parser, one answer, and no third copy here.
