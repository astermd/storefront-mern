import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Shape validation for `POST /checkout/` at the HTTP boundary. Deliberately loose (`@IsOptional()`
 * everywhere, nothing required) — `BuyerValidator`/`CardNumber`/`Consents` are the real validators
 * and produce the buyer-facing, field-keyed errors the page shows; a DTO 400 here would bypass that
 * error-rendering path entirely for the one endpoint where it matters most.
 *
 * **Every field needs a decorator, even an unenforced one.** The global `ValidationPipe` runs with
 * `whitelist: true`, which strips any property with *no* validation decorator at all before it ever
 * reaches the controller — an undecorated field isn't "unvalidated", it's silently deleted, which
 * once emptied every field on this exact DTO.
 */
export class SubmitCheckoutDto {
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

  @IsOptional()
  @IsString()
  card_number?: string;

  @IsOptional()
  @IsString()
  card_expiry?: string;

  @IsOptional()
  @IsString()
  card_cvc?: string;

  /** A token the provider's own script minted in place of a card (`[15.1]`). */
  @IsOptional()
  @IsString()
  payment_token?: string;

  @IsOptional()
  @IsObject()
  consents?: Record<string, unknown>;
}
