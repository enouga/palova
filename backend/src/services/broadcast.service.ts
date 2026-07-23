import { prisma } from '../db/prisma';
import { dispatch } from './notification/dispatcher';
import { buildBroadcastEmail } from '../email/templates/emails';
import { clubAppUrl, absoluteAsset, apiPublicUrl } from '../email/links';
import { Brand } from '../email/templates/layout';
import { sanitizeBodyHtml, htmlToText, substituteText, substituteHtml } from '../email/registry';
import { unsubscribeToken } from './unsubscribeToken';

export interface BroadcastChannels {
  email: boolean;
  inApp: boolean;
  push: boolean;
}

/**
 * Normalise les canaux d'un envoi : défaut = tout activé (rétro-compat), et **push impossible
 * sans la cloche** (couplage — un push sans notif in-app serait incohérent pour le membre).
 */
export function normalizeBroadcastChannels(c?: Partial<BroadcastChannels> | null): BroadcastChannels {
  const email = c?.email !== false;
  const inApp = c?.inApp !== false;
  const push = c?.push !== false && inApp;
  return { email, inApp, push };
}

interface SendInput {
  title: string;
  /** Corps HTML riche saisi dans l'éditeur (assaini côté serveur). */
  bodyHtml: string;
  url?: string | null;
  /** Canaux choisis par le club (email / cloche / push). Absent = tous. */
  channels?: Partial<BroadcastChannels> | null;
  /** Ciblage : null/absent = tous les membres actifs (comportement historique). */
  recipientUserIds?: string[] | null;
  /** COMMERCIAL = catégorie de consentement CLUB_OFFERS (offres) ; défaut INFO. */
  kind?: 'INFO' | 'COMMERCIAL';
}

interface PreviewInput {
  title: string;
  bodyHtml: string;
  url?: string | null;
}

export class BroadcastService {
  async countActiveMembers(clubId: string): Promise<number> {
    return prisma.clubMembership.count({ where: { clubId, status: 'ACTIVE' } });
  }

  /** Brand email du club (logo/couleur) + slug, partagé par send() et preview(). */
  private async loadBrand(clubId: string): Promise<{ brand: Brand; slug: string }> {
    const club = await prisma.club.findUniqueOrThrow({
      where: { id: clubId },
      select: { name: true, slug: true, logoUrl: true, accentColor: true },
    });
    return {
      slug: club.slug,
      brand: { name: club.name, logoUrl: absoluteAsset(club.logoUrl), accentColor: club.accentColor || '#5e93da' },
    };
  }

