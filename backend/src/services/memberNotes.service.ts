import { prisma } from '../db/prisma';

export interface MemberNoteDTO {
  id: string;
  body: string;
  createdAt: string;
  author: { firstName: string; lastName: string } | null;
}

const toDTO = (n: {
  id: string; body: string; createdAt: Date;
  author: { firstName: string; lastName: string } | null;
}): MemberNoteDTO => ({
  id: n.id, body: n.body, createdAt: n.createdAt.toISOString(),
  author: n.author ? { firstName: n.author.firstName, lastName: n.author.lastName } : null,
});

/** Fil de commentaires staff sur un membre, scopé (clubId, userId). */
export class MemberNotesService {
  async list(clubId: string, userId: string): Promise<MemberNoteDTO[]> {
    const rows = await prisma.memberNote.findMany({
      where: { clubId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
    });
    return rows.map(toDTO);
  }

  async add(clubId: string, userId: string, authorId: string, body: string): Promise<MemberNoteDTO> {
    const trimmed = (body ?? '').trim();
    if (!trimmed) throw new Error('VALIDATION_ERROR');
    const n = await prisma.memberNote.create({
      data: { clubId, userId, authorId, body: trimmed },
      select: { id: true, body: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
    });
    return toDTO(n);
  }

  async remove(clubId: string, userId: string, noteId: string): Promise<void> {
    // deleteMany scopé : pas de fuite inter-club et idempotent face à un id étranger.
    const res = await prisma.memberNote.deleteMany({ where: { id: noteId, clubId, userId } });
    if (res.count === 0) throw new Error('NOTE_NOT_FOUND');
  }
}
