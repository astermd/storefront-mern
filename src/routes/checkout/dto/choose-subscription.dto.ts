import { IsObject, IsOptional } from 'class-validator';
import { BuyerContactFieldsDto } from './buyer-contact-fields.dto';

export class ChooseSubscriptionDto extends BuyerContactFieldsDto {
  /** `subscription[<slug>]=<plan id>`, posted by the selector naming its own line. */
  @IsOptional()
  @IsObject()
  subscription?: Record<string, string>;
}
