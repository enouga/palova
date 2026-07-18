import { ClubPageKind } from '@prisma/client';
import { prisma } from '../db/prisma';
import { buildSocleFaq } from '../content/faqSocle';
import { renderClubPageTemplate } from '../content/clubPageTemplates';

/**
 * Pages de contenu éditable d'un club (CGV, mentions légales, confidentialité, offres)
 * + FAQ (socle Palova interpolé fusionné aux items propres du club).
 */
export class ClubPageService {
  /** Club actif scopé par slug (lecture publique). */
  private async activeClubBySlug<T>(slug: string, select: T) {
    const club = await prisma.club.findUnique({ where: { slug }, select: select as object });
    if (!club || (club as { status?: string }).status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return club as unknown as { id: string } & Record<string, unknown>;
  }

  // --- Pages : lecture publique ---

  /** Contenu publié d'une page (sinon PAGE_NOT_FOUND). */
  async getPublicPage(slug: string, kind: ClubPageKind) {
    const club = await this.activeClubBySlug(slug, { id: true, status: true });
    const page = await prisma.clubPage.findFirst({
      where: { clubId: club.id, kind, published: true },
      select: { kind: true, bodyMarkdown: true, updatedAt: true },
    });
    if (!page) throw new Error('PAGE_NOT_FOUND');
    return { kind: page.kind, bodyMarkdown: page.bodyMarkdown, updatedAt: page.updatedAt };
  }

  // --- FAQ : lecture publique (socle + items du club) ---

  async getPublicFaq(slug: string) {
    const club = await this.activeClubBySlug(slug, {
      id: true, status: true, name: true, slug: true,
      publicBookingDays: true, memberBookingDays: true,
      cancellationCutoffHours: true, playerChangeCutoffHours: true,
      refundOnCancelWithinCutoff: true, requireOnlinePayment: true,
      legalEmail: true, legalPhone: true,
    });
    const socle = buildSocleFaq({
      name: club.name as string, slug: club.slug as string,
      publicBookingDays: club.publicBookingDays as number,
      memberBookingDays: club.memberBookingDays as number,
      cancellationCutoffHours: club.cancellationCutoffHours as number,
      playerChangeCutoffHours: club.playerChangeCutoffHours as number,
      refundOnCancelWithinCutoff: club.refundOnCancelWithinCutoff as boolean,
      requireOnlinePayment: club.requireOnlinePayment as boolean,
      legalEmail: (club.legalEmail as string | null) ?? null,
      legalPhone: (club.legalPhone as string | null) ?? null,
    });
    const items = await prisma.clubFaqItem.findMany({
      where: { clubId: club.id, published: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, question: true, answerMarkdown: true, category: true },
    });
    const custom = items.map((i) => ({ id: i.id, category: i.category, question: i.question, answer: i.answerMarkdown }));
    return { socle, custom };
  }

  // --- Pages : back-office ---

  /** Toutes les pages existantes du club (les 4 types sont gérés côté front, gaps compris). */
  async listAdminPages(clubId: string) {
    const pages = await prisma.clubPage.findMany({
      where: { clubId },
      select: { kind: true, bodyMarkdown: true, published: true, source: true, updatedAt: true },
    });
    return pages;
  }

  /** Crée ou met à jour une page (toujours marquée CUSTOM car éditée par le club). */
  async upsertPage(clubId: string, kind: ClubPageKind, params: { bodyMarkdown: string; published?: boolean }) {
    const body = (params.bodyMarkdown ?? '').toString();
    if (!body.trim()) throw new Error('VALIDATION_ERROR');
    return prisma.clubPage.upsert({
      where: { clubId_kind: { clubId, kind } },
      create: { clubId, kind, bodyMarkdown: body, published: params.published ?? false, source: 'CUSTOM' },
      update: {
        bodyMarkdown: body, source: 'CUSTOM',
        ...(params.published !== undefined ? { published: params.published } : {}),
      },
    });
  }

  /** Modèle Palova pré-rempli pour un type de page (pour pré-remplir / réinitialiser l'éditeur). */
  async renderTemplate(clubId: string, kind: ClubPageKind): Promise<string> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: {
        name: true, legalEntityName: true, legalForm: true, siret: true, vatNumber: true,
        legalRepresentative: true, legalEmail: true, legalPhone: true, address: true, city: true,
        mediatorName: true, mediatorUrl: true,
      },
    });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    return renderClubPageTemplate(kind, club);
  }

  // --- FAQ : back-office ---

  async listAdminFaq(clubId: string) {
    return prisma.clubFaqItem.findMany({
      where: { clubId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, question: true, answerMarkdown: true, category: true, sortOrder: true, published: true },
    });
  }

  async createFaqItem(clubId: string, params: { question: string; answerMarkdown: string; category?: string }) {
    const question = (params.question ?? '').trim();
    const answerMarkdown = (params.answerMarkdown ?? '').trim();
    if (!question || !answerMarkdown) throw new Error('VALIDATION_ERROR');
    const last = await prisma.clubFaqItem.findFirst({
      where: { clubId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;
    return prisma.clubFaqItem.create({
      data: { clubId, question, answerMarkdown, category: params.category?.trim() || null, sortOrder },
    });
  }

  async updateFaqItem(
    id: string, clubId: string,
    params: { question?: string; answerMarkdown?: string; category?: string | null; published?: boolean },
  ) {
    const existing = await prisma.clubFaqItem.findUnique({ where: { id }, select: { clubId: true } });
    if (!existing || existing.clubId !== clubId) throw new Error('FAQ_ITEM_NOT_FOUND');
    const data: Record<string, unknown> = {};
    if (params.question !== undefined) {
      const q = params.question.trim();
      if (!q) throw new Error('VALIDATION_ERROR');
      data.question = q;
    }
    if (params.answerMarkdown !== undefined) {
      const a = params.answerMarkdown.trim();
      if (!a) throw new Error('VALIDATION_ERROR');
      data.answerMarkdown = a;
    }
    if (params.category !== undefined) data.category = params.category?.toString().trim() || null;
    if (params.published !== undefined) data.published = params.published;
    return prisma.clubFaqItem.update({ where: { id }, data });
  }

  async deleteFaqItem(id: string, clubId: string) {
    const existing = await prisma.clubFaqItem.findUnique({ where: { id }, select: { clubId: true } });
    if (!existing || existing.clubId !== clubId) throw new Error('FAQ_ITEM_NOT_FOUND');
    await prisma.clubFaqItem.delete({ where: { id } });
  }

  /** Réordonne les items du club : sortOrder = position dans orderedIds (scopé club). */
  async reorderFaq(clubId: string, orderedIds: string[]) {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.clubFaqItem.updateMany({ where: { id, clubId }, data: { sortOrder: index } }),
      ),
    );
  }
}
