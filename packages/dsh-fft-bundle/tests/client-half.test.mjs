/**
 * The browser half is a static module the host's module scan loads by package
 * name: a wrong `id`, a missing `apply`, or a card registered on the wrong slot
 * is silently invisible at runtime (no error, no card). These assertions run the
 * built bundle against a minimal fake module loader and a fake renderer context,
 * so the wiring is checked without a DSH install.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Hooks the card calls during the loading phase; effects stay inert. */
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
  }
}

/** Execute the browser bundle and return the captured module-loader spec. */
function loadClient(language = 'zh-CN') {
  let spec
  const fakeWindow = { __ModuleLoader__: { load: candidate => { spec = candidate } } }
  const require = id => {
    if (id === 'react') return fakeReact()
    throw new Error(`unexpected require: ${id}`)
  }
  // `navigator` is a parameter so the card's language decision is deterministic.
  new Function('window', 'require', 'navigator', source)(fakeWindow, require, { language })
  assert.ok(spec, 'module loader was not called')
  return spec
}

/** Collect every string in a rendered element tree. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  return [].concat(textOf(node.children))
}

describe('browser half', () => {
  it('registers under the package name and declares the slots dependency', () => {
    const spec = loadClient()
    assert.equal(spec.id, manifest.name)
    const exportsObject = spec.factory(id => {
      if (id === 'react') return fakeReact()
      throw new Error(`unexpected require: ${id}`)
    })
    assert.equal(typeof exportsObject.apply, 'function')
    assert.ok(exportsObject.inject.includes('slots'))
  })

  it('contributes one card to the existing FT settings page', () => {
    const spec = loadClient()
    const exportsObject = spec.factory(id => {
      if (id === 'react') return fakeReact()
      throw new Error(`unexpected require: ${id}`)
    })
    const registrations = []
    const injections = []
    const ctx = {
      slots: {
        inject: (key, callback) => {
          injections.push(key)
          callback()
        },
        register: (options, component) => {
          registrations.push({ key: options.name, options, component })
        },
      },
    }
    exportsObject.apply(ctx)
    assert.deepEqual(injections, ['ftshare.settings.card'])
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].key, 'ftshare.settings.card')
    assert.equal(registrations[0].options.id, 'workbench')
    // Sits between the API Key card (10) and the request log card (20).
    assert.equal(registrations[0].options.order, 15)
    assert.equal(typeof registrations[0].component, 'function')
  })

  it('renders its loading state without touching the network', () => {
    const spec = loadClient()
    const exportsObject = spec.factory(id => {
      if (id === 'react') return fakeReact()
      throw new Error(`unexpected require: ${id}`)
    })
    const registered = []
    exportsObject.apply({
      slots: {
        inject: (key, callback) => callback(),
        register: (options, component) => registered.push(component),
      },
    })
    const text = textOf(registered[0]()).join(' ')
    assert.match(text, /金融工作台/u)
    assert.match(text, /正在读取/u)
    // The card must never show what it has not read.
    assert.doesNotMatch(text, /全部就绪/u)
  })

  it('reads the route constant the host half exports', async () => {
    const host = await import('../lib/index.js')
    assert.match(source, new RegExp(host.WORKBENCH_ROUTE.replaceAll('/', '\\/'), 'u'))
  })
})
