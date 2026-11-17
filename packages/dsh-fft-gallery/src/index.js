/**
 * Host entry for the FT gallery.
 *
 * The package's substance is its data: `gallery/catalog.json` lists the web
 * apps (and, for the Host market index, the plugin bundles) a third party
 * registered through a repository manifest. This module is the one thing a
 * client half cannot do on its own — read that file off disk and answer on an
 * exact Fetch route.
 *
 * Everything is lazy and optional: the route appears with `connection`, and a
 * profile without that service simply has no route instead of failing to load.
 * A catalog read never throws at the caller; a missing or invalid file lands in
 * the payload so the shelf can say what is wrong.
 * @module @dsh-ft/dsh-fft-gallery
 */

import { readFile } from 'node:fs/promises'

/** Package name the Loader shows. */
export const name = '@dsh-ft/dsh-fft-gallery'

/** The one route the browser half reads. */
export const CATALOG_ROUTE = '/api/ft-gallery/catalog'

/** Bundled catalog file, resolved relative to this module (lib/ or src/). */
const CATALOG_FILE = new URL('../gallery/catalog.json', import.meta.url)

/** JSON response helper. */
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Read and parse the bundled catalog.
 * @returns {Promise<object>} the catalog document.
 */
export async function readBundledCatalog() {
  const text = await readFile(CATALOG_FILE, 'utf8')
  const catalog = JSON.parse(text)
  if (catalog === null || typeof catalog !== 'object') throw new Error('catalog.json is not an object')
  if (catalog.format !== 1) throw new Error(`catalog.json has unsupported format: ${String(catalog.format)}`)
  if (!Array.isArray(catalog.entries)) throw new Error('catalog.json has no entries array')
  return catalog
}

/**
 * Build the exact route the shelf reads.
 * @param {() => Promise<object>} read - produces one catalog read; it may reject.
 * @returns the route the host connection registry accepts.
 */
export function createCatalogRoute(read) {
  return {
    path: CATALOG_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'GET') {
        return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET' } })
      }
      try {
        const catalog = await read()
        return json(200, {
          ok: true,
          catalog: {
            ...catalog,
            source: 'bundled',
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return json(200, { ok: false, error: { code: 'CATALOG_UNAVAILABLE', message } })
      }
    },
  }
}

/**
 * Attach the catalog route.
 * @param {object} ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection')
    if (connection === undefined || typeof connection.fetch?.register !== 'function') return
    scope.effect(
      () => connection.fetch.register(createCatalogRoute(readBundledCatalog)),
      'dsh-fft-gallery: catalog route',
    )
  })
}
