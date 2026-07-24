'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToRecord } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { teamRows, teamLabel } from '@/lib/resultsToRecord';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

// Prompt personnel « Résultats à saisir » : UNE carte, une ligne fine par match padel joué sans
// résultat. Le clic « Saisir » ouvre la feuille de saisie avec les équipes pré-remplies.
// Rendu null si rien à saisir. `clubSlug` restreint au club courant ; `onRecorded` rafraîchit le parent.
export function ResultsToRecord({ token, clubSlug, onRecorded }: {
  token: string | null;
  clubSlug?: string;
  onRecorded?: () => void;
}) {
  const { th } = useTheme();
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

  const kicker = {
    fontFamily: th.fontUI, fontSize: 10.5, letterSpacing: '2.2px',
    textTransform: 'uppercase' as const, fontWeight: 700, color: th.textMute,
  };

  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ background: th.surface, borderRadius: 18, boxShadow: th.shadow, overflow: 'hidden' }}>
        <div style={{ padding: '13px 18px 11px' }}>
          <span style={kicker}>
            {rows.length > 1 ? `Résultats à saisir · ${rows.length}` : 'Résultat à saisir'}
          </span>
        </div>

        {rows.map((m) => {
          const [team1, team2] = teamRows(m.players);
          const avatars = [...team1, ...team2];
          return (
            <div key={m.reservationId} className="results-row" style={{ padding: '11px 18px', borderTop: `1px solid ${th.line}` }}>
              <div className="results-head" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ display: 'flex', flexShrink: 0 }}>
                  {avatars.map((p, i) => (
                    <span key={p.userId} style={{
                      marginLeft: i === 0 ? 0 : -7, borderRadius: '50%',
                      border: `2px solid ${th.surface}`, display: 'flex', flexShrink: 0,
                    }}>
                      <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={26} color={colorForSeed(p.userId)} />
                    </span>
                  ))}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, lineHeight: 1.4,
                  }}>
                    <span>{teamLabel(team1, m.players)}</span>
                    <span style={{ color: th.textFaint, fontWeight: 600, fontSize: 11.5, margin: '0 6px' }}>vs</span>
                    <span>{teamLabel(team2, m.players)}</span>
                  </div>
                  <div style={{
                    fontFamily: th.fontMono, fontSize: 11, color: th.textMute, marginTop: 2,
                  }}>
                    {m.resourceName} · {fmtWhen(m.startTime, m.club.timezone)}
                  </div>
                </div>
              </div>

              <div className="results-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                {m.competitive === false && <Chip tone="line">Pour le fun</Chip>}
                <button type="button" onClick={() => setRecordingFor(m)} style={{
                  flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 99,
                  padding: '8px 16px', background: th.accent, color: th.onAccent,
                  fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                }}>
                  Saisir
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
