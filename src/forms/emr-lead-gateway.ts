import { Injectable } from '@nestjs/common';
import { ApiError } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../emr/client-factory';
import { OperatorLog } from '../support/operator-log';
import { LeadGateway } from './lead-gateway';

/**
 * Ported from storefront-lamp/core/Forms/EmrLeadGateway.php. {@link LeadGateway} over the SDK's
 * `opportunities()` resource.
 *
 * Never logs payload values — only field *names* (`array_keys($payload)`), since the payload is a
 * mapped clinical record.
 */
@Injectable()
export class EmrLeadGateway implements LeadGateway {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async create(payload: Record<string, unknown>): Promise<string | null> {
    let data: Record<string, unknown>;
    try {
      const response = await this.clients.create().opportunities().create(payload);
      data = response.data() as Record<string, unknown>;
    } catch (e) {
      this.log.warning('intake.lead_request_failed', {
        operation: 'create',
        fields: Object.keys(payload),
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return null;
    }

    const id = EmrLeadGateway.identifier(data);
    if (id === null) {
      this.log.error('intake.lead_id_missing', { response_keys: Object.keys(data) });
    }
    return id;
  }

  async update(opportunityId: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      await this.clients.create().opportunities().update(opportunityId, payload);
      return true;
    } catch (e) {
      this.log.warning('intake.lead_request_failed', {
        operation: 'update',
        opportunity_id: opportunityId,
        fields: Object.keys(payload),
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return false;
    }
  }

  writes(): boolean {
    return true;
  }

  private static identifier(data: Record<string, unknown>): string | null {
    for (const key of ['_id', 'id']) {
      const value = data[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return null;
  }
}
