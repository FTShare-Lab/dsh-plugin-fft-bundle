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
    const inRepo = '@ft/dsh-fft-research-cockpit'
    const published = publishManifest(
      { ...base, dependencies: { [inRepo]: `git+ssh://git@example.invalid/repo.git#v1.0.0&path:packages/${inRepo.split('/')[1]}` } },
      { workspace },
    )
    assert.equal(published.dependencies[inRepo], `^${workspace.get(inRepo).manifest.version}`)
  })

  it('never links a published package of another repository', () => {
    // settings and ftshare are consumed as exact registry versions, exactly as a
    // user installs them. Linking the dsh-fft-base sources in instead would give
    // their `@deepseek-ai/cordis` a second module identity and silently break the
    // `interface Context` augmentations this repository's packages rely on.
    const workspaceYaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
    for (const name of ['@dsh-ft/dsh-fft-settings', '@dsh-ft/dsh-fft-ftshare']) {
      const pattern = new RegExp(`'${name.replace('/', '\\/')}':\\s*link:`, 'u')
      assert.doesNotMatch(workspaceYaml, pattern, `${name} must come from the registry, not from a workspace link`)
    }
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
