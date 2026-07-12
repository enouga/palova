import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { CLUB_PHOTOS_DIR } from '../utils/uploads';

export const MAX_CLUB_PHOTOS = 12;

/** Catalogue fermé des équipements « Sur place » — miroir front : frontend/lib/clubShowcase.ts. */
export const AMENITY_KEYS = ['bar', 'shop', 'lockers', 'parking', 'rental', 'terrace', 'wifi', 'coaching'] as const;

/** Filtre les clés inconnues, déduplique et réordonne selon le catalogue. */
export function normalizeAmenities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.filter((k): k is string => typeof k === 'string'));
  return AMENITY_KEYS.filter((k) => set.has(k));
}

function normFoundedYear(v: number | null): number | null {
  if (v === null) return null;
  if (!Number.isInteger(v) || v < 1900 || v > new Date().getFullYear() + 1) throw new Error('VALIDATION_ERROR');
  return v;
}

const PHOTO_SELECT = { id: true, url: true, caption: true, sortOrder: true } as const;

function deleteUploadedPhoto(url: string | null | undefined): void {
  if (url?.startsWith('/uploads/club-photos/')) {
    fs.promises.unlink(path.join(CLUB_PHOTOS_DIR, path.basename(url))).catch(() => {});
  }
}

export class PresentationService {
  /** Présentation publique d'un club ACTIF : texte, contact, horaires, galerie triée. */
  async getPublic(slug: string) {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: {
        id: true, status: true, presentationText: true, coverImageUrl: true,
        address: true, city: true, latitude: true, longitude: true,
        contactPhone: true, contactEmail: true, openingHoursText: true,
        foundedYear: true, amenities: true,
      },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const photos = await prisma.clubPhoto.findMany({
      where: { clubId: club.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: PHOTO_SELECT,
    });
    const { id: _id, status: _status, ...pub } = club;
    return { ...pub, photos };
  }

  /** Vue admin (par clubId, sans gate ACTIVE — le club édite même suspendu). */
  async getAdmin(clubId: string) {
    const club = await prisma.club.findUniqueOrThrow({
      where: { id: clubId },
      select: { presentationText: true, contactPhone: true, contactEmail: true, openingHoursText: true, coverImageUrl: true, foundedYear: true, amenities: true },
    });
    const photos = await prisma.clubPhoto.findMany({
      where: { clubId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: PHOTO_SELECT,
    });
    return { ...club, photos };
  }

  async updateText(clubId: string, data: {
    presentationText?: string | null; contactPhone?: string | null; contactEmail?: string | null;
    openingHoursText?: string | null; foundedYear?: number | null; amenities?: string[];
  }) {
    const norm = (v: string | null | undefined) => (v === undefined ? undefined : (v?.trim() || null));
    await prisma.club.update({
      where: { id: clubId },
      data: {
        ...(data.presentationText !== undefined ? { presentationText: norm(data.presentationText) } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: norm(data.contactPhone) } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: norm(data.contactEmail) } : {}),
        ...(data.openingHoursText !== undefined ? { openingHoursText: norm(data.openingHoursText) } : {}),
        ...(data.foundedYear !== undefined ? { foundedYear: normFoundedYear(data.foundedYear) } : {}),
        ...(data.amenities !== undefined ? { amenities: normalizeAmenities(data.amenities) } : {}),
      },
    });
    return this.getAdmin(clubId);
  }

  async addPhoto(clubId: string, url: string, caption?: string) {
    const count = await prisma.clubPhoto.count({ where: { clubId } });
    if (count >= MAX_CLUB_PHOTOS) throw new Error('PHOTO_LIMIT_REACHED');
    return prisma.clubPhoto.create({
      data: { clubId, url, caption: caption?.trim() || null, sortOrder: count },
      select: PHOTO_SELECT,
    });
  }

  async updatePhoto(clubId: string, id: string, data: { caption?: string | null; sortOrder?: number }) {
    const found = await prisma.clubPhoto.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('PHOTO_NOT_FOUND');
    return prisma.clubPhoto.update({
      where: { id },
      data: {
        ...(data.caption !== undefined ? { caption: data.caption?.trim() || null } : {}),
        ...(typeof data.sortOrder === 'number' ? { sortOrder: data.sortOrder } : {}),
      },
      select: PHOTO_SELECT,
    });
  }

  async removePhoto(clubId: string, id: string) {
    const found = await prisma.clubPhoto.findUnique({ where: { id }, select: { clubId: true, url: true } });
    if (!found || found.clubId !== clubId) throw new Error('PHOTO_NOT_FOUND');
    deleteUploadedPhoto(found.url);
    await prisma.clubPhoto.delete({ where: { id } });
  }
}
