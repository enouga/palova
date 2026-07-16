'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToRecord, MatchToRecordPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import type { Theme } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { abbrevName, teamRows } from '@/lib/resultsToRecord';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

// Trois cases de set vides, en pointillés : elles annoncent la saisie sans être
// cliquables (le CTA reste l'unique chemin). La 3e est estompée — le 3e set est optionnel.
function SetBoxes({ th, compact }: { th: Theme; compact: boolean }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: compact ? 6 : 7, flexShrink: 0 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: compact ? 28 : 34, height: compact ? 32 : 38, borderRadius: 9, flexShrink: 0,
          border: `1.5px dashed ${i === 2 ? th.line : th.lineStrong}`,
        }} />
      ))}
    </div>
  );
}

// Une rangée d'équipe : la paire d'avatars qui se chevauchent, les deux noms, les cases de sets.
function TeamRow({ th, players, compact }: { th: Theme; players: MatchToRecordPlayer[]; compact: boolean }) {
  const size = compact ? 28 : 34;
  const label = players
    .map((p) => (compact ? abbrevName(p.firstName, p.lastName) : `${p.firstName} ${p.lastName}`))
    .join(' & ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 14, padding: '6px 0' }}>
      <span style={{ display: 'flex', flexShrink: 0 }}>
        {players.map((p, i) => (
          <span key={p.userId} style={{
            marginLeft: i === 0 ? 0 : -(size * 0.28), borderRadius: '50%',
            border: `2px solid ${th.surface}`, display: 'flex', flexShrink: 0,
          }}>
            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={size} color={colorForSeed(p.userId)} />
          </span>
        ))}
      </span>
      <div style={{
        flex: 1, minWidth: 0, fontFamily: th.fontUI, fontWeight: 700, fontSize: compact ? 13 : 14.5,
        color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <SetBoxes th={th} compact={compact} />
    </div>
  );
}

// Prompt personnel « Résultat à saisir » : liste les matchs padel joués sans résultat et
// ouvre la modale de saisie avec les équipes pré-remplies. Rendu null si rien à saisir.
// `clubSlug` restreint au club courant ; `onRecorded` laisse la surface parente se rafraîchir.
export function ResultsToRecord({ token, clubSlug, onRecorded }: {
  token: string | null;
  clubSlug?: string;
  onRecorded?: () => void;
}) {
  const { th } = useTheme();
  const compact = !useIsDesktop(560);
  const [rows, setRows] = useState<MatchToRecord[]>([]);
  const [recordingFor, setRecordingFor] = useState<MatchToRecord | null>(null);

  const reload = useCallback(() => {
    if (!token) { setRows([]); return; }
    api.getMatchesToRecord(token)
      .then((r) => setRows(clubSlug ? r.filter((m) => m.club.slug === clubSlug) : r))
      .catch(() => setRows([]));
  }, [token, clubSlug]);

  useEffect(() => { reload(); }, [reload]);

  if (!token || rows.length === 0) return null;

  const pad = compact ? 16 : 20;
  const kicker = {
    fontFamily: th.fontUI, fontSize: compact ? 10 : 10.5, letterSpacing: '2.2px',
    textTransform: 'uppercase' as const, fontWeight: 700,
  };
  const rule = { height: 1, background: th.line };

  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((m) => {
          const [team1, team2] = teamRows(m.players);
          return (
            <div key={m.reservationId} style={{ background: th.surface, borderRadius: 18, boxShadow: th.shadow, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: `13px ${pad}px` }}>
                <span style={{ ...kicker, color: th.textMute }}>Résultat à saisir</span>
                {m.competitive === false
                  ? <Chip tone="line">Amicale</Chip>
                  : <Chip tone="accent">Compétitive</Chip>}
              </div>

              <div style={rule} />

              <div style={{ padding: `${compact ? 8 : 10}px ${pad}px ${compact ? 4 : 6}px` }}>
                {!compact && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 2 }}>
                    <span aria-hidden="true" style={{ ...kicker, fontSize: 9, letterSpacing: '3px', color: th.textFaint, width: 116, textAlign: 'center' }}>Sets</span>
                  </div>
                )}
                <TeamRow th={th} players={team1} compact={compact} />
                <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 12 }}>
                  <div style={{ flex: 1, ...rule }} />
                  <span style={{ ...kicker, fontSize: compact ? 9.5 : 10.5, letterSpacing: '3px', color: th.textFaint }}>vs</span>
                  <div style={{ flex: 1, ...rule }} />
                </div>
                <TeamRow th={th} players={team2} compact={compact} />
              </div>

              <div style={rule} />

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: compact ? 10 : 12,
                padding: `${compact ? 10 : 12}px ${pad}px`, background: th.surface2,
              }}>
                <span style={{
                  fontFamily: th.fontMono, fontSize: compact ? 11 : 12, color: th.textMute,
                  minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {m.resourceName} · {fmtWhen(m.startTime, m.club.timezone)}
                </span>
                <button type="button" onClick={() => setRecordingFor(m)}
                  style={{
                    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 99,
                    padding: compact ? '8px 15px' : '9px 18px', background: th.accent, color: th.onAccent,
                    fontFamily: th.fontUI, fontSize: compact ? 12.5 : 13, fontWeight: 700,
                  }}>
                  {compact ? 'Saisir' : 'Saisir le score'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.reservationId}
          players={recordingFor.players.map((p) => ({ userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl }))}
          token={token}
          context={{ whenIso: recordingFor.startTime, tz: recordingFor.club.timezone, courtName: recordingFor.resourceName }}
          initialTeams={Object.fromEntries(recordingFor.players.map((p) => [p.userId, p.team]))}
          locked={recordingFor.visibility === 'PUBLIC'}
          competitive={recordingFor.competitive ?? true}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); reload(); onRecorded?.(); }}
        />
      )}
    </div>
  );
}
