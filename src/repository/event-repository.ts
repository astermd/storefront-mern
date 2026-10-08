import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';

/**
 * Ported from storefront-lamp/core/Repository/EventRepository.php — the local, append-only audit
 * trail (`events` table). `CartMirror` (Phase 5) is its first real writer in this port.
 */
@Injectable()
export class EventRepository {
  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  async append(sessionUuid: string, name: string, payload: Record<string, unknown> = {}): Promise<void> {
    await this.prisma.event.create({
      data: {
        sessionUuid,
        name,
        payload: JSON.stringify(payload),
        createdAt: new Date().toISOString(),
      },
    });
  }

  async hasName(sessionUuid: string, name: string): Promise<boolean> {
    const row = await this.prisma.event.findFirst({ where: { sessionUuid, name }, select: { id: true } });
    return row !== null;
  }

  async namesFor(sessionUuid: string): Promise<string[]> {
    const rows = await this.prisma.event.findMany({ where: { sessionUuid }, select: { name: true } });
    return rows.map((r) => r.name);
  }
}
