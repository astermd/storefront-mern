/**
 * Ported from storefront-lamp/core/Journey/SessionResolution.php. What `SessionResolver.resolve()`
 * decided for this request. `issueCookie` is the only thing the caller has to act on: the cookie
 * is (re-)sent when a session was just minted, and left alone when the browser already presented
 * the one being used.
 */
export class SessionResolution {
  constructor(
    readonly sessionUuid: string | null,
    readonly issueCookie: boolean = false,
  ) {}
}
