import { prisma } from '../db/prisma';

interface SponsorInput { name?: string; logoUrl?: string; linkUrl?: string | null; sortOrder?: number; isActive?: boolean; offerText?: string | null; offerCode?: string | null; }

export class SponsorService {
  async listPublic(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.sponsor.findMany({ where: { clubId: club.id, isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  async listAdmin(clubId: string) {
    return prisma.sponsor.findMany({ where: { clubId }, orderBy: { sortOrder: 'asc' } });
  }

  async create(clubId: string, data: SponsorInput) {
    const name = (data.name ?? '').trim();
    const logoUrl = (data.logoUrl ?? '').trim();
    if (!name || !logoUrl) throw new Error('VALIDATION_ERROR');
    return prisma.sponsor.create({
      data: {
        clubId, name, logoUrl,
        linkUrl: data.linkUrl?.trim() || null,
        sortOrder: Number.isInteger(data.sortOrder) ? data.sortOrder! : 0,
        isActive: data.isActive ?? true,
        offerText: data.offerText?.trim() || null,
        offerCode: data.offerCode?.trim() || null,
      },
    });
  }

  async update(id: string, clubId: string, data: SponsorInput) {
    const found = await prisma.sponsor.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('SPONSOR_NOT_FOUND');
    return prisma.sponsor.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl.trim() } : {}),
        ...(data.linkUrl !== undefined ? { linkUrl: data.linkUrl?.trim() || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: Number(data.sortOrder) } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.offerText !== undefined ? { offerText: data.offerText?.trim() || null } : {}),
        ...(data.offerCode !== undefined ? { offerCode: data.offerCode?.trim() || null } : {}),
      },
    });
  }

  async remove(id: string, clubId: string) {
    await prisma.sponsor.deleteMany({ where: { id, clubId } });
  }
}
