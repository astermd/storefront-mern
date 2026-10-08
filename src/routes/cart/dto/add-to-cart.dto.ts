import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Shape/type validation for `POST /cart/add/` at the HTTP boundary — additive to, not a
 * replacement for, `CartRules.add()`'s own business rules (unknown product, geo block, rx
 * replacement, ...), which still run in the controller exactly as ported. See MERN.md's note on
 * DTOs. Deliberately does *not* validate `quantity` as strictly-required — `CartRules.add()`
 * already clamps/defaults it — this DTO's job is only to reject a request whose body doesn't even
 * have the right shape before it reaches domain logic.
 */
export class AddToCartDto {
  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  variant_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  return_to?: string;

  /** Read by `CartController.add()` to bypass funnel-optimal routing straight to checkout. */
  @IsOptional()
  @IsIn(['assessment', 'checkout'])
  intent?: string;
}
