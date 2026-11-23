// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ko-register-tables.mjs — what the review reads of the register: the filings the reading carried, as a table by record ID.
//
// Measured in testing, 2026-11-23, on five real orders: the review read the order's whole register record, 37k to 223k characters a
// review, and its steps cost about twice an earlier review's. Here it is handed, per name, the filings the reading carried, one line
// each, with what the reading set aside and why. A filing's whole wording stays one tool call away (read_register_list).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const TABLE_GOODS_CHARS = 200;
const COLUMNS = ["record_id", "qid", "mark", "owner", "status", "office", "classes", "goods in this name's classes"];
const key = (s) => String(s ?? "").trim().toLowerCase();
const cell = (v) => (Array.isArray(v) ? v.join(",") : String(v ?? "")).replace(/[|\n]+/g, " ").replace(/\s+/g, " ").trim();

/** One name's classes, from the plan; null when the plan does not say. PURE. */
function classesOf(plan, name) {
  const row = (plan?.marks ?? []).find((m) => key(m?.name) === key(name));
  const c = (Array.isArray(row?.classes) ? row.classes : []).filter((n) => Number.isInteger(n));
  return c.length ? new Set(c) : null;
}

/** A filing's goods in the classes `scope` holds, each class cut at TABLE_GOODS_CHARS. PURE. */
function goodsIn(goods, scope) {
  return (Array.isArray(goods) ? goods : [goods]).filter(Boolean).map(String)
    .filter((t) => !scope || scope.has(Number(t.split(":")[0])))
    .map((t) => (t.length > TABLE_GOODS_CHARS ? `${t.slice(0, TABLE_GOODS_CHARS)}…` : t)).join(" / ");
}

/** The register as a table by record ID: for each name, its carried filings one line each, then what the reading set aside, one short line each with its reason. PURE. */
export function registerTable(registerDoc, plan) {
  const row = (r, scope) => [r.recordId, r.question, r.mark, r.owner, r.status, r.territory, r.classes, goodsIn(r.goods, scope)].map(cell).join(" | ");
  const aside = (r) => [r.recordId, r.mark, r.owner, r.status, r.setAsideBecause ?? r.why ?? r.reason ?? ""].map(cell).join(" | ");
  return {
    schema: 1, form: "register-table", columns: COLUMNS.join(" | "), setAsideColumns: "record_id | mark | owner | status | why set aside",
    names: (registerDoc?.marks ?? []).map((m) => {
      const scope = classesOf(plan, m.name);
      return { name: m.name, carried: (m.records ?? []).map((r) => row(r, scope)), setAside: (m.setAsideRecords ?? []).map(aside) };
    }),
  };
}

/** Write a table, and return its path. */
export function writeRegisterTable(path, doc) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return path;
}
