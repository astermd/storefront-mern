import { Injectable } from '@nestjs/common';
import { LeadGateway } from './lead-gateway';

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
