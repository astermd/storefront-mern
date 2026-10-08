import { IsObject, IsOptional, IsString } from 'class-validator';
import { BuyerContactFieldsDto } from './buyer-contact-fields.dto';

export class ChoosePlanDto extends BuyerContactFieldsDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  variant_id?: string;

  /** `plan[<slug>]=<variant>`, posted by a picker naming its own prescription (`[8.0f]`). */
  @IsOptional()
  @IsObject()
  plan?: Record<string, string>;
}
