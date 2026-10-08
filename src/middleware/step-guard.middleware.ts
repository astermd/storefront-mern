import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Cart } from '../domain/cart';
import { StepRouter } from '../domain/step-router';
import { STEP_ROUTER } from '../core/tokens';
import { FlowDefinition } from '../funnel/flow-definition';
import { StepPreconditions } from '../funnel/step-preconditions';
import { CartStoreFactory } from '../journey/cart-store-factory';
import { JourneyState } from '../journey/journey-state';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { OperatorLog } from '../support/operator-log';
import { Url } from '../support/url';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/StepGuardMiddleware.php. Enforces step
 * preconditions in one place rather than page by page (`[22.11]`), which closes `[8.6]`
 * structurally: no funnel template carries a guard of its own.
 *
 * Steps are matched by **path** from the flow definition, not by route argument, because this
 * middleware runs before Nest's own routing — there is no matched route to read yet. That keeps
 * the flow expressed as data instead of as annotations scattered over the route table.
 *
 * The redirect target is the routing decision (`[8.1]`), not "the first step with unmet
 * preconditions" — with an empty cart every funnel step is unsatisfied, and walking the list would
 * bounce the visitor forever. When the routing decision names the step the visitor is already on,
 * the guard fails closed to the flow's entry step and logs `funnel.guard_self_redirect`: a flow
 * whose routing decision points at a step that can't satisfy its own requirements is a defect, and
 * serving the unguarded page is never the safe branch.
 *
 * **Deliberately a Nest middleware, never a `CanActivate` guard** — see
 * `journey-save-back.middleware.ts`'s doc comment for why: a Nest guard runs in a fixed position
 * after all middleware, so a guard-based redirect here would never let `JourneySaveBackMiddleware`
 * (slot 7, wrapping this one) flush the journey state this decision was made against.
 *
 * Pinned slot 8 of 9.
 */
@Injectable()
export class StepGuardMiddleware implements NestMiddleware {
  constructor(
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly flow: FlowDefinition,
    @Inject(STEP_ROUTER) private readonly router: StepRouter,
    private readonly preconditions: StepPreconditions,
    private readonly log: OperatorLog,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'stepGuard');

    const path = Url.canonicalizePath(req.path);
    const step = this.flow.stepForPath(path);
    const requirements = step === null ? [] : this.flow.requirementsFor(step);

    if (requirements.length > 0) {
      const stores = this.resolveStores(path);

      if (stores !== null) {
        const { cart, state } = stores;

        for (const requirement of requirements) {
          if (this.preconditions.satisfied(requirement, cart, state)) {
            continue;
          }

          let target = this.flow.pathFor(this.router.nextStep(cart, state));

          // A routing decision naming the step the visitor is already on cannot be followed, and
          // must not be ignored either — falling through serves a page whose precondition is
          // unmet. Fail closed to the entry step instead, and say so: the flow definition and the
          // routing decision disagree (`[22.11]`).
          if (target === path) {
            this.log.warning('funnel.guard_self_redirect', { step, path, requirement });
            target = this.flow.pathFor(FlowDefinition.ENTRY_STEP);

            // The entry step failing its own requirement has nowhere safe to go — redirecting
            // would loop. Serving it is the lesser failure: it's a public page, not a guarded one.
            if (target === path) {
              break;
            }
          }

          res.redirect(302, target);
          return;
        }
      }
    }

    next();
  }

  /**
   * Null when the stores couldn't be built at all. The caller must not fall back to evaluating
   * preconditions against a fabricated empty cart — the visitor's real cart lives in the session
   * regardless of what the database is doing, and treating it as empty would bounce someone who
   * has every right to be on this page. Degrades silently and logs it (`[20.1]`).
   */
  private resolveStores(path: string): { cart: Cart; state: JourneyState | null } | null {
    try {
      const cart = this.cartStoreFactory.get().currentCart();
      const state = this.journeyStoreFactory.get().currentState();
      return { cart, state };
    } catch (e) {
      this.log.warning('funnel.guard_unavailable', {
        path,
        reason: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }
}
