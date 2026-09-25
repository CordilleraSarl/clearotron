// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// web-grid.mjs — the common-law web grid the matter frame decides.
//
// The frame decides, before the web sweep, which stores are searched and for which forms. The customer
// profile's store list is what it chooses from: a store it sets aside, with its reason, is not searched, and
// every other store is. Its `search_channels` add the matter's own channels beside them, as they always did.
// The driver then dictates the grid as blocks (the grid spec's `grids`): the mark itself and the frame's
// forms on those stores, and every spelling on the general web search, as the net for a hit on a store the
// grid does not name. What runs is tens of cells, never every spelling on every store.
//
// THREE READINGS, AND THE RUN LOG SAYS WHICH ONE A GRID TOOK:
//   - the frame sent its forms: the grid above;
//   - the frame was asked for them (the stage-contract marker) and sent none: the mark itself stands in for
//     the forms, so a frame that answered nothing still gets a small grid rather than the old full one;
//   - the frame was never asked (a run minted before the fields existed, resumed): every spelling on every
//     store, exactly the grid it was minted with.
//
// NOTHING HERE REFUSES. A set-aside with no reason is not a decision, so its store stays searched; a
// decision naming a store the grid does not carry changes nothing. A refusal would cost the run a retry,
// and each of these already has a safe reading.
//
// What the frame set aside goes to the audit workbook with its reason, beside the withheld searches, and
// never to the report.
import { readFileSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";
import { lastAcceptedMatterFrame } from "./matter-frame-record.mjs";

const str = (v) => String(v ?? "").trim();
const key = (v) => str(v).toLowerCase();
const dedupe = (list) => {
  const seen = new Set(), out = [];
  for (const x of list ?? []) { const k = key(x); if (k && !seen.has(k)) { seen.add(k); out.push(str(x)); } }
  return out;
};

/**
 * The frame's decision, read from its accepted call: `forms` is null when the frame did not send them (the
 * key absent), and a list, possibly empty, when it did. A set-aside with no reason, or naming neither a
 * store nor a form, is not a decision and is left out. PURE.
 */
export function frameWebChoice(call) {
  const forms = Array.isArray(call?.confusable_forms) ? dedupe(call.confusable_forms) : null;
  const setAside = (Array.isArray(call?.set_aside) ? call.set_aside : [])
    .map((x) => ({ store: str(x?.store), form: str(x?.form), reason: str(x?.reason) }))
    .filter((x) => x.reason && (x.store || x.form));
  return { forms, setAside };
}

/** The same, for a run: its frame's accepted call. An unreadable call is no decision. */
export function frameWebChoiceFor(runDir) {
  try { return frameWebChoice(lastAcceptedMatterFrame(runDir)); } catch { return { forms: null, setAside: [] }; }
}

/**
 * Whether this run's frame was dispatched asking for the web-grid fields: the stage-contract marker the
 * driver writes at dispatch. It is the one thing that tells a frame that answered nothing from a frame
 * that was never asked, and only the second may keep the old full grid.
 */
export function frameAskedForWebGrid(runDir) {
  try { return Boolean(JSON.parse(readFileSync(driverDir(runDir, "stage-contracts.json"), "utf8"))?.["matter-frame"]?.webGrid); }
  catch { return false; }
}

/**
 * The grid: its terms, the platforms it runs, and its blocks. PURE.
 *
 * `decided` false (a frame never asked for the fields): every spelling on every channel and the general web,
 * one product with no blocks, the grid as it always was.
 *
 * Otherwise the stores are the channels less those the frame set aside with a reason. The mark itself and
 * the frame's forms run on them, and every spelling, those forms included, runs on the general web. `menu`
 * is every channel the frame chose from. `setAside` is what the frame set aside that the grid honoured: its
 * stores, and its forms that the stores do not search. `unmatched` is every decision that changed nothing,
 * kept for the run log.
 *
 * @returns {{terms:string[], platforms:string[], grids?:Array<{terms:string[], platforms:string[]}>,
 *   menu?:string[], setAside:Array<{store?:string, form?:string, reason:string}>, unmatched:Array<object>}}
 */
export function webGridOf({ variants = [], channels = [], marks = [], forms = null, setAside = [], decided = forms !== null } = {}) {
  const menu = dedupe(channels).filter((c) => key(c) !== "web");
  if (!decided) return { terms: [...variants], platforms: [...menu, "web"], setAside: [], unmatched: [] };
  // THE MARK ITSELF IS THE MANIFEST'S, never the request's raw name: the manifest is what a run searches,
  // and a request can name the mark with a codename or house word the manifest does not ask. So it is the
  // job's mark as the manifest writes it, else the manifest's first row, which is the mark. A form the
  // manifest carries takes its spelling too, so one term never runs under two spellings.
  const asWritten = (t) => variants.find((v) => key(v) === key(t)) ?? str(t);
  const carried = marks.map((m) => variants.find((v) => key(v) === key(m))).filter(Boolean);
  const itself = carried.length ? carried : variants.slice(0, 1);
  const onStores = dedupe([...itself, ...(forms ?? []).map(asWritten)]);
  const asideStore = new Map(), keptAside = [], unmatched = [];
  for (const x of setAside) {
    const store = menu.find((c) => key(c) === key(x.store));
    if (x.store && !x.form && store) {
      if (!asideStore.has(key(store))) { asideStore.set(key(store), true); keptAside.push({ store, reason: x.reason }); }
    } else if (x.form && !x.store && !onStores.some((f) => key(f) === key(x.form))) {
      keptAside.push({ form: x.form, reason: x.reason });
    } else unmatched.push(x);
  }
  const stores = menu.filter((c) => !asideStore.has(key(c)));
  const onWeb = dedupe([...variants, ...onStores]);
  const grids = [
    ...(onStores.length && stores.length ? [{ terms: onStores, platforms: stores }] : []),
    { terms: onWeb, platforms: ["web"] },
  ];
  return { terms: dedupe([...onStores, ...onWeb]), platforms: [...stores, "web"], grids, menu: [...menu, "web"], setAside: keptAside, unmatched };
}

/**
 * The closure pass's grid for the cells it re-runs: one product when every term owes the same platforms,
 * else blocks, so re-running a gap never asks a cell the grid did not. Returns `{ grids }` or `{}`. PURE.
 */
export function closureBlocksOf(cells) {
  const byTerm = new Map();
  for (const c of cells ?? []) {
    const t = str(c?.variant ?? c?.term), p = str(c?.platform);
    if (!t || !p) continue;
    if (!byTerm.has(t)) byTerm.set(t, []);
    if (!byTerm.get(t).includes(p)) byTerm.get(t).push(p);
  }
  const groups = new Map();
  for (const [t, ps] of byTerm) {
    const k = JSON.stringify([...ps].sort());
    if (!groups.has(k)) groups.set(k, { terms: [], platforms: [...ps] });
    groups.get(k).terms.push(t);
  }
  return groups.size > 1 ? { grids: [...groups.values()] } : {};
}

/**
 * The stores the frame set aside, as audit-workbook coverage rows in the withheld families' shape: the store
 * as the area, and the frame's own reason, kept whole in the "What's left" cell as a withheld family's is,
 * so a reason with a semicolon is not cut in two. Read from the grid spec the driver wrote, so a row names
 * only a store the grid really left out. A form the frame set aside gets no row, because the general web
 * search still asks every spelling. Never throws.
 */
export function frameSetAsideRows(runDir) {
  try {
    const spec = JSON.parse(readFileSync(driverDir(runDir, "grid-spec.json"), "utf8"));
    return (Array.isArray(spec?.set_aside) ? spec.set_aside : [])
      .filter((x) => str(x?.store) && str(x?.reason))
      .map((x) => ({ area: str(x.store), state: "not-searched", note: str(x.reason), done: "", left: str(x.reason) }));
  } catch { return []; }
}
