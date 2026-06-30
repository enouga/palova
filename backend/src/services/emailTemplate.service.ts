import { prisma } from '../db/prisma';
import { EMAIL_DEFS, EmailDef, EmailOverride, sanitizeBodyHtml, collectPlaceholders } from '../email/registry';

export interface EmailSummary {
  type: string; group: EmailDef['group']; title: string; description: string; customized: boolean;
}

export interface EmailDetail {
  type: string; group: EmailDef['group']; title: string; description: string; hasCta: boolean;
  vars: { key: string; label: string; sample: string }[];
  defaults: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string };
  override: EmailOverride | null;
}

function toOverride(row: { subject: string; heading: string; bodyHtml: string; ctaLabel: string | null; footerNote: string | null } | null): EmailOverride | null {
  if (!row) return null;
  return { subject: row.subject, heading: row.heading, bodyHtml: row.bodyHtml, ctaLabel: row.ctaLabel, footerNote: row.footerNote };
}

export class EmailTemplateService {
  async listForAdmin(clubId: string): Promise<EmailSummary[]> {
    const rows = await prisma.clubEmailTemplate.findMany({ where: { clubId }, select: { type: true } });
    const customized = new Set(rows.map((r) => r.type));
    return Object.values(EMAIL_DEFS).map((def) => ({
      type: def.type, group: def.group, title: def.title, description: def.description,
      customized: customized.has(def.type),
    }));
  }

  async getForAdmin(clubId: string, type: string): Promise<EmailDetail> {
    const def = EMAIL_DEFS[type];
    if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');
    const row = await prisma.clubEmailTemplate.findUnique({ where: { clubId_type: { clubId, type } } });
    return {
      type: def.type, group: def.group, title: def.title, description: def.description, hasCta: def.hasCta,
      vars: def.vars, defaults: def.defaults, override: toOverride(row as any),
    };
  }

  /** Surcharge brute pour le rendu (résilient : null si erreur DB → repli défaut). */
  async getOverride(clubId: string, type: string): Promise<EmailOverride | null> {
    try {
      const row = await prisma.clubEmailTemplate.findUnique({ where: { clubId_type: { clubId, type } } });
      return toOverride(row as any);
    } catch {
      return null;
    }
  }

  /** Variables `{{…}}` du brouillon non déclarées par la définition. */
  private unknownVarsFor(def: EmailDef, draft: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string }): string[] {
    const declared = new Set(def.vars.map((v) => v.key));
    const used = new Set<string>([
      ...collectPlaceholders(draft.subject),
      ...collectPlaceholders(draft.heading),
      ...collectPlaceholders(draft.bodyHtml),
      ...collectPlaceholders(draft.ctaLabel ?? ''),
      ...collectPlaceholders(draft.footerNote ?? ''),
    ]);
    return [...used].filter((k) => !declared.has(k));
  }

  async upsert(
    clubId: string,
    type: string,
    draft: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string | null; footerNote?: string | null },
  ): Promise<{ override: EmailOverride; unknownVars: string[] }> {
    const def = EMAIL_DEFS[type];
    if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');

    const subject = (draft.subject ?? '').trim();
    const heading = (draft.heading ?? '').trim();
    const bodyRaw = (draft.bodyHtml ?? '').trim();
    if (!subject || !heading || !bodyRaw) throw new Error('VALIDATION_ERROR');
    if (subject.length > 200 || heading.length > 200 || bodyRaw.length > 10000) throw new Error('VALIDATION_ERROR');

    const bodyHtml = sanitizeBodyHtml(bodyRaw);
    const ctaLabel = (draft.ctaLabel ?? '').trim() || null;
    const footerNote = (draft.footerNote ?? '').trim() || null;

    const data = { subject, heading, bodyHtml, ctaLabel, footerNote };
    await prisma.clubEmailTemplate.upsert({
      where: { clubId_type: { clubId, type } },
      create: { clubId, type, ...data },
      update: data,
    });
    return { override: { subject, heading, bodyHtml, ctaLabel, footerNote }, unknownVars: this.unknownVarsFor(def, { subject, heading, bodyHtml, ctaLabel: ctaLabel ?? '', footerNote: footerNote ?? '' }) };
  }

  async remove(clubId: string, type: string): Promise<void> {
    await prisma.clubEmailTemplate.deleteMany({ where: { clubId, type } });
  }
}

export const emailTemplates = new EmailTemplateService();
