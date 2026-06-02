import { prisma } from '../db/prisma';

interface AnnouncementInput { title?: string; body?: string; linkUrl?: string | null; imageUrl?: string | null; isPublished?: boolean; pinned?: boolean; }

export class AnnouncementService {
  async listPublic(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.announcement.findMany({
      where: { clubId: club.id, isPublished: true },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listAdmin(clubId: string) {
    return prisma.announcement.findMany({ where: { clubId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] });
  }

  async create(clubId: string, data: AnnouncementInput) {
    const title = (data.title ?? '').trim();
    const body = (data.body ?? '').trim();
    if (!title || !body) throw new Error('VALIDATION_ERROR');
    return prisma.announcement.create({
      data: {
        clubId, title, body,
        linkUrl: data.linkUrl?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
        isPublished: data.isPublished ?? true,
        pinned: data.pinned ?? false,
      },
    });
  }

  async update(id: string, clubId: string, data: AnnouncementInput) {
    const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('ANNOUNCEMENT_NOT_FOUND');
    return prisma.announcement.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.body !== undefined ? { body: data.body.trim() } : {}),
        ...(data.linkUrl !== undefined ? { linkUrl: data.linkUrl?.trim() || null } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl?.trim() || null } : {}),
        ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
      },
    });
  }

  async remove(id: string, clubId: string) {
    await prisma.announcement.deleteMany({ where: { id, clubId } });
  }
}
