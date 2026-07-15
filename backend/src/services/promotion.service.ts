import { Prisma, PromotionKind } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ActivePromo } from './pricing';

export type PromotionBody = {
  name?: string;
  startDate?: string;          // 'YYYY-MM-DD' (heure locale du club)
  endDate?: string;
  kind?: 'PERCENT' | 'FIXED';
  percentOff?: number | null;
  fixedPrice?: number | null;  // euros
  windowStart?: number | null; // minutes depuis minuit
  windowEnd?: number | null;
  enabled?: boolean;
  resourceIds?: string[];
};

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayUTC = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Ligne Prisma (avec resources incluses) → DTO sérialisable pour le front. */
function toDTO(p: {
  id: string; clubId: string; name: string; startDate: Date; endDate: Date;
  windowStart: number | null; windowEnd: number | null; kind: PromotionKind;
  percentOff: number | null; fixedPrice: Prisma.Decimal | null; enabled: boolean;
  createdAt: Date; resources: { resourceId: string }[];
}) {
  return {
    id: p.id, clubId: p.clubId, name: p.name,
    startDate: ymd(p.startDate), endDate: ymd(p.endDate),
    windowStart: p.windowStart, windowEnd: p.windowEnd,
    kind: p.kind, percentOff: p.percentOff,
    fixedPrice: p.fixedPrice != null ? p.fixedPrice.toFixed(2) : null,
    enabled: p.enabled, resourceIds: p.resources.map((r) => r.resourceId),
    createdAt: p.createdAt.toISOString(),
  };
}

/** Promo Prisma → ActivePromo (pour le pricing). */
function toActivePromo(p: {
  name: string; kind: PromotionKind; percentOff: number | null; fixedPrice: Prisma.Decimal | null;
  windowStart: number | null; windowEnd: number | null; resources: { resourceId: string }[];
}): ActivePromo {
  return {
    name: p.name, kind: p.kind, percentOff: p.percentOff,
    fixedPriceCents: p.fixedPrice != null ? Math.round(Number(p.fixedPrice) * 100) : null,
    windowStart: p.windowStart, windowEnd: p.windowEnd,
    resourceIds: p.resources.map((r) => r.resourceId),
  };
}

/** Promotions actives d'un club pour une date locale ('YYYY-MM-DD'). Filtre enabled + période. */
export async function loadActivePromotions(clubId: string, localDate: string): Promise<ActivePromo[]> {
  if (!isYmd(localDate)) return [];
  const day = dayUTC(localDate);
  const rows = await prisma.promotion.findMany({
    where: { clubId, enabled: true, startDate: { lte: day }, endDate: { gte: day } },
    include: { resources: { select: { resourceId: true } } },
  });
  return rows.map(toActivePromo);
}

export class PromotionService {
  async listPromotions(clubId: string) {
    const rows = await prisma.promotion.findMany({
      where: { clubId },
      orderBy: { startDate: 'desc' },
      include: { resources: { select: { resourceId: true } } },
    });
    return rows.map(toDTO);
  }

  /** Valide un corps (création OU état fusionné en màj). Lève VALIDATION_ERROR. */
  private async validate(clubId: string, b: PromotionBody): Promise<void> {
    if (!b.name?.trim())                              throw new Error('VALIDATION_ERROR');
    if (!isYmd(b.startDate) || !isYmd(b.endDate))     throw new Error('VALIDATION_ERROR');
    if (b.startDate! > b.endDate!)                    throw new Error('VALIDATION_ERROR'); // compare lexical = chrono
    if (b.kind !== 'PERCENT' && b.kind !== 'FIXED')   throw new Error('VALIDATION_ERROR');
    if (b.kind === 'PERCENT' && (!Number.isInteger(b.percentOff) || (b.percentOff as number) < 1 || (b.percentOff as number) > 100))
                                                      throw new Error('VALIDATION_ERROR');
    if (b.kind === 'FIXED' && (typeof b.fixedPrice !== 'number' || isNaN(b.fixedPrice) || b.fixedPrice < 0))
                                                      throw new Error('VALIDATION_ERROR');
    const hasWindow = b.windowStart != null || b.windowEnd != null;
    if (hasWindow) {
      if (!Number.isInteger(b.windowStart) || !Number.isInteger(b.windowEnd)) throw new Error('VALIDATION_ERROR');
      if ((b.windowStart as number) < 0 || (b.windowEnd as number) > 1440 || (b.windowStart as number) >= (b.windowEnd as number))
                                                      throw new Error('VALIDATION_ERROR');
    }
    if (b.resourceIds !== undefined) {
      if (!Array.isArray(b.resourceIds)) throw new Error('VALIDATION_ERROR');
      const ids = [...new Set(b.resourceIds)];
      if (ids.length > 0) {
        const owned = await prisma.resource.findMany({ where: { id: { in: ids }, clubId }, select: { id: true } });
        if (owned.length !== ids.length) throw new Error('VALIDATION_ERROR');
      }
    }
  }

