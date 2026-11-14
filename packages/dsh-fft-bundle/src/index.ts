/**
 * Host entry for the FT workbench composition bundle.
 *
 * The bundle's substance stays its `cordis.patch.yml`: it is what installs the
 * plugin set. This module adds the one thing a composition layer can own that
 * no member plugin can — a read-only answer to "is this installation complete,
 * and which part is not". It serves that answer on an exact Fetch route the
 * browser half reads from a card in the existing FT settings page.
 *
 * Everything is lazy and optional: the route appears with `connection`, and a
 * missing service inside a read lands in that field of the payload instead of
 * taking the row down. A composition layer must never be the reason the plugins
 * it installs fail to load.
 * @module @dsh-ft/finance-all-in-one
 */

import {
  collectWorkbenchStatus,
  WORKBENCH_ROUTE,
  type PackageLookupLike,
  type WorkbenchHostLike,
  type WorkbenchStatus,
} from './status.js'

export * from './status.js'

/** Package name the Loader and the plugin manager show. */
export const name = '@dsh-ft/finance-all-in-one'

/** Scope of one exact Fetch route: the fields the host registry reads. */
interface FetchRouteLike {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  readonly fetch: (request: Request) => Promise<Response>
}

/** Host registry behind `connection.fetch`. */
interface HostFetchLike {
  register(route: FetchRouteLike): () => Promise<void>
}

/** Host connection service slice. */
interface HostConnectionLike {
  readonly fetch: HostFetchLike
}

/** One inject scope, as cordis hands it to the callback. */
interface InjectScopeLike {
  get(name: string): unknown
  effect(setup: () => () => unknown, label?: string): unknown
}

/** Plugin context slice this bundle reads; every optional member is feature-detected. */
export interface WorkbenchContext extends WorkbenchHostLike {
  get(name: string): unknown
  pluginPackages?: PackageLookupLike
  inject(names: readonly string[], callback: (scope: InjectScopeLike) => void): unknown
}

/** JSON response helper. */
function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Build the exact route the card reads.
 * @param collect - produces one status read; it never rejects.
 * @returns the route the host connection registry accepts.
 */
export function createWorkbenchRoute(collect: () => Promise<WorkbenchStatus>): FetchRouteLike {
  return {
    path: WORKBENCH_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'GET') {
        return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET' } })
      }
      try {
        return json(200, { ok: true, status: await collect() })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return json(200, { ok: false, error: { code: 'COLLECT_FAILED', message } })
      }
    },
  }
}

/**
 * Attach the workbench status route.
 *
 * The route is the bundle's only runtime contribution: it registers with the
 * connection service, so a profile without that service simply has no route.
 * @param ctx - the plugin context.
 */
export function apply(ctx: WorkbenchContext): void {
  const baseUrl = import.meta.url
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection') as HostConnectionLike | undefined
    if (connection === undefined || typeof connection.fetch?.register !== 'function') return
    scope.effect(
      () => connection.fetch.register(createWorkbenchRoute(() => collectWorkbenchStatus(ctx, baseUrl))),
      'finance-all-in-one: workbench status route',
    )
  })
}
