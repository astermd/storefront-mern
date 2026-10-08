import { IsOptional, IsString } from 'class-validator';

/** Shape validation for `POST /cart/remove/` — see add-to-cart.dto.ts's note. */
export class RemoveFromCartDto {
  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  return_to?: string;
}
