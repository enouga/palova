'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { validSets, winnerFromSets } from '@/lib/match';
import { emptyGrid, applyDigit, backspace as gridBackspace, gridToSets, setWinner, type Grid } from '@/lib/scoreGrid';
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
  initialTeams?: Record<string, 1 | 2>;
  competitive?: boolean; // valeur initiale (privé) OU type déclaré (partie ouverte, verrouillé)
  locked?: boolean;      // true = partie ouverte : type hérité de la résa, non modifiable ici
}

const TEAM_COLORS: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };

function fmtContext(ctx: MatchContext): string {
  const d = new Date(ctx.whenIso);
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: ctx.tz }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: ctx.tz }).format(d).replace(':', 'h');
  return `${date} · ${hour} · ${ctx.courtName}`;
}

export function MatchResultModal({ reservationId, players, token, onClose, onSaved, context, initialTeams, competitive, locked }: Props) {
  const { th } = useTheme();

  // Équipes pré-remplies complètes (4 joueurs, 2/2) → on démarre au tableau de score ; sinon affectation.
  const preFilled2v2 = (() => {
    if (!initialTeams) return false;
    const assigned = players.filter((p) => initialTeams[p.userId] === 1 || initialTeams[p.userId] === 2);
    if (assigned.length !== players.length || players.length !== 4) return false;
    return assigned.filter((p) => initialTeams[p.userId] === 1).length === 2
      && assigned.filter((p) => initialTeams[p.userId] === 2).length === 2;
  })();

  const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>(() => ({ ...(initialTeams ?? {}) }));
  const [competitiveState, setCompetitiveState] = useState(competitive ?? true);
  const [phase, setPhase] = useState<'assign' | 'score'>(preFilled2v2 ? 'score' : 'assign');
  const [grid, setGrid] = useState<Grid>(emptyGrid);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showAssignment = phase === 'assign';

  const t1 = players.filter((p) => team[p.userId] === 1).map((p) => p.userId);
  const t2 = players.filter((p) => team[p.userId] === 2).map((p) => p.userId);
  const compositionOk = t1.length === 2 && t2.length === 2;

  const sets = gridToSets(grid);
  const setsOk = validSets(sets);
  const wins: [number, number] = sets.reduce<[number, number]>(
    (acc, [a, b]) => { if (a > b) acc[0]++; else if (b > a) acc[1]++; return acc; }, [0, 0]);
  const winner = compositionOk && setsOk && wins[0] !== wins[1] ? winnerFromSets(sets) : null;
  const canSave = compositionOk && setsOk && winner != null && !busy;

  const assign = (userId: string, t: 1 | 2) =>
    setTeam((prev) => ({ ...prev, [userId]: prev[userId] === t ? undefined : t }));
  const teamFull = (t: 1 | 2, userId: string) => (t === 1 ? t1 : t2).length >= 2 && team[userId] !== t;
  const teamNames = (n: 1 | 2) => players.filter((p) => team[p.userId] === n);

  const pressDigit = (d: number) => { const r = applyDigit(grid, cursor, d); setGrid(r.grid); setCursor(r.cursor); };
  const pressBack = () => { const r = gridBackspace(grid, cursor); setGrid(r.grid); setCursor(r.cursor); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.recordMatchResult(reservationId, { teams: { 1: t1, 2: t2 }, sets, competitive: competitiveState }, token);
      onSaved();
    } catch {
      setError('Échec de l’enregistrement.');
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="match-result-title" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="w-full max-w-md rounded-t-2xl p-4 sm:rounded-2xl" style={{ background: th.surface, color: th.text, fontFamily: th.fontUI, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="match-result-title" className="text-lg font-semibold">Saisir le résultat</h2>
            {context && <p className="mt-0.5 text-sm" style={{ color: th.textMute }}>{fmtContext(context)}</p>}
          </div>
          {locked ? (
            <span style={{
              flexShrink: 0, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '5px 10px',
              background: competitiveState ? `${th.accent}22` : 'transparent', color: competitiveState ? th.accent : th.textMute,
              border: competitiveState ? 'none' : `1px solid ${th.line}`,
            }}>
              {competitiveState ? 'Compétitive' : 'Amicale'}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', flexShrink: 0, borderRadius: 99, overflow: 'hidden', border: `1px solid ${th.line}` }}>
              {([['competitive', 'Compétitive'], ['friendly', 'Amicale']] as const).map(([key, label]) => {
                const active = (key === 'competitive') === competitiveState;
                return (
                  <button key={key} type="button" onClick={() => setCompetitiveState(key === 'competitive')} disabled={busy}
                    style={{
                      cursor: 'pointer', border: 'none', padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
                      background: active ? th.accent : 'transparent', color: active ? th.onAccent : th.textMute,
                    }}>
                    {label}
                  </button>
                );
              })}
            </span>
          )}
        </div>

        <p className="mb-3 text-xs" style={{ color: th.textFaint }}>
          {locked
            ? (competitiveState ? 'Partie compétitive — le résultat compte pour le niveau.' : 'Partie amicale — le niveau ne bouge pas.')
            : (competitiveState ? 'Compte pour le niveau.' : 'Le niveau ne bouge pas.')}
        </p>

        {showAssignment ? (
          <>
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
                        <button key={t} type="button" data-testid={`team${t}-${p.userId}`} data-active={active ? 'true' : 'false'} aria-label={`Équipe ${t}`} disabled={teamFull(t, p.userId)}
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

            {!compositionOk && <p className="mb-3 text-xs" style={{ color: th.textMute }}>Affecte 2 joueurs par équipe.</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: th.textMute }}>Annuler</button>
              <button type="button" disabled={!compositionOk} onClick={() => setPhase('score')}
                className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: th.accent, color: th.onAccent }}>
                Continuer
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2">
              {([1, 2] as const).map((n) => {
                const names = teamNames(n).map((p) => `${p.firstName} ${p.lastName}`).join(' & ');
                return (
                  <div key={n} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: th.surface2 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: TEAM_COLORS[n], flexShrink: 0 }} />
                    <span className="text-xs font-semibold" style={{ color: th.textMute }}>Éq. {n}</span>
                    <span className="ml-1 truncate text-sm font-medium">{names}</span>
                  </div>
                );
              })}
              <button type="button" onClick={() => setPhase('assign')} className="self-start text-sm underline" style={{ color: th.textMute }}>
                Modifier les équipes
              </button>
            </div>

            <div className="mb-1 flex items-center justify-end gap-2 pr-1">
              {['S1', 'S2', 'S3'].map((s) => (
                <span key={s} style={{ width: 34, textAlign: 'center', fontSize: 9, letterSpacing: '2px', fontWeight: 700, color: th.textFaint }}>{s}</span>
              ))}
            </div>

            {([1, 2] as const).map((n) => (
              <div key={n} className="flex items-center gap-2 py-1">
                <span className="flex-1 truncate text-sm font-semibold">
                  {teamNames(n).map((p) => p.firstName).join(' & ')}
                </span>
                <div className="flex gap-2">
                  {[0, 1, 2].map((s) => {
                    const idx = s * 2 + (n - 1);
                    const val = grid[idx];
                    const w = setWinner(grid, s);
                    const isActive = cursor === idx;
                    const isWinner = w === n;
                    return (
                      <button key={s} type="button" data-testid={`cell-${s}-${n}`} onClick={() => setCursor(idx)}
                        style={{
                          width: 34, height: 40, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
                          fontFamily: th.fontUI, fontWeight: 800, fontSize: 16,
                          color: isWinner ? inkOn(th.accent) : th.text,
                          background: isWinner ? th.accent : (val != null ? th.surface2 : 'transparent'),
                          border: isActive ? `2px solid ${th.accent}` : (val != null ? `1.5px solid ${th.line}` : `1.5px dashed ${s === 2 ? th.line : th.lineStrong}`),
                        }}>
                        {val ?? ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 14, marginBottom: 4 }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} type="button" data-testid={`key-${d}`} onClick={() => pressDigit(d)}
                  style={{ width: 34, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer', background: th.surface2, color: th.text, fontFamily: th.fontUI, fontWeight: 700, fontSize: 15 }}>
                  {d}
                </button>
              ))}
              <button type="button" data-testid="key-back" aria-label="Effacer" onClick={pressBack}
                style={{ width: 44, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer', background: th.surface2, color: th.textMute, fontFamily: th.fontUI, fontWeight: 700, fontSize: 15 }}>
                ⌫
              </button>
            </div>

            {error && <p className="mb-2 mt-2 text-sm" style={{ color: ACCENTS.coral }}>{error}</p>}

            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: th.textMute }}>Annuler</button>
              <button type="button" disabled={!canSave} onClick={save}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                style={{ background: th.accent, color: th.onAccent }}>
                {winner
                  ? `Enregistrer — Victoire ${teamNames(winner).map((p) => p.firstName).join(' & ')} ${wins[winner - 1]}–${wins[winner === 1 ? 1 : 0]}`
                  : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
