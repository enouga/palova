'use client';
import { useState, useEffect } from 'react';
import { api, MyMatch, MyMatchPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, Theme } from '@/lib/theme';
import { splitTeams } from '@/lib/match';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { MatchDiscussion } from '@/components/match/MatchDiscussion';

/** Une ligne du tableau de score : avatars + noms de l'équipe, puis ses jeux par set (gras = set gagné). */
function ScoreboardRow({ players, side, sets, th, showConfirmations }: {
  players: MyMatchPlayer[]; side: number; sets: [number, number][]; th: Theme; showConfirmations?: boolean;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          {players.map((p, i) => (
            <span key={p.userId} style={{ position: 'relative', marginLeft: i > 0 ? -7 : 0, borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}`, lineHeight: 0 }}>
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={26} color={colorForSeed(p.userId)} />
              {showConfirmations && p.confirmation && (
                <span aria-hidden style={{
                  position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: '50%',
                  border: `2px solid ${th.surface}`, fontSize: 8, lineHeight: '8px', textAlign: 'center',
                  background: p.confirmation === 'CONFIRMED' ? ACCENTS.emerald : p.confirmation === 'DISPUTED' ? ACCENTS.coral : th.line,
                  color: '#fff',
                }}>{p.confirmation === 'CONFIRMED' ? '✓' : p.confirmation === 'DISPUTED' ? '!' : ''}</span>
              )}
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
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const [remindBusy, setRemindBusy] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<{ id: string; text: string } | null>(null);

  const remind = async (id: string) => {
    setRemindBusy(id);
    setRemindMsg(null);
    try {
      await api.remindMatch(id, token);
      setRemindMsg({ id, text: 'Relance envoyée ✓' });
    } catch (e) {
      const msg = (e as Error).message || '';
      setRemindMsg({ id, text: msg.includes('RATE_LIMITED') ? 'Déjà relancé, réessaie plus tard.' : 'Échec de la relance.' });
    } finally {
      setRemindBusy(null);
    }
  };

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
    <>
      <style>{`.mm-grid{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:700px){.mm-grid{grid-template-columns:1fr 1fr}}`}</style>
      <ul className="mm-grid">
      {matches.map((m) => {
        const { partners, opponents } = splitTeams(m.players ?? [], m.myTeam);
        const me = (m.players ?? []).find((p) => p.isMe);
        const myRow = me ? [me, ...partners] : partners;
        const otherTeam = m.myTeam === 1 ? 2 : 1;
        const result = resultLabel(m);
        const resultColor = result.tone === 'win' ? ACCENTS.emerald : result.tone === 'loss' ? ACCENTS.coral : th.textMute;
        const hasThread = m.status === 'DISPUTED' || m.commentCount > 0;
        const confirmedCount = (m.players ?? []).filter((p) => p.confirmation === 'CONFIRMED').length;
        const pendingOthers = (m.players ?? []).filter((p) => !p.isMe && p.confirmation === 'PENDING');
        const showValidation = m.status === 'PENDING';
        const autoValidateText = showValidation && m.confirmDeadline
          ? (now != null && new Date(m.confirmDeadline).getTime() <= now
              ? 'Validation en cours…'
              : `Se valide automatiquement le ${formatDateTime(m.confirmDeadline)}`)
          : null;
        return (
          <li key={m.matchId} style={{ border: `1px solid ${th.line}`, background: th.surface, borderRadius: 14, padding: 14 }}>
            <div className="flex items-center justify-between gap-2">
              <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {formatDateTime(m.playedAt)} · {m.sport.name}
                {m.competitive === false && (
                  <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: th.textMute, background: th.surface2, borderRadius: 8, padding: '2px 8px' }}>Amicale</span>
                )}
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
              <ScoreboardRow players={myRow} side={m.myTeam} sets={m.sets} th={th} showConfirmations={showValidation} />
              <span aria-hidden="true" style={{ gridColumn: '1 / -1', height: 1, background: th.line }} />
              <ScoreboardRow players={opponents} side={otherTeam} sets={m.sets} th={th} showConfirmations={showValidation} />
            </div>

            <div className="mt-3" style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
              {m.club.name}{m.resource ? ` · ${m.resource.name}` : ''}
            </div>

            {showValidation && (
              <div className="mt-2" style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, color: th.text }}>{confirmedCount}/4 validé</span>
                {autoValidateText && <span>✅ {autoValidateText}</span>}
                {pendingOthers.length > 0 && (
                  <button type="button" disabled={remindBusy === m.matchId} onClick={() => remind(m.matchId)}
                    className="rounded-lg bg-black/10 px-3 py-1.5 text-sm disabled:opacity-40">🔔 Relancer</button>
                )}
                {remindMsg?.id === m.matchId && <span style={{ color: th.textMute }}>{remindMsg.text}</span>}
              </div>
            )}

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
    </>
  );
}
