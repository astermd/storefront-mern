import { Injectable } from '@nestjs/common';
import { LeadGateway } from './lead-gateway';

/** Ported from storefront-lamp/core/Forms/NullLeadGateway.php. */
@Injectable()
export class NullLeadGateway implements LeadGateway {
  async create(): Promise<string | null> {
    return null;
  }

  async update(): Promise<boolean> {
    return true;
  }

  writes(): boolean {
    return false;
  }
}
