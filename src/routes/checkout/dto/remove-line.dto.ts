import { IsOptional, IsString } from 'class-validator';
import { BuyerContactFieldsDto } from './buyer-contact-fields.dto';

export class RemoveLineDto extends BuyerContactFieldsDto {
  /** The cart line the summary's remove button names. */
  @IsOptional()
  @IsString()
  remove_slug?: string;
}
