import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { CartStore } from './cart-store';
import { JourneyStoreFactory } from './journey-store-factory';

/**
 * Request-scoped access to the current request's `CartStore` — mirrors `JourneyStoreFactory`'s
 * shape (see its doc comment). Depends on `JourneyStoreFactory` (also `Scope.REQUEST`) so both
 * share the same `JourneyStore` instance for the lifetime of one request.
 */
@Injectable({ scope: Scope.REQUEST })
export class CartStoreFactory {
  private store: CartStore | null = null;

  constructor(
    private readonly journeyStoreFactory: JourneyStoreFactory,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  get(): CartStore {
    if (this.store === null) {
      this.store = new CartStore(this.journeyStoreFactory.get(), this.request.session);
    }
    return this.store;
  }
}
