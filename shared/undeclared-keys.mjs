// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
/**
 * Keys a payload carries that its JSON Schema does not declare, at any depth —.
 *
 * `serve` validates required-field PRESENCE at the seam and nothing else, so an
 * undeclared key inside an already-typed object rides silently. A seat that puts a legitimate field in
 * the wrong place is told the call was well-formed, and the value reaches no delivered artifact.
 *
 * PURE, and it REPORTS rather than judges. A path returned here is a key the schema does not declare —
 * which may be a gap in the schema or a value nobody reads. Deciding which needs the ACCEPTOR read, never
 * this output. `scripts/undeclared-key-census.mjs` is the driver that walks a run's captured calls.
 *
 * ✕ AN OBJECT DECLARED WITHOUT `properties` REPORTS NOTHING, and that is stated rather than hidden:
 * `record_synthesis`'s `findings.items` is exactly that shape, so nothing inside it can ever be flagged.
 * A clean result is therefore NOT evidence that a transport is fully declared. It is evidence that
 * whatever IS declared was respected.
 */
export function undeclaredKeys(schema, val, path = "") {
  const out = [];
  if (!schema || typeof schema !== "object") return out;
  if (schema.type === "object" && schema.properties && val && typeof val === "object" && !Array.isArray(val)) {
    for (const k of Object.keys(val)) {
      const here = path ? `${path}.${k}` : k;
      if (!(k in schema.properties)) { out.push(here); continue; }
      out.push(...undeclaredKeys(schema.properties[k], val[k], here));
    }
  } else if (schema.type === "array" && schema.items && Array.isArray(val)) {
    val.forEach((v, i) => out.push(...undeclaredKeys(schema.items, v, `${path}[${i}]`)));
  }
  return out;
}
