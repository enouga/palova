import { ConversationSummary, DmReaction } from './api';

// Helpers PURS de la messagerie (testés) — aucun accès réseau/DOM ici, sauf openDm (event window).

/** Aperçu d'une conversation dans la boîte de réception. */
export function inboxPreview(c: ConversationSummary): string {
  const m = c.lastMessage;
  if (!m) return '';
  if (m.deleted) return 'message supprimé';
  const body = m.hasImage && !m.body ? '📷 Photo' : m.body;
  return m.mine ? `Vous : ${body}` : body;
}

/** Clé de jour LOCALE (groupage des messages par jour). */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Libellé du séparateur de jour : « aujourd'hui », « hier », sinon « 4 juillet [2025] ». Pur (fonction de now). */
export function dayLabel(iso: string, now: Date): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return "aujourd'hui";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'hier';
  const d = new Date(iso);
  const label = `${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

/** ✓✓ : mon message est lu ssi le curseur de lecture de l'autre a dépassé sa date. */
export function isReadByOther(createdAtIso: string, otherLastReadAtIso: string | null): boolean {
  if (!otherLastReadAtIso) return false;
  return otherLastReadAtIso >= createdAtIso ||
    new Date(otherLastReadAtIso).getTime() >= new Date(createdAtIso).getTime();
}

/** Patch local optimiste d'un toggle de réaction (réconcilié par la réponse serveur/SSE). */
export function applyReactionToggle(reactions: DmReaction[], emoji: string, meId: string): DmReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  const iReacted = !!existing?.userIds.includes(meId);
  return reactions
    .map((r) => r.emoji !== emoji ? r : { ...r, userIds: iReacted ? r.userIds.filter((u) => u !== meId) : [...r.userIds, meId] })
    .concat(existing ? [] : [{ emoji, userIds: [meId] }])
    .filter((r) => r.userIds.length > 0);
}

/** Ouvre une conversation : widget ancré en desktop (event window), page en mobile. */
export function openDm(userId: string, opts: { isDesktop: boolean; navigate: (href: string) => void }): void {
  if (opts.isDesktop) window.dispatchEvent(new CustomEvent('palova:open-dm', { detail: { userId } }));
  else opts.navigate(`/me/messages?with=${userId}`);
}

/** Codes d'erreur de la messagerie mappés en texte lisible (au moment de la création d'une conversation). */
export const DM_ERRORS: Record<string, string> = {
  DM_DISABLED: "Ce joueur n'accepte pas les messages privés.",
  USER_BLOCKED: "Impossible d'écrire à ce joueur.",
  NOT_CO_MEMBERS: "Vous n'avez plus de club en commun avec ce joueur.",
};

/** Message affichable pour une erreur d'ouverture de conversation (repli générique sinon). */
export function dmErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  return DM_ERRORS[code] ?? "Impossible d'ouvrir cette conversation.";
}
