import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/**
 * Emit `lib/manifest.js` from `package.json`.
 *
 * The host half must report the bundle's version and dependency specifiers at
 * runtime. It cannot resolve its own package through the profile: a `link:`
 * checkout has no `node_modules` above it, and the profile's resolution answers
 * every dependency but never the requester (measured on a clean web profile).
 * Generating the module from the one source of truth keeps the card honest in
 * every install layout — link, registry, npm tarball — with no restated list.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
/**
 * Repository edges are internal-channel packaging details: the public artifact
 * drops them, their plugins are bundled into the internal tarball rather than
 * version-checked, and their names must never appear in a public file. The card
 * therefore sees registry dependencies only.
 */
const REPOSITORY_SPEC = /^(?:git\+|git@|github:|gitlab:|bitbucket:|gist:|https?:|file:|link:|workspace:|path:)/iu
const dependencies = Object.fromEntries(
  Object.entries(manifest.dependencies ?? {}).filter(([, spec]) => !REPOSITORY_SPEC.test(spec)),
)
const payload = {
  name: manifest.name,
  version: manifest.version,
  dependencies,
}
const moduleText = `/** Generated from package.json by scripts/build-manifest.mjs; do not edit. */
export const manifest = ${JSON.stringify(payload, null, 2)}
`
await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'lib/manifest.js'), moduleText)
const declaration = `/** Shape of the build-generated lib/manifest.js; data lives in package.json. */
export declare const manifest: {
  name: string
  version: string
  dependencies: Record<string, string>
}
`
await writeFile(resolve(root, 'lib/manifest.d.ts'), declaration)
