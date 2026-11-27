import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copy the browser half into `lib/`.
 *
 * The source is already the module-loader factory format (`window.__ModuleLoader__.load`),
 * so this is a copy plus two guards: a missing `./client` entry in `exports` and an
 * `id` that disagrees with the package name both make the browser half silently
 * invisible at runtime, which no test of the host half would catch.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.exports?.['./client'] === undefined) {
  throw new Error('build-client: package.json declares no "./client" export')
}
const source = await readFile(resolve(root, 'src/client/index.js'), 'utf8')
if (!source.includes(`id: '${manifest.name}'`)) {
  throw new Error(`build-client: src/client/index.js must register id '${manifest.name}'`)
}
await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'lib/client.js'), source)
