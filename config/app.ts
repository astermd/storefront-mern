/**
 * Ported from storefront-lamp/config/app.php. Client-owned, not `src/` — a real deployment may
 * edit this file directly.
 *
 * `env` is `NODE_ENV`, replacing the PHP original's `APP_ENV` — this port's one deliberate
 * renaming of an environment discriminator, made because it's the Node-ecosystem-idiomatic name
 * and because `NODE_ENV=test` is what every Nest testing tool already reads. Everything
 * downstream (`session.analytics`, `seo.discourageIndexing`, ...) still keys off it exactly the
 * way the PHP original keys off `APP_ENV`.
 */
export interface AppConfig {
  name: string;
  url: string;
  env: string;
  database: {
    /** PDO's driver names ('sqlite'/'mysql'/'pgsql') translated to Kysely's ('postgres' not 'pgsql'). */
    driver: 'sqlite' | 'mysql' | 'postgres';
    database: string;
    host: string;
    port: number | null;
    username: string | null;
    password: string | null;
  };
  emr: {
    baseHost: string;
    channelId: string | null;
  };
  /** Where a patient signs in to see their own records — absent means render no link at all. */
  portal: {
    url: string | null;
  };
  session: {
    cookie: string;
    resumeParam: string;
    lifetimeDays: number;
    excludePaths: string[];
    /**
     * Gates the whole EMR gateway family (Session/Cart/Teleform/Intake/Lead). In this build every
     * one of those ports is bound to its Null implementation regardless of this flag's value — no
     * real EMR client exists yet — but the flag and its NODE_ENV=test-forces-false rule are kept
     * so a future real integration is a provider swap, not a rewiring.
     */
    analytics: boolean;
  };
  attribution: {
    payloadParam: string;
    key: string | null;
    previousKey: string | null;
  };
  seo: {
    siteName: string;
    titleTemplate: string;
    defaultTitle: string;
    defaultDescription: string;
    socialImage: string | null;
    /** `[24.7]`'s master switch — true marks every route noindex, regardless of any per-route rule. */
    discourageIndexing: boolean;
    /** Canonical path (or `prefix*`) -> robots directive. Also excludes the path from the sitemap. */
    robotsRules: Record<string, string>;
    structuredData: {
      organisation: boolean;
      website: boolean;
      product: boolean;
      breadcrumbs: boolean;
      /** `[24.10]` — conservative default: no structured data for rx products until told otherwise. */
      rx: boolean;
    };
    searchUrlTemplate: string | null;
    aiCrawlers: {
      allow: boolean;
      agents: string[];
    };
  };
  features: {
    shippingSelector: boolean;
    wallets: boolean;
    googleMapsApiKey: string | null;
    /**
     * The checkout-time email-deliverability check against the EMR, switched on its own — distinct
     * from `verification.enabled`. `EMR_VERIFICATION`, the single switch this replaced, still sets
     * it when `EMR_VERIFY_EMAIL` is not given.
     */
    emrVerifyEmail: boolean;
    /** The checkout-time address check against the EMR; same fallback to `EMR_VERIFICATION` as `emrVerifyEmail`. */
    emrVerifyAddress: boolean;
    /**
     * Checkout's address suggestions. Not a switch a deployment sets: with `GOOGLE_MAPS_API_KEY`
     * the browser asks Google, and without one the storefront asks the EMR. Off only under the test
     * suite, so no test run can reach the EMR.
     */
    addressAutofill: boolean;
  };
  debug: {
    /** Never true in a deployment taking real payments — see storefront-lamp's config/app.php. */
    wireLog: boolean;
  };
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'on', 'yes'].includes(value.toLowerCase());
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'production';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  return {
    name: 'AsterMD',
    url: env.APP_URL ?? 'http://localhost:8080',
    env: nodeEnv,

    database: {
      driver: (env.DB_DRIVER as AppConfig['database']['driver']) ?? 'sqlite',
      database: env.DB_DATABASE ?? 'storage/database/app.sqlite3',
      host: env.DB_HOST ?? '127.0.0.1',
      port: env.DB_PORT ? Number(env.DB_PORT) : null,
      username: env.DB_USERNAME ?? null,
      password: env.DB_PASSWORD ?? null,
    },

    emr: {
      baseHost: env.ASTERMD_BASE_HOST ?? 'api.astermd.com',
      channelId: env.ASTERMD_CHANNEL_ID ?? null,
    },

    portal: {
      url: env.PATIENT_PORTAL_URL ?? null,
    },

    session: {
      cookie: 'amd_session',
      resumeParam: 'amd_session',
      lifetimeDays: 30,
      excludePaths: ['/health/'],
      // Matches storefront-lamp's config/app.php exactly: on everywhere except under the test
      // suite, with no separate on/off knob — never trust a stray config value to keep a test
      // run off the network.
      analytics: !isTest,
    },

    attribution: {
      payloadParam: '_amd',
      key: env.AMD_TRACKING_KEY ?? null,
      previousKey: env.AMD_TRACKING_KEY_PREVIOUS ?? null,
    },

    seo: {
      siteName: 'AsterMD',
      titleTemplate: '%s — AsterMD',
      defaultTitle: 'AsterMD — A Smarter Path to Longevity & Wellness',
      defaultDescription:
        'Connect with licensed physicians in minutes. Personalized care plans, seamless prescriptions, and ongoing support for your well-being.',
      socialImage: null,
      discourageIndexing: !isProduction,
      robotsRules: {
        '/intake/*': 'noindex, nofollow',
        '/verify/': 'noindex, nofollow',
        '/checkout/*': 'noindex, nofollow',
        '/upsell/*': 'noindex, nofollow',
        '/thank-you/': 'noindex, nofollow',
        '/not-eligible/': 'noindex, nofollow',
        '/cart/*': 'noindex, nofollow',
        '/health/': 'noindex',
      },
      structuredData: {
        organisation: true,
        website: true,
        product: true,
        breadcrumbs: true,
        rx: false,
      },
      searchUrlTemplate: null,
      aiCrawlers: {
        allow: true,
        agents: ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'],
      },
    },

    features: {
      shippingSelector: false,
      wallets: false,
      googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? null,
      emrVerifyEmail: !isTest && bool(env.EMR_VERIFY_EMAIL ?? env.EMR_VERIFICATION, false),
      emrVerifyAddress: !isTest && bool(env.EMR_VERIFY_ADDRESS ?? env.EMR_VERIFICATION, false),
      addressAutofill: !isTest,
    },

    debug: {
      wireLog: bool(env.WIRE_LOG, false),
    },
  };
}
