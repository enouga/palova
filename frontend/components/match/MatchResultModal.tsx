'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { SetScore, validSets, winnerFromSets } from '@/lib/match';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

interface Player { userId: string; firstName: string; lastName: string; avatarUrl: string | null; }
interface MatchContext { whenIso: string; tz: string; courtName: string; }
interface Props {
  reservationId: string;
  players: Player[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  context?: MatchContext;
}

const TEAM_COLORS: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };

function fmtContext(ctx: MatchContext): string {
  const d = new Date(ctx.whenIso);
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: ctx.tz }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: ctx.tz }).format(d).replace(':', 'h');
  return `${date} · ${hour} · ${ctx.courtName}`;
}

export function MatchResultModal({ reservationId, players, token, onClose, onSaved, context }: Props) {
  const { th } = useTheme();
  const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>({});
  const [sets, setSets] = useState<SetScore[]>([[0, 0]]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t1 = players.filter((p) => team[p.userId] === 1).map((p) => p.userId);
  const t2 = players.filter((p) => team[p.userId] === 2).map((p) => p.userId);
  const compositionOk = t1.length === 2 && t2.length === 2;
  const setsOk = validSets(sets);
  const canSave = compositionOk && setsOk && !busy;

  const wins: [number, number] = sets.reduce<[number, number]>(
    (acc, [a, b]) => { if (a > b) acc[0]++; else if (b > a) acc[1]++; return acc; }, [0, 0]);
  const winner = compositionOk && setsOk ? winnerFromSets(sets) : null;

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

  const stepBtn = { border: `1px solid ${th.lineStrong}`, color: th.textMute } as const;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="w-full max-w-md rounded-t-2xl p-4 sm:rounded-2xl" style={{ background: th.surface, color: th.text, fontFamily: th.fontUI }}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Saisir le résultat</h2>
          {context && <p className="mt-0.5 text-sm" style={{ color: th.textMute }}>{fmtContext(context)}</p>}
        </div>

        <div className="mb-3 flex gap-2">
          {([1, 2] as const).map((n) => {
            const count = (n === 1 ? t1 : t2).length;
            return (
              <div key={n} className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2" style={{ background: th.surface2 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[n] }} />
                <span className="text-xs font-semibold">Équipe {n}</span>
                <span className="ml-auto text-xs" style={{ color: th.textMute }}>{count}/2</span>
              </div>
            );
          })}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          {players.map((p) => (
            <div key={p.userId} className="flex items-center gap-3">
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={30} color={colorForSeed(p.userId)} />
              <span className="flex-1 truncate text-sm">{p.firstName} {p.lastName}</span>
              <span className="inline-flex overflow-hidden rounded-lg" style={{ border: `1px solid ${th.lineStrong}` }}>
                {([1, 2] as const).map((t) => {
                  const active = team[p.userId] === t;
                  return (
                    <button key={t} type="button" data-testid={`team${t}-${p.userId}`} disabled={teamFull(t, p.userId)}
                      onClick={() => assign(p.userId, t)}
                      className="px-3 py-1 text-sm font-semibold disabled:opacity-40"
                      style={active ? { background: TEAM_COLORS[t], color: inkOn(TEAM_COLORS[t]) } : { background: th.surface2, color: th.textMute }}>
                      {t}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
        </div>

        <div className="mb-1 flex items-center gap-3">
          <span className="w-12" />
          <div className="ml-auto flex items-center gap-4">
            <span className="w-[92px] text-center text-xs font-semibold" style={{ color: TEAM_COLORS[1] }}>Éq. 1</span>
            <span className="w-[92px] text-center text-xs font-semibold" style={{ color: TEAM_COLORS[2] }}>Éq. 2</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-12 text-sm" style={{ color: th.textMute }}>Set {i + 1}</span>
              <div className="ml-auto flex items-center gap-4">
                {[0, 1].map((sideRaw) => {
                  const side = sideRaw as 0 | 1;
                  return (
                    <span key={side} className="flex w-[92px] items-center justify-center gap-2">
                      <button type="button" data-testid={`set${i}-team${side + 1}-minus`} onClick={() => bump(i, side, -1)} className="rounded-md px-2" style={stepBtn}>−</button>
                      <span className="w-5 text-center font-semibold">{s[side]}</span>
                      <button type="button" data-testid={`set${i}-team${side + 1}-plus`} onClick={() => bump(i, side, +1)} className="rounded-md px-2" style={stepBtn}>+</button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-3 mt-3 flex items-center justify-between">
          {sets.length < 3
            ? <button type="button" onClick={() => setSets((p) => [...p, [0, 0]])} className="text-sm underline" style={{ color: th.textMute }}>+ Ajouter un set</button>
            : <span />}
          {winner && (
            <span className="rounded-md px-2.5 py-1 text-xs font-semibold" style={{ background: TEAM_COLORS[winner], color: inkOn(TEAM_COLORS[winner]) }}>
              Équipe {winner} gagne {wins[winner - 1]}–{wins[winner === 1 ? 1 : 0]}
            </span>
          )}
        </div>

        {error && <p className="mb-2 text-sm" style={{ color: ACCENTS.coral }}>{error}</p>}
        {!compositionOk && <p className="mb-2 text-xs" style={{ color: th.textMute }}>Affecte 2 joueurs par équipe.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: th.textMute }}>Annuler</button>
          <button type="button" disabled={!canSave} onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: th.accent, color: th.onAccent }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