  async createPromotion(clubId: string, body: PromotionBody) {
    await this.validate(clubId, body);
    const ids = [...new Set(body.resourceIds ?? [])];
    const created = await prisma.promotion.create({
      data: {
        clubId,
        name: body.name!.trim(),
        startDate: dayUTC(body.startDate!),
        endDate: dayUTC(body.endDate!),
        kind: body.kind as PromotionKind,
        percentOff: body.kind === 'PERCENT' ? body.percentOff! : null,
        fixedPrice: body.kind === 'FIXED' ? new Prisma.Decimal(body.fixedPrice!) : null,
        windowStart: body.windowStart ?? null,
        windowEnd: body.windowEnd ?? null,
        enabled: body.enabled ?? true,
        resources: { create: ids.map((resourceId) => ({ resourceId })) },
      },
      include: { resources: { select: { resourceId: true } } },
    });
    return toDTO(created);
  }

  async updatePromotion(id: string, clubId: string, body: PromotionBody) {
    const existing = await prisma.promotion.findUnique({
      where: { id }, include: { resources: { select: { resourceId: true } } },
    });
    if (!existing || existing.clubId !== clubId) throw new Error('PROMOTION_NOT_FOUND');

    const merged: PromotionBody = {
      name: body.name ?? existing.name,
      startDate: body.startDate ?? ymd(existing.startDate),
      endDate: body.endDate ?? ymd(existing.endDate),
      kind: (body.kind ?? existing.kind) as 'PERCENT' | 'FIXED',
      percentOff: body.percentOff !== undefined ? body.percentOff : existing.percentOff,
      fixedPrice: body.fixedPrice !== undefined ? body.fixedPrice : (existing.fixedPrice != null ? Number(existing.fixedPrice) : null),
      windowStart: body.windowStart !== undefined ? body.windowStart : existing.windowStart,
      windowEnd: body.windowEnd !== undefined ? body.windowEnd : existing.windowEnd,
      resourceIds: body.resourceIds !== undefined ? body.resourceIds : existing.resources.map((r) => r.resourceId),
    };
    await this.validate(clubId, merged);

    const data: Prisma.PromotionUpdateInput = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.startDate !== undefined) data.startDate = dayUTC(body.startDate);
    if (body.endDate !== undefined) data.endDate = dayUTC(body.endDate);
    if (body.kind !== undefined) data.kind = body.kind as PromotionKind;
    if (body.kind !== undefined || body.percentOff !== undefined || body.fixedPrice !== undefined) {
      data.percentOff = merged.kind === 'PERCENT' ? merged.percentOff! : null;
      data.fixedPrice = merged.kind === 'FIXED' ? new Prisma.Decimal(merged.fixedPrice!) : null;
    }
    if (body.windowStart !== undefined) data.windowStart = body.windowStart;
    if (body.windowEnd !== undefined) data.windowEnd = body.windowEnd;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    if (body.resourceIds !== undefined) {
      const ids = [...new Set(body.resourceIds)];
      await prisma.promotionResource.deleteMany({ where: { promotionId: id } });
      if (ids.length > 0) {
        await prisma.promotionResource.createMany({ data: ids.map((resourceId) => ({ promotionId: id, resourceId })) });
      }
    }

    const updated = await prisma.promotion.update({
      where: { id }, data, include: { resources: { select: { resourceId: true } } },
    });
    return toDTO(updated);
  }

  async deletePromotion(id: string, clubId: string) {
    const existing = await prisma.promotion.findUnique({ where: { id } });
    if (!existing || existing.clubId !== clubId) throw new Error('PROMOTION_NOT_FOUND');
    await prisma.promotion.delete({ where: { id } }); // cascade promotion_resources
    return { ok: true };
  }
}
