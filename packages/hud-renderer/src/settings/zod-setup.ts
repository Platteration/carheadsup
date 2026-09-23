import { config } from 'zod';

/**
 * Turn zod's JIT off before any schema is built. When `z.object()` builds a schema, zod probes
 * whether `new Function` works so it can compile a faster parser. The HUD serves its pages with
 * `script-src 'self'` (no eval), so the probe is refused and reported as a CSP violation on every
 * load of the settings app, although zod swallows the error. The shared config schema is small
 * and validated at typing speed, so the interpreted parser costs nothing noticeable.
 *
 * Imported for its side effect as the settings entry's first import: ES modules run in import
 * order, so this runs before `@carheadsup/core` builds its schemas.
 */
config({ jitless: true });
