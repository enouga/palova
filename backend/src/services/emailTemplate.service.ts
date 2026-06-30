import { prisma } from '../db/prisma';
import { EMAIL_DEFS, EmailDef, EmailOverride } from '../email/registry';

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
}

export const emailTemplates = new EmailTemplateService();
