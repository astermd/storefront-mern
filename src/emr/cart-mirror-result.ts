/**
 * Ported from storefront-lamp/core/Emr/CartMirrorResult.php. The three outcomes of one mirror
 * call, kept distinct because the caller treats them differently: `NotFound` is the only one
 * that's recoverable on the spot (the remote cart is gone, so create it), while `Failed` is logged
 * and swallowed (`[7.12]`).
 */
export enum CartMirrorResult {
  Ok = 'ok',
  NotFound = 'not_found',
  Failed = 'failed',
}
