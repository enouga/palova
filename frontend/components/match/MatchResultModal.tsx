'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { SetScore, validSets } from '@/lib/match';

interface Player { userId: string; firstName: string; lastName: string; avatarUrl: string | null; }
interface Props {
  reservationId: string;
  players: Player[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
}

export function MatchResultModal({ reservationId, players, token, onClose, onSaved }: Props) {
  const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>({});
  const [sets, setSets] = useState<SetScore[]>([[0, 0]]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t1 = players.filter((p) => team[p.userId] === 1).map((p) => p.userId);
  const t2 = players.filter((p) => team[p.userId] === 2).map((p) => p.userId);
  const compositionOk = t1.length === 2 && t2.length === 2;
  const setsOk = validSets(sets);
  const canSave = compositionOk && setsOk && !busy;

  const assign = (userId: string, t: 1 | 2) =>
    setTeam((prev) => ({ ...prev, [userId]: prev[userId] === t ? undefined : t }));

  const bump = (i: number, side: 0 | 1, delta: number) =>
    setSets((prev) => prev.map((s, idx) => (idx === i
      ? (side === 0 ? [Math.max(0, Math.min(7, s[0] + delta)), s[1]] : [s[0], Math.max(0, Math.min(7, s[1] + delta))]) as SetScore
      : s)));

  const teamFull = (t: 1 | 2, userId: string) => (t === 1 ? t1 : t2).length >= 2 && team[userId] !== t;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.recordMatchResult(reservationId, { teams: { 1: t1, 2: t2 }, sets }, token);
      onSaved();
    } catch {
      setError('Échec de l’enregistrement.');
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <h2 className="mb-3 text-lg font-semibold">Saisir le résultat</h2>

        <div className="mb-4 space-y-2">
          {players.map((p) => (
            <div key={p.userId} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.firstName} {p.lastName}</span>
              <span className="flex gap-1">
                <button type="button" data-testid={`team1-${p.userId}`} disabled={teamFull(1, p.userId)}
                  onClick={() => assign(p.userId, 1)}
                  className={`rounded-lg px-2 py-1 text-sm ${team[p.userId] === 1 ? 'bg-black text-white' : 'bg-black/10'} disabled:opacity-40`}>
                  Équipe 1
                </button>
                <button type="button" data-testid={`team2-${p.userId}`} disabled={teamFull(2, p.userId)}
                  onClick={() => assign(p.userId, 2)}
                  className={`rounded-lg px-2 py-1 text-sm ${team[p.userId] === 2 ? 'bg-black text-white' : 'bg-black/10'} disabled:opacity-40`}>
                  Équipe 2
                </button>
              </span>
            </div>
          ))}
        </div>

        <div className="mb-4 space-y-2">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center justify-center gap-3">
              <span className="w-12 text-right text-sm opacity-70">Set {i + 1}</span>
              {[0, 1].map((sideRaw) => {
                const side = sideRaw as 0 | 1;
                return (
                  <span key={side} className="flex items-center gap-1">
                    <button type="button" data-testid={`set${i}-team${side + 1}-minus`} onClick={() => bump(i, side, -1)} className="rounded bg-black/10 px-2">−</button>
                    <span className="w-6 text-center font-semibold">{s[side]}</span>
                    <button type="button" data-testid={`set${i}-team${side + 1}-plus`} onClick={() => bump(i, side, +1)} className="rounded bg-black/10 px-2">+</button>
                  </span>
                );
              })}
            </div>
          ))}
          {sets.length < 3 && (
            <button type="button" onClick={() => setSets((p) => [...p, [0, 0]])} className="text-sm underline opacity-70">+ Ajouter un set</button>
          )}
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {!compositionOk && <p className="mb-2 text-xs opacity-60">Affecte 2 joueurs par équipe.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm">Annuler</button>
          <button type="button" disabled={!canSave} onClick={save}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
