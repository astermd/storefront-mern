import { Injectable } from '@nestjs/common';
import { CartGateway } from './cart-gateway';
import { CartMirrorResult } from './cart-mirror-result';

/**
 * Ported from storefront-lamp/core/Emr/NullCartGateway.php. Both methods report `Ok`
 * unconditionally, because a deployment with analytics off must behave exactly like one whose
 * mirror always succeeded — nothing upstream should branch on whether a cart is actually being
 * mirrored.
 */
@Injectable()
export class NullCartGateway implements CartGateway {
  async create(): Promise<CartMirrorResult> {
    return CartMirrorResult.Ok;
  }

  async update(): Promise<CartMirrorResult> {
    return CartMirrorResult.Ok;
  }
}
