/**
 * YAML schema for DSH patch files.
 *
 * `cordis.patch.yml` files carry `!!js` scalars: the loader evaluates them in
 * the profile's own context, where `ctx` is a `URL` for the profile's
 * `cordis.yml` (plus `process`). The default js-yaml schema rejects unknown
 * tags, so both the test suite and any comparison tooling must load patches
 * through this schema. It records the expression source instead of running it,
 * which keeps a test able to compare two patches before anything is evaluated.
 */
import { Type, DEFAULT_SCHEMA } from 'js-yaml'

/** A `!!js` scalar, kept as source text for evaluation at the call site. */
export class JsExpression {
  /** @param {string} source - JavaScript expression text as written in the YAML. */
  constructor(source) {
    this.source = source
  }
}

const js = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: value => typeof value === 'string',
  construct: data => new JsExpression(String(data)),
})

/** Default schema plus the `!!js` tag DSH patch files use. */
export const schema = DEFAULT_SCHEMA.extend([js])
