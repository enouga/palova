'use client';
import { useState } from 'react';
import { api, MyMatch, MyMatchPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, Theme } from '@/lib/theme';
import { splitTeams } from '@/lib/match';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { MatchDiscussion } from '@/components/match/MatchDiscussion';

/** Une ligne du tableau de score : avatars + noms de l'équipe, puis ses jeux par set (gras = set gagné). */
function ScoreboardRow({ players, side, sets, th }: {
  players: MyMatchPlayer[]; side: number; sets: [number, number][]; th: Theme;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          {players.map((p, i) => (
            <span key={p.userId} style={{ marginLeft: i > 0 ? -7 : 0, borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}`, lineHeight: 0 }}>
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={26} color={colorForSeed(p.userId)} />
            </span>
          ))}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {players.map((p) => (
            <span key={p.userId} style={{
              fontFamily: th.fontUI, fontSize: 13, fontWeight: p.isMe ? 800 : 600, color: th.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35,
            }}>
              {p.isMe ? 'Vous' : `${p.firstName} ${p.lastName}`}
            </span>
          ))}
        </span>
      </div>
      {sets.map(([a, b], i) => {
        const mine = side === 1 ? a : b;
        const won = side === 1 ? a > b : b > a;
        return (
          <span key={i} style={{
            textAlign: 'center', fontFamily: th.fontUI, fontSize: 18, lineHeight: 1,
            fontWeight: won ? 800 : 600, color: won ? th.text : th.textFaint, fontVariantNumeric: 'tabular-nums',
          }}>
            {mine}
          </span>
        );
      })}
    </>
  );
}

function resultLabel(m: MyMatch): { text: string; tone: 'win' | 'loss' | 'muted' } {
  if (m.status === 'CONFIRMED') {
    const won = m.winningTeam === m.myTeam;
    return won ? { text: 'Victoire', tone: 'win' } : { text: 'Défaite', tone: 'loss' };
  }
  if (m.status === 'DISPUTED') return { text: 'En litige', tone: 'muted' };
  if (m.status === 'CANCELLED') return { text: 'Annulé', tone: 'muted' };
  return { text: 'En attente de confirmation', tone: 'muted' };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function MyMatchesList({ matches, token, onChanged }: { matches: MyMatch[]; token: string; onChanged: () => void }) {
  const { th } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);

  const confirm = async (id: string) => {
    setBusy(id);
    try { await api.confirmMatch(id, token); onChanged(); }
    finally { setBusy(null); }
  };
  const submitDispute = async (id: string) => {
    const msg = reason.trim();
    if (!msg) return;
    setBusy(id);
    try { await api.disputeMatch(id, msg, token); setDisputingId(null); setReason(''); onChanged(); }
    finally { setBusy(null); }
  };

  if (!matches.length) return <p className="p-4 text-sm opacity-60">Aucun match enregistré.</p>;
  return (
    <ul className="space-y-2">
      {matches.map((m) => {
        const { partners, opponents } = splitTeams(m.players ?? [], m.myTeam);
        const me = (m.players ?? []).find((p) => p.isMe);
        const myRow = me ? [me, ...partners] : partners;
        const otherTeam = m.myTeam === 1 ? 2 : 1;
        const result = resultLabel(m);
        const resultColor = result.tone === 'win' ? ACCENTS.emerald : result.tone === 'loss' ? ACCENTS.coral : th.textMute;
        const hasThread = m.status === 'DISPUTED' || m.commentCount > 0;
        return (
          <li key={m.matchId} style={{ border: `1px solid ${th.line}`, background: th.surface, borderRadius: 14, padding: 14 }}>
            <div className="flex items-center justify-between gap-2">
              <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
                {formatDateTime(m.playedAt)} · {m.sport.name}
              </span>
              <span style={{
                flexShrink: 0, padding: '3px 10px', borderRadius: 999, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700,
                color: result.tone === 'muted' ? th.textMute : resultColor,
                background: result.tone === 'muted' ? th.surface2 : `${resultColor}1A`,
              }}>{result.text}</span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: `minmax(0, 1fr) repeat(${m.sets.length}, 32px)`,
              alignItems: 'center', rowGap: 10, marginTop: 12,
            }}>
              <ScoreboardRow players={myRow} side={m.myTeam} sets={m.sets} th={th} />
              <span aria-hidden="true" style={{ gridColumn: '1 / -1', height: 1, background: th.line }} />
              <ScoreboardRow players={opponents} side={otherTeam} sets={m.sets} th={th} />
            </div>

            <div className="mt-3" style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
              {m.club.name}{m.resource ? ` · ${m.resource.name}` : ''}
            </div>

            {m.needsMyConfirmation && disputingId !== m.matchId && (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy === m.matchId} onClick={() => confirm(m.matchId)}
                  className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Confirmer</button>
                <button type="button" disabled={busy === m.matchId} onClick={() => { setDisputingId(m.matchId); setReason(''); }}
                  className="rounded-lg bg-black/10 px-3 py-1.5 text-sm disabled:opacity-40">Contester</button>
              </div>
            )}

            {disputingId === m.matchId && (
              <div className="mt-2 space-y-2">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2}
                  placeholder="Expliquez le litige (score, joueurs…)" autoFocus
                  className="w-full rounded-lg border p-2 text-sm" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy === m.matchId || !reason.trim()} onClick={() => submitDispute(m.matchId)}
                    className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                    aria-label="Envoyer la contestation">Envoyer la contestation</button>
                  <button type="button" onClick={() => { setDisputingId(null); setReason(''); }}
                    className="rounded-lg bg-black/10 px-3 py-1.5 text-sm">Annuler</button>
                </div>
              </div>
            )}

            {hasThread && (
              <div className="mt-2">
                <button type="button" onClick={() => setOpenThread(openThread === m.matchId ? null : m.matchId)}
                  className="text-sm font-semibold underline opacity-80">
                  💬 Discussion{m.commentCount > 0 ? ` (${m.commentCount})` : ''}
                </button>
                {openThread === m.matchId && (
                  <MatchDiscussion matchId={m.matchId} token={token} canWrite={m.status === 'DISPUTED'} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
