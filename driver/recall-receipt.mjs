// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recall-receipt.mjs — a PAST run's recall receipt, as that run's own audit may list it.
//
// The recall store and the searches it drove are gone: no run reads or writes remembered conflicts, and
// no new run writes `_driver/register-recall.json`. A run from before the removal still carries its
// receipt, the record of the recall searches it really ran, and its audit and workbook list them. This
// module is what keeps that run republishing unchanged. It reads nothing but the receipt it is handed.

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/**
 * The recall receipt as ONE company's audit and workbook may list it. Ruled 2026-09-23: no audit or
 * workbook lists a recall check whose source row is another company's, because the line itself says
 * someone cleared this mark before. The receipt names the company the run is delivered for (`customer`)
 * and each entry the companies whose deliveries remembered it (`customers`); an entry is listed when one
 * of them is the run's own. A row that names no company counts only for a run that names none. A receipt
 * written before it named companies lists as it always did, so an archived run republishes unchanged.
 * Only removes entries; PURE.
 */
export function recallReceiptForOwnCompany(receipt) {
  if (!isPlainObject(receipt) || !Object.hasOwn(receipt, "customer")) return receipt;
  const own = receipt.customer || null;
  const mine = (e) => Array.isArray(e?.customers) && e.customers.map((c) => c || null).includes(own);
  const pick = (xs) => (Array.isArray(xs) ? xs.filter(mine) : xs);
  return { ...receipt, directives: pick(receipt.directives), overflow: pick(receipt.overflow), refused: pick(receipt.refused) };
}
