/**
 * Ported from storefront-lamp/config/intake.php — the intake step: which renderer draws the form,
 * where the hosted engine's assets live, and how long a fetched definition is trusted.
 *
 * `renderer`:
 *   'js-engine' — embed the definition and let the hosted engine render it.
 *   'server'    — the storefront renders every page from the same definition.
 *
 * The definition cache is keyed on the teleform's `form_json_identifier`, which carries the form's
 * version and publish time, so republishing a form is already a cache miss. `cache.ttlSeconds` is
 * only a backstop for a definition that was never republished but should be re-read anyway.
 *
 * `disqualification` is a fallback, not the source of truth: rules are read from the form
 * definition itself, where they are authored as alert fields revealed by a condition. An entry
 * here is consulted only for a teleform whose definition declares none.
 */
export interface ConfiguredDisqualificationRule {
  id?: string;
  mode?: string;
  message?: string;
  logic?: string;
  rules: Record<string, unknown>[];
}

export interface IntakeConfig {
  renderer: 'server' | 'js-engine';
  cache: {
    ttlSeconds: number;
  };
  engine: {
    css: string;
    js: string;
  };
  disqualification: Record<string, ConfiguredDisqualificationRule[]>;
}

export function loadIntakeConfig(env: NodeJS.ProcessEnv): IntakeConfig {
  return {
    renderer: env.INTAKE_RENDERER === 'js-engine' ? 'js-engine' : 'server',
    cache: {
      ttlSeconds: 86400,
    },
    // A declared exception to the local-asset rule, alongside provider-hosted payment fields: the
    // engine is versioned and served by the EMR vendor, and pinning a local copy would silently
    // diverge from the definitions it is built to render.
    engine: {
      css: 'https://cdn.astermd.com/js-engine/form.min.css',
      js: 'https://cdn.astermd.com/js-engine/form.min.js',
    },
    disqualification: {
      // '<teleform-id>': [
      //   {
      //     id: 'pregnancy',
      //     mode: 'hard',
      //     message: 'We are unable to prescribe this treatment during pregnancy.',
      //     logic: 'and',
      //     rules: [{ field: 'pregnancy_status', operator: 'equals', value: 'yes' }],
      //   },
      // ],
    },
  };
}
