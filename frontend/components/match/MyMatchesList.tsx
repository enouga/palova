'use client';
import { useState } from 'react';
import { api, MyMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { scoreLine, splitTeams } from '@/lib/match';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { MatchDiscussion } from '@/components/match/MatchDiscussion';

function PlayerChip({ p }: { p: { userId: string; firstName: string; lastName: string } }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={22} color={colorForSeed(p.userId)} />
      <span>{p.firstName} {p.lastName}</span>
    </span>
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
        const result = resultLabel(m);
        const resultColor = result.tone === 'win' ? ACCENTS.emerald : result.tone === 'loss' ? ACCENTS.coral : th.textMute;
        const hasThread = m.status === 'DISPUTED' || m.commentCount > 0;
        return (
          <li key={m.matchId} className="rounded-xl border p-3" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{scoreLine(m.sets)}</span>
              <span className="text-xs font-semibold" style={{ color: resultColor }}>{result.text}</span>
            </div>

            <div className="mt-2 space-y-1 text-sm">
              {partners.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="opacity-50">Avec</span>
                  {partners.map((p) => <PlayerChip key={p.userId} p={p} />)}
                </div>
              )}
              {opponents.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="opacity-50">Contre</span>
                  {opponents.map((p) => <PlayerChip key={p.userId} p={p} />)}
                </div>
              )}
            </div>

            <div className="mt-2 text-xs opacity-60">{formatDateTime(m.playedAt)} · {m.sport.name}</div>
            <div className="text-xs opacity-60">{m.club.name}{m.resource ? ` · ${m.resource.name}` : ''}</div>

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
