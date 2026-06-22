'use client';
import { useState } from 'react';
import { api, MyMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { scoreLine, splitTeams } from '@/lib/match';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

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
  const act = async (id: string, kind: 'confirm' | 'dispute') => {
    setBusy(id);
    try { await (kind === 'confirm' ? api.confirmMatch(id, token) : api.disputeMatch(id, token)); onChanged(); }
    finally { setBusy(null); }
  };
  if (!matches.length) return <p className="p-4 text-sm opacity-60">Aucun match enregistré.</p>;
  return (
    <ul className="space-y-2">
      {matches.map((m) => {
        const { partners, opponents } = splitTeams(m.players ?? [], m.myTeam);
        const result = resultLabel(m);
        const resultColor = result.tone === 'win' ? ACCENTS.emerald : result.tone === 'loss' ? ACCENTS.coral : th.textMute;
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

            <div className="mt-2 text-xs opacity-60">
              {formatDateTime(m.playedAt)} · {m.sport.name}
            </div>
            <div className="text-xs opacity-60">
              {m.club.name}{m.resource ? ` · ${m.resource.name}` : ''}
            </div>

            {m.needsMyConfirmation && (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy === m.matchId} onClick={() => act(m.matchId, 'confirm')}
                  className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Confirmer</button>
                <button type="button" disabled={busy === m.matchId} onClick={() => act(m.matchId, 'dispute')}
                  className="rounded-lg bg-black/10 px-3 py-1.5 text-sm disabled:opacity-40">Contester</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
