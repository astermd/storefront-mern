import type * as http from 'node:http';

// `import * as http from 'node:http'` goes through TypeScript's ESM-interop namespace wrapper,
// which copies each export behind a getter-only property on a fresh object — fine for reading, but
// `request` can never be reassigned or redefined on it. `require()` returns Node's real,
// genuinely-mutable module object instead, which is what actually needs patching here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule: typeof http = require('node:http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpsModule: typeof http = require('node:https');

/**
 * Defense-in-depth for the port's own invariant ("no test reaches the network" — see STATUS.md's
 * Test status section): every EMR/payment gateway already refuses network access under
 * `NODE_ENV=test` on its own (`NullSessionGateway`/`NullCartGateway`/etc. for the EMR family;
 * `RefusingTransport`/`CheckoutChampRefusingTransport` for Vrio/CheckoutChamp), so this guard should
 * never actually fire in a correctly-written test. It exists to turn a *future* test that
 * accidentally bypasses one of those seams (e.g. constructing a real adapter without wiring its
 * test-environment transport) into an immediate, loud failure at the call site, rather than a slow
 * hang or a real HTTP request silently leaving the process.
 *
 * Loopback traffic is allowed unconditionally — supertest binds a real ephemeral TCP server and
 * talks to it over `127.0.0.1`/`::1`/`localhost`, and several specs (`checkout-to-receipt`,
 * `checkout-submit`, `middleware-pipeline`) depend on that working normally.
 */
const ALLOWED_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopback(hostname: string | null | undefined): boolean {
  return typeof hostname === 'string' && ALLOWED_HOSTS.has(hostname.toLowerCase());
}

function refuse(url: string): never {
  throw new Error(
    `Blocked a real network call to "${url}" from a test. Every EMR/payment gateway is expected to be ` +
      'Null-bound or transport-refused under NODE_ENV=test — override the DI token or the adapter\'s ' +
      'transport with a fake instead of letting this reach the network. See test/support/no-network.ts.',
  );
}

export function installNoNetworkGuard(): void {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url: string }).url;
      const hostname = safeHostname(url);
      if (!isLoopback(hostname)) refuse(url);
      return originalFetch(input, init);
    }) as typeof fetch;
  }

  for (const [moduleRef, moduleName] of [
    [httpModule, 'http'],
    [httpsModule, 'https'],
  ] as const) {
    const originalRequest = moduleRef.request;
    moduleRef.request = ((...args: Parameters<typeof http.request>) => {
      const hostname = requestHostnameFrom(args);
      if (!isLoopback(hostname)) refuse(`${moduleName}://${hostname ?? '(unknown host)'}`);
      return originalRequest(...args);
    }) as typeof http.request;
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function requestHostnameFrom(args: unknown[]): string | null {
  const first = args[0];

  if (typeof first === 'string') return safeHostname(first);
  if (first instanceof URL) return first.hostname;
  if (first !== null && typeof first === 'object') {
    const options = first as { hostname?: string; host?: string };
    return options.hostname ?? options.host ?? null;
  }

  return null;
}
