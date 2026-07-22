'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToConfirm } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { teamRows, teamLabel, scoreSummary } from '@/lib/resultsToConfirm';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

function fmtDeadline(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

// Prompt personnel « Résultats à confirmer » : miroir de ResultsToRecord pour les matchs PENDING
// où quelqu'un d'autre a saisi le score et où ma confirmation est encore PENDING. « Confirmer »
// valide en 1 tap ; « Contester » déplie un motif obligatoire (même comportement que
// MyMatchesList, en état local propre à ce composant — MyMatchesList reste inchangée). Rendu
// null si rien à confirmer. `clubSlug` restreint au club courant ; `onChanged` rafraîchit le parent.
export function ResultsToConfirm({ token, clubSlug, onChanged }: {
  token: string | null;
  clubSlug?: string;
  onChanged?: () => void;
}) {
  const { th } = useTheme();
  const [rows, setRows] = useState<MatchToConfirm[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = useCallback(() => {
    if (!token) { setRows([]); return; }
    api.getMatchesToConfirm(token)
      .then((r) => setRows(clubSlug ? r.filter((m) => m.club.slug === clubSlug) : r))
      .catch(() => setRows([]));
  }, [token, clubSlug]);

  useEffect(() => { reload(); }, [reload]);

  const confirm = async (matchId: string) => {
    if (!token) return;
    setBusy(matchId);
    try { await api.confirmMatch(matchId, token); reload(); onChanged?.(); }
    finally { setBusy(null); }
  };

  const submitDispute = async (matchId: string) => {
    const msg = reason.trim();
    if (!msg || !token) return;
    setBusy(matchId);
    try {
      await api.disputeMatch(matchId, msg, token);
      setDisputingId(null);
      setReason('');
      reload();
      onChanged?.();
    } finally { setBusy(null); }
  };

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
            {rows.length > 1 ? `Résultats à confirmer · ${rows.length}` : 'Résultat à confirmer'}
          </span>
        </div>

        {rows.map((m) => {
          const [team1, team2] = teamRows(m.players);
          const avatars = [...team1, ...team2];
          const disputing = disputingId === m.matchId;
          const metaParts = [scoreSummary(m.sets)];
          if (m.resourceName) metaParts.push(m.resourceName);
          metaParts.push(fmtWhen(m.playedAt, m.club.timezone));
          metaParts.push(`Auto-confirmé ${fmtDeadline(m.confirmDeadline, m.club.timezone)}`);

          return (
            <div key={m.matchId} style={{ padding: '11px 18px', borderTop: `1px solid ${th.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                    fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <span>{teamLabel(team1, m.players)}</span>
                    <span style={{ color: th.textFaint, fontWeight: 600, fontSize: 11.5, margin: '0 6px' }}>vs</span>
                    <span>{teamLabel(team2, m.players)}</span>
                  </div>
                  <div style={{
                    fontFamily: th.fontMono, fontSize: 11, color: th.textMute, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {metaParts.join(' · ')}
                  </div>
                </div>

                {m.competitive === false && <Chip tone="line">Pour le fun</Chip>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" disabled={busy === m.matchId} onClick={() => confirm(m.matchId)} style={{
                  border: 'none', cursor: 'pointer', borderRadius: 99, padding: '8px 16px',
                  background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                  opacity: busy === m.matchId ? 0.5 : 1,
                }}>
                  Confirmer
                </button>
                <button type="button" disabled={busy === m.matchId}
                  onClick={() => { setDisputingId(disputing ? null : m.matchId); setReason(''); }} style={{
                    border: 'none', cursor: 'pointer', borderRadius: 99, padding: '8px 16px',
                    background: th.surface2, color: th.text, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                    opacity: busy === m.matchId ? 0.5 : 1,
                  }}>
                  Contester
                </button>
              </div>

              {disputing && (
                <div style={{ marginTop: 8 }}>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2}
                    placeholder="Expliquez le litige (score, joueurs…)" autoFocus
                    style={{ width: '100%', borderRadius: 10, border: `1px solid ${th.line}`, padding: 8, fontFamily: th.fontUI, fontSize: 13, color: th.text, background: th.bg }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" disabled={busy === m.matchId || !reason.trim()} onClick={() => submitDispute(m.matchId)}
                      aria-label="Envoyer la contestation" style={{
                        border: 'none', cursor: 'pointer', borderRadius: 99, padding: '7px 14px',
                        background: th.text, color: th.bg, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                        opacity: (busy === m.matchId || !reason.trim()) ? 0.5 : 1,
                      }}>
                      Envoyer la contestation
                    </button>
                    <button type="button" onClick={() => { setDisputingId(null); setReason(''); }} style={{
                      border: 'none', cursor: 'pointer', borderRadius: 99, padding: '7px 14px',
                      background: th.surface2, color: th.text, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                    }}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
