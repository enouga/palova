// backend/src/services/support.service.ts
// Tickets support club → Palova : crée une issue GitHub dans le repo privé dédié
// (GITHUB_SUPPORT_REPO) via un fine-grained PAT scopé Issues-only — le staff club ne
// voit jamais GitHub. Rien n'est stocké en base : GitHub Issues est la source de vérité.
import { prisma } from '../db/prisma';
import { sendMail } from '../email/mailer';
import { PALOVA_BRAND } from '../email/templates/layout';
import { buildSupportAckEmail } from '../email/templates/support';

export type SupportCategory = 'BUG' | 'QUESTION' | 'SUGGESTION' | 'BILLING';

export const SUPPORT_CATEGORIES: Record<SupportCategory, { label: string; ghLabel: string }> = {
  BUG:        { label: 'Bug',         ghLabel: 'bug' },
  QUESTION:   { label: 'Question',    ghLabel: 'question' },
  SUGGESTION: { label: 'Suggestion',  ghLabel: 'suggestion' },
  BILLING:    { label: 'Facturation', ghLabel: 'facturation' },
};

export interface SupportTicketInput { category: SupportCategory; subject: string; description: string }
export interface TicketContext {
  clubName: string; clubSlug: string;
  senderName: string; senderEmail: string; senderRole: string;
  /** Palier billing observé (Club.activeMemberCount) — contexte de tri, null si inconnu. */
  activeMemberCount: number | null;
}

const GITHUB_TIMEOUT_MS = 10_000;

/** Payload d'issue GitHub. La description est citée (`> `) : neutralise titres/mentions markdown. */
export function buildIssuePayload(ctx: TicketContext, input: SupportTicketInput, nowIso: string): { title: string; body: string; labels: string[] } {
  const meta = SUPPORT_CATEGORIES[input.category];
  const quoted = input.description.split('\n').map((l) => `> ${l}`).join('\n');
  return {
    title: `[${meta.label}] ${input.subject} — ${ctx.clubName}`,
    labels: [meta.ghLabel],
    body: [
      `**Club** : ${ctx.clubName} (${ctx.clubSlug}.palova.fr)`,
      `**Expéditeur** : ${ctx.senderName} (${ctx.senderEmail}) — ${ctx.senderRole}`,
      `**Catégorie** : ${meta.label}`,
      `**Membres actifs** : ${ctx.activeMemberCount ?? '?'}`,
      `**Date** : ${nowIso}`,
      '',
      '---',
      '',
      quoted,
    ].join('\n'),
  };
}

function assertValidInput(input: SupportTicketInput): void {
  const subject = (input.subject ?? '').trim();
  const description = (input.description ?? '').trim();
  if (!SUPPORT_CATEGORIES[input.category]) throw new Error('VALIDATION_ERROR');
  if (subject.length < 3 || subject.length > 120) throw new Error('VALIDATION_ERROR');
  if (description.length < 10 || description.length > 5000) throw new Error('VALIDATION_ERROR');
}

export class SupportService {
  async createTicket(clubId: string, userId: string, input: SupportTicketInput): Promise<{ number: number | null }> {
    assertValidInput(input);
    const [club, user, member] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true, activeMemberCount: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
      prisma.clubMember.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { role: true } }),
    ]);
    if (!club || !user) throw new Error('VALIDATION_ERROR');

    const clean: SupportTicketInput = { ...input, subject: input.subject.trim(), description: input.description.trim() };
    const payload = buildIssuePayload({
      clubName: club.name, clubSlug: club.slug,
      senderName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      senderEmail: user.email, senderRole: member?.role ?? 'STAFF',
      activeMemberCount: club.activeMemberCount ?? null,
    }, clean, new Date().toISOString());

    let number: number | null = null;
    try {
      number = await this.createGithubIssue(payload);
    } catch (err) {
      // Repli : jamais de ticket perdu — le contenu part par email au support Palova.
      console.error('[support] issue GitHub échouée, repli email', (err as Error).message);
      const fallbackTo = process.env.SUPPORT_FALLBACK_EMAIL || 'contact@palova.fr';
      try {
        await sendMail({ to: fallbackTo, subject: payload.title, text: payload.body });
      } catch (e2) {
        console.error('[support] repli email échoué aussi', (e2 as Error).message);
        throw new Error('SUPPORT_UNAVAILABLE');
      }
    }

    const ack = buildSupportAckEmail({ number, subject: clean.subject, clubName: club.name, brand: PALOVA_BRAND });
    sendMail({ to: user.email, subject: ack.subject, html: ack.html, text: ack.text })
      .catch((e) => console.error('[support] accusé de réception échoué', (e as Error).message));

    return { number };
  }

  /** null = GitHub non configuré (dev) ; throw = configuré mais en échec (→ repli). */
  private async createGithubIssue(p: { title: string; body: string; labels: string[] }): Promise<number | null> {
    const token = process.env.GITHUB_SUPPORT_TOKEN;
    const repo = process.env.GITHUB_SUPPORT_REPO;
    if (!token || !repo) {
      console.log('[support:dev] GitHub non configuré — ticket loggé :', p.title);
      return null;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GITHUB_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(p),
      });
      if (!res.ok) throw new Error(`GITHUB_HTTP_${res.status}`);
      const data = (await res.json()) as { number?: number };
      return typeof data.number === 'number' ? data.number : null;
    } finally {
      clearTimeout(timer);
    }
  }
}
