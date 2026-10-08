import 'express-session';
import { CartSessionData } from '../journey/cart-store';

/**
 * Augments express-session's `SessionData` with what this app stores in the HTTP session itself:
 * the CSRF token (`CsrfMiddleware`) and the cart's working copy + flash notice (`CartStore`).
 * Durable journey state does NOT live here; see `session.middleware.ts`'s doc comment.
 */
declare module 'express-session' {
  interface SessionData {
    _csrf?: string;
    cart?: CartSessionData;
    cart_notice?: string;
  }
}
