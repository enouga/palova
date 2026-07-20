import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { ANNOUNCEMENTS_DIR } from '../utils/uploads';
import { sanitizeExternalLinkUrl } from '../utils/url';

interface AnnouncementInput { title?: string; body?: string; linkUrl?: string | null; imageUrl?: string | null; isPublished?: boolean; pinned?: boolean; kind?: string; validUntil?: string | null; }

const VALID_KINDS = ['INFO', 'OFFER', 'TOURNAMENT', 'EVENT'] as const;
type Kind = typeof VALID_KINDS[number];

/** YYYY-MM-DD → fin de journée UTC (même convention que Sponsor.offerUntil). */
function parseValidUntil(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;      // absent du body → non modifié
  if (v === null || v === '') return null;    // effacement explicite
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('VALIDATION_ERROR');
  return new Date(`${v}T23:59:59.999Z`);
}

const asKind = (k: string | undefined): Kind | undefined =>
  k === undefined ? undefined : (VALID_KINDS.includes(k as Kind) ? (k as Kind) : 'INFO');

/** Supprime le fichier d'image uploadé d'une annonce (best-effort, jamais bloquant). */
function deleteUploadedImage(imageUrl: string | null | undefined): void {
  if (imageUrl?.startsWith('/uploads/announcements/')) {
    fs.promises.unlink(path.join(ANNOUNCEMENTS_DIR, path.basename(imageUrl))).catch(() => {});
  }
}

export class AnnouncementService {
  async listPublic(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.announcement.findMany({
      where: { clubId: club.id, isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async listAdmin(clubId: string) {
    return prisma.announcement.findMany({ where: { clubId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  }

  async create(clubId: string, data: AnnouncementInput) {
    const title = (data.title ?? '').trim();
    const body = (data.body ?? '').trim();
    if (!title || !body) throw new Error('VALIDATION_ERROR');
    // Ordre manuel : la nouvelle annonce arrive EN TÊTE (sortOrder = min − 1 ; 0 si aucune).
    const agg = await prisma.announcement.aggregate({ where: { clubId }, _min: { sortOrder: true } });
    const sortOrder = agg._min.sortOrder == null ? 0 : agg._min.sortOrder - 1;
    return prisma.announcement.create({
      data: {
        clubId, title, body,
        linkUrl: sanitizeExternalLinkUrl(data.linkUrl),
        imageUrl: data.imageUrl?.trim() || null,
        kind: asKind(data.kind) ?? 'INFO',
        validUntil: parseValidUntil(data.validUntil) ?? null,
        isPublished: data.isPublished ?? true,
        pinned: data.pinned ?? false,
        sortOrder,
      },
    });
  }

  async update(id: string, clubId: string, data: AnnouncementInput) {
    const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true, imageUrl: true } });
    if (!found || found.clubId !== clubId) throw new Error('ANNOUNCEMENT_NOT_FOUND');
    if (data.imageUrl !== undefined && (data.imageUrl?.trim() || null) !== found.imageUrl) {
      deleteUploadedImage(found.imageUrl);
    }
    return prisma.announcement.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.body !== undefined ? { body: data.body.trim() } : {}),
        ...(data.linkUrl !== undefined ? { linkUrl: sanitizeExternalLinkUrl(data.linkUrl) } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl?.trim() || null } : {}),
        ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
        ...(data.kind !== undefined ? { kind: asKind(data.kind) } : {}),
        ...(parseValidUntil(data.validUntil) !== undefined ? { validUntil: parseValidUntil(data.validUntil) } : {}),
      },
    });
  }

  async remove(id: string, clubId: string) {
    const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true, imageUrl: true } });
    if (found?.clubId === clubId) deleteUploadedImage(found.imageUrl);
    await prisma.announcement.deleteMany({ where: { id, clubId } });
  }

  /** Pose l'URL du fichier uploadé sur l'annonce (supprime l'ancien fichier). */
  async setImage(id: string, clubId: string, imageUrl: string) {
    const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true, imageUrl: true } });
    if (!found || found.clubId !== clubId) throw new Error('ANNOUNCEMENT_NOT_FOUND');
    deleteUploadedImage(found.imageUrl);
    return prisma.announcement.update({ where: { id }, data: { imageUrl } });
  }

  /** Applique un ordre manuel : sortOrder = index. Ignore les ids n'appartenant pas au club. */
  async reorder(clubId: string, orderedIds: string[]) {
    const owned = new Set(
      (await prisma.announcement.findMany({ where: { clubId }, select: { id: true } })).map((a) => a.id),
    );
    const ids = orderedIds.filter((id) => owned.has(id));
    await prisma.$transaction(
      ids.map((id, index) => prisma.announcement.update({ where: { id }, data: { sortOrder: index } })),
    );
    return this.listAdmin(clubId);
  }
}
