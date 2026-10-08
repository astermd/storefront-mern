import { IsOptional, IsString } from 'class-validator';

/**
 * The 8 `BuyerDetails` fields, shared by every checkout sub-action DTO (`bump`/`promo`/
 * `promo/remove`/`plan`) — `[27.10]`: every sub-action reposts the whole form so
 * `CheckoutController.rememberBuyer()` can keep what the buyer already typed, even though the
 * sub-action itself only acts on one other field.
 *
 * Every field carries `@IsOptional()` so the global `ValidationPipe`'s `whitelist: true` doesn't
 * silently strip it before it reaches the controller — an undecorated property is treated as
 * unknown and deleted, not merely unvalidated.
 */
export class BuyerContactFieldsDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address_line?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  territory?: string;

  @IsOptional()
  @IsString()
  postal_code?: string;
}
