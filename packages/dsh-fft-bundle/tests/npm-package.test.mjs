/**
 * The npm tarballs are not the repository manifests: `pnpm pack:npm` rewrites
 * every intra-repo `git+…#path:` edge into `^<workspace version>` before
 * packing, so a default profile can install the package without `git`, ssh or
 * `blockExoticSubdeps`. These tests pin the rewrite (pure function, no packing)
 * and the manifest metadata the registry listing and the market index rely on.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLISH_TARGETS, publishManifest, readWorkspace, repoRoot } from '../../../scripts/pack-npm.mjs'

const workspace = readWorkspace()
const targetsOf = () => PUBLISH_TARGETS.map(target => ({ target, manifest: JSON.parse(readFileSync(join(repoRoot, target.dir, 'package.json'), 'utf8')) }))

describe('publish targets', () => {
  it('exist and resolve through the workspace manifest', () => {
    for (const { target, manifest } of targetsOf()) {
      assert.ok(workspace.has(manifest.name), `${target.dir} declares ${manifest.name}, which the workspace does not list`)
    }
  })

  it('carry the metadata an npm listing and the market index need', () => {
    for (const { target, manifest } of targetsOf()) {
      assert.equal(manifest.publishConfig?.access, 'public', `${manifest.name}: publishConfig.access must be public`)
      assert.equal(manifest.license, 'MIT', `${manifest.name}: license is required on a public package`)
      assert.ok((manifest.description ?? '').length > 0, `${manifest.name}: description is required`)
      assert.equal(manifest.repository?.directory, target.dir, `${manifest.name}: repository.directory must name its sub-directory`)
      assert.match(manifest.repository?.url ?? '', /^git\+https:\/\//u, `${manifest.name}: repository.url must be a public clone URL`)
      assert.ok((manifest.files ?? []).includes('LICENSE'), `${manifest.name}: files must ship LICENSE`)
      assert.ok((manifest.files ?? []).includes('cordis.patch.yml'), `${manifest.name}: files must ship the patch layer`)
      assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', `${manifest.name}: dsh.bundle.patch is what makes it installable as a layer`)
    }
  })
})

describe('published manifest', () => {
  it('drops every intra-repo edge and never leaves an exotic spec behind', () => {
    for (const { target, manifest } of targetsOf()) {
      const published = publishManifest(manifest, { workspace, dropDependencies: target.dropDependencies })
      for (const [name, spec] of Object.entries(published.dependencies ?? {})) {
        assert.doesNotMatch(spec, /^(?:git\+|git@|github:|gitlab:|https?:|file:|link:|workspace:)/iu, `${published.name}: ${name}@${spec} cannot install from a default profile`)
        assert.doesNotMatch(spec, /&path:/u, `${published.name}: ${name}@${spec} still carries a sub-directory edge`)
      }
      assert.equal(published.publishConfig?.access, 'public')
    }
  })

  it('resolves a workspace dependency to the caret range of its workspace version', () => {
    for (const { manifest } of targetsOf()) {
      for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
        const dependency = workspace.get(name)
        if (dependency === undefined) continue
        const published = publishManifest(manifest, { workspace, dropDependencies: [] })
        if ((published.dependencies ?? {})[name] === undefined) continue
        assert.equal(published.dependencies[name], `^${dependency.manifest.version}`, `${manifest.name}: ${name} must become a caret range`)
      }
    }
  })

  it('drops only the edges a package needs for its own build', () => {
    const ftshare = targetsOf().find(entry => entry.manifest.name === '@dsh-ft/dsh-fft-ftshare')
    assert.ok(ftshare !== undefined, 'ftshare must be a publish target')
    assert.ok(
      (ftshare.manifest.dependencies ?? {})['@dsh-ft/dsh-fft-settings'] !== undefined,
      'ftshare still needs the settings types in this repository',
    )
    const published = publishManifest(ftshare.manifest, { workspace, dropDependencies: ftshare.target.dropDependencies })
    assert.equal((published.dependencies ?? {})['@dsh-ft/dsh-fft-settings'], undefined, 'the type-only settings edge must not ship')
    assert.equal(published.dependencies['@modelcontextprotocol/sdk'], ftshare.manifest.dependencies['@modelcontextprotocol/sdk'], 'registry dependencies keep their range')
  })

  it('keeps the export map, bundle layer and engines of the source manifest', () => {
    for (const { target, manifest } of targetsOf()) {
      const published = publishManifest(manifest, { workspace, dropDependencies: target.dropDependencies })
      assert.deepEqual(published.exports, manifest.exports, `${manifest.name}: exports must survive`)
      assert.deepEqual(published.dsh, manifest.dsh, `${manifest.name}: dsh must survive`)
      assert.deepEqual(published.engines, manifest.engines)
      assert.equal(published.scripts, undefined, 'repository-only scripts stay out of the tarball')
      assert.equal(published.devDependencies, undefined, 'repository-only dev dependencies stay out of the tarball')
    }
  })
})

describe('rewrite safety', () => {
  const base = { name: '@x/y', version: '1.0.0' }

  it('bumps a workspace edge to the workspace version', () => {
    const published = publishManifest(
      { ...base, dependencies: { '@dsh-ft/dsh-fft-settings': 'git+ssh://git@example.invalid/repo.git#v1.0.0&path:packages/a' } },
      { workspace },
    )
    assert.equal(published.dependencies['@dsh-ft/dsh-fft-settings'], `^${workspace.get('@dsh-ft/dsh-fft-settings').manifest.version}`)
  })

  it('refuses an edge that only resolves through git, a URL or the filesystem', () => {
    for (const spec of [
      'git+ssh://git@example.invalid/repo.git#v1.0.0',
      'https://example.invalid/pkg.tgz',
      'file:../other',
      'link:../other',
      'workspace:*',
    ]) {
      assert.throws(
        () => publishManifest({ ...base, dependencies: { 'some-registry-pkg': spec } }, { workspace }),
        /not registry-resolvable/u,
        `${spec} must be rejected`,
      )
    }
  })
})
