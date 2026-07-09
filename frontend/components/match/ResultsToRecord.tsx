'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToRecord } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { MatchResultModal } from '@/components/match/MatchResultModal';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
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

  const tint = (hex: string) => (th.mode === 'floodlit' ? `${hex}1f` : `${hex}55`);

  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((m) => (
          <div key={m.reservationId} style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 16, padding: 14, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, background: tint(ACCENTS.emerald), flexShrink: 0 }}>
              <Icon name="trophy" size={20} color={ACCENTS.emerald} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text }}>Résultat à saisir</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.resourceName} · {fmtWhen(m.startTime, m.club.timezone)}
              </div>
            </div>
            <button type="button" onClick={() => setRecordingFor(m)}
              style={{ flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '8px 14px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
              Saisir
            </button>
          </div>
        ))}
      </div>

      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.reservationId}
          players={recordingFor.players.map((p) => ({ userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl }))}
          token={token}
          context={{ whenIso: recordingFor.startTime, tz: recordingFor.club.timezone, courtName: recordingFor.resourceName }}
          initialTeams={Object.fromEntries(recordingFor.players.map((p) => [p.userId, p.team]))}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); reload(); onRecorded?.(); }}
        />
      )}
    </div>
  );
}
