// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The geography stamp is decided twice. Every other door — the CLI, the dev cockpit, the MCP plan and
// start doors — sends NO stamp and lets `validateJob` derive one; the portal is the only door that
// composes it itself, in the browser, because the browser cannot import the engine. So the portal states
// what the engine would have derived, and this is what makes that safe.
//
// Measured across the doors on 2026-09-17: the portal was the only composer that could drift, and it had
// — it stated "worldwide" for every empty draft, which is a positive instruction that a company's own
// territories may not narrow the search. Two of the four searches were refused at the door as a result
// and a knockout ran the whole world. Nothing held the two sides together; this does.
//
// If this fails, do NOT edit one side to match. Decide which is right and carry it across.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { geographyFor, EMPTY_DRAFT } from '../src/contract/composerProduct.ts'
import { validateJob } from '../../driver/enqueue-schema.mjs'
import { PRODUCTS } from './products.fixture.ts'
import type { Draft, Product } from '../src/contract/composerProduct.ts'

const FOUR = ['United States', 'United Kingdom', 'European Union', 'Canada']

/** What the engine's own door derives for a request that carries no stamp — its job, not a copy of it. */
function engineDerives(product: Product | null, territories: readonly string[]): string | null {
  const job: Record<string, unknown> = {
    id: 'x', msgId: 'm', forwarder: 'a@b.test', markName: 'AQUAPLUS', goods: 'g', classes: [32],
    ...(product ? { product: product.key } : {}),
    ...(territories.length ? { jurisdictions: [...territories] } : {}),
  }
  // validateJob stamps IN PLACE. Reading a returned copy here would report null for every row and the
  // whole matrix would agree with itself about nothing.
  validateJob(job)
  return (job.geography as { mode?: string } | undefined)?.mode ?? null
}

test('the portal states the geography mode the engine would have derived', () => {
  const rows: string[] = []
  // Every product, and no product — the state before a search is picked, which is a request the composer
  // really can send.
  for (const product of [null, ...PRODUCTS] as ReadonlyArray<Product | null>) {
    // A Global preliminary search carries no territories by construction: `chooseProduct` clears them,
    // because that search accepts no narrowing. Sending it some is a state the composer cannot reach and
    // the door refuses from both sides, so it is not a cell of this matrix.
    const drafts: ReadonlyArray<readonly [string, Draft, readonly string[]]> =
      product?.geography === 'worldwide, and nothing else'
        ? [['nothing set, nothing inherited', EMPTY_DRAFT, []], ['nothing set, four inherited', EMPTY_DRAFT, FOUR]]
        : [
            ['nothing set, nothing inherited', EMPTY_DRAFT, []],
            ['nothing set, four inherited', EMPTY_DRAFT, FOUR],
            ['two named', { ...EMPTY_DRAFT, territories: ['France', 'Germany'] }, []],
            ['two named over four inherited', { ...EMPTY_DRAFT, territories: ['France', 'Germany'] }, FOUR],
          ]
    for (const [state, d, inherited] of drafts) {
      const ours = geographyFor(d, product, inherited).mode
      const theirs = engineDerives(product, d.territories)
      rows.push(`${product?.key ?? '(no product)'} / ${state}: ${ours}`)
      assert.equal(ours, theirs,
        `${product?.key ?? 'no product named'}, ${state}: the screen states ${JSON.stringify(ours)} and the engine derives ${JSON.stringify(theirs)} — one reader, two different searches`)
    }
  }
  // A FLOOR ON THE POPULATION. A matrix that silently stopped producing rows would agree with itself
  // about nothing at all, and pass.
  assert.ok(rows.length >= 16, `only ${rows.length} states were compared: ${JSON.stringify(rows)}`)
  // And it is not one answer repeated: all three modes have to appear, or the agreement is trivial.
  for (const mode of ['worldwide', 'named', 'account-default']) {
    assert.ok(rows.some((r) => r.endsWith(mode)), `no state produced ${mode}: ${JSON.stringify(rows)}`)
  }
})
