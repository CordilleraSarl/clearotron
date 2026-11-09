// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// report-dates.mjs — the dates a report prints, read from the report's record.
//
// Opening or republishing a report does not mean a new search happened, or that the report was issued again.
// Both publishers stamped the clock at publish, so a demo's finished example read as searched and issued today,
// and a republished report's "Issued on" disagreed with the first issue time its own meta.json had kept.
//
// THE SEARCH DATE IS WHEN THE RUN STARTED, from its status.json. A source with none has no date to print, and the
// report's own missing-value presentation applies; today is never the answer.
// THE ISSUE DATE IS THE FIRST ONE: what the pool's meta.json kept, or the delivery the run recorded when the pool
// holds no copy (a demo, or a run republished into an empty pool), and the clock only when neither exists, which is
// a first publish. `renderedAt` is this publish, recorded apart from both.
import { join } from "node:path";
import { readJsonOrNull } from "../run-record.mjs";

const instant = (value) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);

/** `{searchedAt, issuedAt, renderedAt}` as ISO strings. `searchedAt` is null when the run records no start. */
export function reportDates({ runDir, poolRunDir, now = new Date() }) {
  const status = readJsonOrNull(join(runDir, "status.json"));
  const kept = readJsonOrNull(join(poolRunDir, "meta.json"));
  return {
    searchedAt: instant(status?.startedAt),
    issuedAt: instant(kept?.issuedAt) ?? instant(status?.deliveredAt) ?? now.toISOString(),
    renderedAt: now.toISOString(),
  };
}

/** An instant as `<date> · <time>` in the firm's locale (Europe/Zurich), with its zone when asked. null when there is none. */
export function zurichStamp(iso, { zone = false } = {}) {
  if (!instant(iso)) return null;
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    if (!zone) return `${date} · ${time}`;
    const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "CET";
    return `${date} · ${time} ${tz}`;
  } catch { return null; }
}
