/**
 * Shape of the build-generated `lib/manifest.js`.
 *
 * The data is `package.json`'s — nothing is restated here: the build script
 * copies name, version and dependency specifiers, and `tests/manifest.test.mjs`
 * fails when the emitted module and the manifest disagree.
 */
export declare const manifest: {
  name: string
  version: string
  dependencies: Record<string, string>
}
