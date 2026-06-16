'use client';
import { useState } from 'react';
import { api, MyMatch } from '@/lib/api';
import { scoreLine } from '@/lib/match';

export function MyMatchesList({ matches, token, onChanged }: { matches: MyMatch[]; token: string; onChanged: () => void }) {
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
        const won = m.winningTeam === m.myTeam;
        return (
          <li key={m.matchId} className="rounded-xl border p-3" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{scoreLine(m.sets)}</span>
              <span className="text-xs opacity-60">{new Date(m.playedAt).toLocaleDateString('fr-FR')}</span>
            </div>
            <div className="mt-1 text-sm opacity-70">
              {m.status === 'CONFIRMED' ? (won ? 'Victoire' : 'Défaite')
                : m.status === 'DISPUTED' ? 'En litige'
                : m.status === 'CANCELLED' ? 'Annulé' : 'En attente de confirmation'}
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