  async send(
    clubId: string,
    sentByUserId: string,
    input: SendInput,
  ): Promise<{ recipientCount: number; broadcastId: string; emailOptOuts: number }> {
    const title = input.title.trim();
    // Corps HTML riche → on assainit UNE fois (source de l'email) et on dérive un
    // texte brut pour la notif in-app / push, l'historique et la ligne d'audit.
    const safeHtml = sanitizeBodyHtml(input.bodyHtml || '');
    const plainBody = htmlToText(safeHtml).trim();
    if (!title || !plainBody) throw new Error('VALIDATION_ERROR');

    // Canaux : au moins un doit être actif (push implique la cloche → couvert par email||inApp).
    const ch = normalizeBroadcastChannels(input.channels);
    if (!ch.email && !ch.inApp) throw new Error('VALIDATION_ERROR');

    // Type de diffusion : COMMERCIAL route vers la catégorie de consentement CLUB_OFFERS
    // (opt-out séparé des messages ordinaires) ; INFO (défaut) garde CLUB_MESSAGES.
    const kind: 'INFO' | 'COMMERCIAL' = input.kind === 'COMMERCIAL' ? 'COMMERCIAL' : 'INFO';
    const category = kind === 'COMMERCIAL' ? ('CLUB_OFFERS' as const) : ('CLUB_MESSAGES' as const);
    // Ciblage : liste non vide = sous-ensemble ; sinon comportement historique (tous les actifs).
    const targeted = Array.isArray(input.recipientUserIds) && input.recipientUserIds.length > 0
      ? input.recipientUserIds
      : null;

    const [{ brand, slug }, members] = await Promise.all([
      this.loadBrand(clubId),
      prisma.clubMembership.findMany({
        where: { clubId, status: 'ACTIVE', ...(targeted ? { userId: { in: targeted } } : {}) },
        select: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
    ]);
    // Un ciblage qui ne résout aucun membre actif du club = erreur (jamais d'envoi hors club).
    if (targeted && members.length === 0) throw new Error('VALIDATION_ERROR');

    // Ligne d'audit : body = texte brut (historique/in-app), bodyHtml = corps riche assaini.
    const broadcast = await prisma.clubBroadcast.create({
      data: {
        clubId,
        sentByUserId,
        title,
        body: plainBody,
        bodyHtml: safeHtml,
        kind,
        url: input.url ?? null,
        recipientCount: members.length,
      },
    });
    // Trace « à qui le club a adressé le message » (avant filtrage par préférences membre).
    await prisma.clubBroadcastRecipient.createMany({
      data: members.map((m) => ({ broadcastId: broadcast.id, userId: m.user.id })),
      skipDuplicates: true,
    });

    const targetUrl = input.url ?? clubAppUrl(slug, '/');

    // Informationnel seulement : dispatch()/resolveChannels() font DÉJÀ le vrai filtrage
    // par préférence (cf. dispatcher.ts) — ce compte ne change pas qui reçoit quoi.
    const optOuts = await prisma.notificationPreference.count({
      where: {
        category,
        channel: 'EMAIL',
        enabled: false,
        userId: { in: members.map((m) => m.user.id) },
      },
    });

    // V1: synchronous fan-out (one dispatch per member). Fine for typical club sizes.
    // A queue-based approach is explicitly out of scope for V1.
    const allowChannels = { inapp: ch.inApp, email: ch.email, push: ch.push };
    for (const m of members) {
      // Substitution par destinataire — le gabarit stocké (audit) garde les {{placeholders}}.
      const vars = { prenom: m.user.firstName, nom: m.user.lastName };
      const perTitle = substituteText(title, vars);
      const perHtml = substituteHtml(safeHtml, vars);
      const perPlain = substituteText(plainBody, vars);
      // On ne construit l'email (assaini + décoré, lien de désinscription signé par membre)
      // QUE si le canal email est demandé ET que le membre a une adresse.
      let email = null as { to: string; subject: string; html: string; text: string } | null;
      if (ch.email && m.user.email) {
        const unsubscribeUrl = apiPublicUrl(
          `/api/unsubscribe?token=${unsubscribeToken(m.user.id)}${kind === 'COMMERCIAL' ? '&cat=offers' : ''}`,
        );
        const built = buildBroadcastEmail({
          title: perTitle,
          bodyHtml: perHtml,
          url: targetUrl,
          brand: { ...brand, unsubscribeUrl },
        });
        email = { to: m.user.email, subject: built.subject, html: built.html, text: built.text };
      }
      await dispatch({
        userId: m.user.id,
        clubId,
        category,
        type: 'club.broadcast',
        title: perTitle,
        // La notif in-app / push ne rend pas de HTML → texte brut dérivé du corps riche.
        body: perPlain,
        url: targetUrl,
        email,
        allowChannels,
      });
    }

    return { recipientCount: members.length, broadcastId: broadcast.id, emailOptOuts: optOuts };
  }

  /** Rend l'email tel qu'il sera reçu (aperçu admin, sans envoi ni persistance). */
  async preview(clubId: string, input: PreviewInput): Promise<{ html: string }> {
    const { brand, slug } = await this.loadBrand(clubId);
    const title = input.title.trim() || 'Aperçu du message';
    const targetUrl = (input.url && input.url.trim()) || clubAppUrl(slug, '/');
    const { html } = buildBroadcastEmail({ title, bodyHtml: input.bodyHtml || '', url: targetUrl, brand });
    return { html };
  }

  async history(clubId: string) {
    return prisma.clubBroadcast.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
