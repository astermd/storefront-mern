import { IsOptional, IsString } from 'class-validator';
import { BuyerContactFieldsDto } from './buyer-contact-fields.dto';

export class ToggleBumpDto extends BuyerContactFieldsDto {
  @IsOptional()
  @IsString()
  bump_slug?: string;
}
