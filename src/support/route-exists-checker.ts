import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

interface ExpressRouteLayer {
  route?: { path: string | string[] };
  matchers?: Array<(path: string) => unknown>;
}

/**
 * Ported from storefront-lamp's `AttributionMiddleware`, which consults an injected "does this
 * route exist" closure so a scanner probing for missing assets/URLs never mints an analytics
 * session for it. This port's equivalent: introspect Express's own router to test whether a path
 * matches any *real* registered route, excluding the catch-all fallback (`NotFoundController`'s
 * `@All('*splat')`) — that one matches everything, so including it would make every path "exist".
 *
 * Built lazily and cached: the router isn't fully populated until every module has registered its
 * controllers, which is complete by the time the first real request arrives but not necessarily at
 * this service's own construction time.
 *
 * Deliberately reaches into Express's internal `app.router.stack`/`layer.matchers` shape (there is
 * no public Express API for "would this path match a route without dispatching it"), so every
 * lookup is wrapped: a structural surprise (an Express upgrade that renames these fields) fails
 * *open* — reporting the route as existing — because the cost of that failure mode is "attribution
 * behaves as it always did", while the cost of failing closed would be silently disabling session
 * minting for every real page.
 */
@Injectable()
export class RouteExistsChecker {
  private matchers: Array<(path: string) => unknown> | null = null;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  exists(path: string): boolean {
    const matchers = this.matchersOnce();
    if (matchers === null) return true;

    try {
      return matchers.some((match) => match(path) !== false);
    } catch {
      return true;
    }
  }

  private matchersOnce(): Array<(path: string) => unknown> | null {
    if (this.matchers !== null) return this.matchers;

    try {
      const app = this.adapterHost.httpAdapter.getInstance() as { router?: { stack?: ExpressRouteLayer[] } };
      const stack = app.router?.stack ?? [];

      this.matchers = stack
        .filter((layer) => layer.route !== undefined && layer.matchers !== undefined)
        .filter((layer) => !RouteExistsChecker.isCatchAll(layer.route!.path))
        .flatMap((layer) => layer.matchers!);

      return this.matchers;
    } catch {
      return null;
    }
  }

  /** The fallback route's path names a wildcard segment (e.g. `*splat`) — Express 5's named-wildcard requirement. */
  private static isCatchAll(routePath: string | string[]): boolean {
    const paths = Array.isArray(routePath) ? routePath : [routePath];
    return paths.some((p) => typeof p === 'string' && p.includes('*'));
  }
}
