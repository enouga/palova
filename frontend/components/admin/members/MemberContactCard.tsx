'use client';
// Carte « Messages » du cockpit fiche membre 360 — composant PUR (aucun fetch) : ne fait
// que déposer la sélection (ce seul membre) pour le composer de diffusion et naviguer.
// ⚠️ Le contact (email/téléphone) vit déjà dans le hero de la page — cette carte ne les
// duplique pas, elle ne porte que l'action « Envoyer un message » + l'historique des
// diffusions déjà reçues par ce membre.
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { storePendingRecipients } from '@/lib/broadcast';
import { Kicker, MEMBER_CARD_TINTS, memberCardStyle } from '@/components/admin/members/memberCardUi';

export interface MemberBroadcastRow { id: string; title: string; kind: 'INFO' | 'COMMERCIAL'; createdAt: string }

export function MemberContactCard({ userId, firstName, lastName, received }: {
  userId: string;
  firstName: string;
  lastName: string;
  received: MemberBroadcastRow[];
}) {
  const { th } = useTheme();
  const router = useRouter();
  const fmt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));

  const message = () => {
    storePendingRecipients([{ userId, name: `${firstName} ${lastName.charAt(0)}.` }]);
    router.push('/admin/broadcast');
  };

  // Le badge doit refléter le nombre de lignes réellement affichées (≤ 3), pas le total
  // renvoyé par le backend (jusqu'à 10) — sinon le compteur ment sur ce qui est visible.
  const shown = received.slice(0, 3);

  return (
    <section aria-label="Messages" style={memberCardStyle(th)}>
      <Kicker color={MEMBER_CARD_TINTS.green}>Messages{shown.length ? ` · ${shown.length}` : ''}</Kicker>
      <button
        onClick={message}
        style={{
          border: 'none', cursor: 'pointer', borderRadius: 10, padding: '9px 13px',
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, background: th.accent, color: th.onAccent,
        }}
      >
        ✉ Envoyer un message
      </button>

      {received.length > 0 ? (
        <div style={{ marginTop: 12, borderTop: `1px solid ${th.line}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {shown.map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</span>
              <span style={{ flexShrink: 0 }}>{fmt(b.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: '10px 0 0' }}>Aucun message envoyé pour l&apos;instant.</p>
      )}
    </section>
  );
}
