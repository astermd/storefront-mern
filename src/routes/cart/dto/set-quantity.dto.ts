import { IsOptional, IsString } from 'class-validator';

/**
 * Shape validation for `POST /cart/quantity/`. `quantity` is deliberately left unvalidated here —
 * unlike `add`/`remove`, a non-numeric quantity is a **business rule with a user-facing answer**
 * in the PHP original (`CartController::quantity()` flashes "Enter a valid quantity." and
 * 303-redirects, it never 400s), so the numeric check stays in `CartController` itself rather
 * than becoming a DTO validation failure that would change the response shape entirely.
 */
export class SetQuantityDto {
  @IsString()
  slug!: string;

  quantity?: unknown;

  @IsOptional()
  @IsString()
  return_to?: string;
}
