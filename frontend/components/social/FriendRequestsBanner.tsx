'use client';
import { useState } from 'react';
import { FriendRequests } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

// Bannière « brume bleue » des demandes d'ami : reçues (Accepter/Refuser inline)
// + envoyées repliées derrière une ligne discrète. Rien si aucune demande.
export function FriendRequestsBanner({ requests, busyId, onRespond, onCancelSent }: {
  requests: FriendRequests;
  busyId: string | null;
  onRespond: (userId: string, accept: boolean) => void;
  onCancelSent: (userId: string) => void;
}) {
  const { th } = useTheme();
  const [sentOpen, setSentOpen] = useState(false);
  if (requests.received.length === 0 && requests.sent.length === 0) return null;

  const btn = (fill: boolean): React.CSSProperties => ({
    border: `1px solid ${HERO_INK}`, background: fill ? HERO_INK : 'transparent',
    color: fill ? '#fff' : HERO_INK, borderRadius: 999, padding: '6px 12px',
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <section id="fh-demandes" aria-label="Demandes d'ami"
      style={{ background: HERO_GRADIENT, borderRadius: 18, padding: '14px 16px' }}>
      {requests.received.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 8, padding: '6px 0' }}>
          <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={38} color={colorForSeed(f.id)} />
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: HERO_INK }}>{f.firstName} {f.lastName}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: HERO_INK_MUTED }}>souhaite devenir votre ami(e)</div>
          </div>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button type="button" disabled={busyId === f.id} style={btn(true)} onClick={() => onRespond(f.id, true)}>Accepter</button>
            <button type="button" disabled={busyId === f.id} style={btn(false)} onClick={() => onRespond(f.id, false)}>Refuser</button>
          </span>
        </div>
      ))}
      {requests.sent.length > 0 && (
        <div style={{ marginTop: requests.received.length > 0 ? 8 : 0 }}>
          <button type="button" onClick={() => setSentOpen((o) => !o)} aria-expanded={sentOpen}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: HERO_INK_MUTED }}>
            {requests.sent.length} demande{requests.sent.length > 1 ? 's' : ''} envoyée{requests.sent.length > 1 ? 's' : ''} {sentOpen ? '▴' : '▾'}
          </button>
          {sentOpen && requests.sent.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={30} color={colorForSeed(f.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK }}>{f.firstName} {f.lastName}</span>
              <button type="button" disabled={busyId === f.id} style={btn(false)} onClick={() => onCancelSent(f.id)}>Annuler</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
