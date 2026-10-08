import { IsOptional, IsString } from 'class-validator';
import { BuyerContactFieldsDto } from './buyer-contact-fields.dto';

export class ApplyPromoDto extends BuyerContactFieldsDto {
  @IsOptional()
  @IsString()
  discount_code?: string;
}
