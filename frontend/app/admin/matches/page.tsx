'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubMatch } from '@/lib/api';
import { scoreLine } from '@/lib/match';

// File des litiges de matchs du club : le staff valide (applique les niveaux) ou annule.
export default function AdminMatchesPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<ClubMatch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.getClubMatches(club.id, 'DISPUTED', token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);

  if (!club || !token) return null;

  const resolve = async (id: string, action: 'VALIDATE' | 'CANCEL') => {
    setBusy(id); setError(null);
    try { await api.resolveClubMatch(club.id, id, { action }, token); reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const teamNames = (m: ClubMatch, team: number) =>
    m.players.filter((p) => p.team === team).map((p) => `${p.user.firstName} ${p.user.lastName}`).join(' & ') || '—';

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, marginBottom: 6, color: th.text }}>Litiges de matchs</h1>
      <p style={{ fontFamily: th.fontUI, color: th.textMute, marginBottom: 16 }}>
        Un joueur a contesté ces résultats. Valide pour appliquer les niveaux, ou annule le match.
      </p>
      {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      {list.length === 0 ? (
        <p style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun litige.</p>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
          {list.map((m) => (
            <li key={m.id} style={{ border: `1px solid ${th.line}`, background: th.surface, borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontFamily: th.fontUI, fontSize: 17, color: th.text }}>{scoreLine(m.sets)}</strong>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
                  {new Date(m.playedAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 4 }}>
                {teamNames(m, 1)} <span style={{ opacity: 0.6 }}>vs</span> {teamNames(m, 2)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" disabled={busy === m.id} onClick={() => resolve(m.id, 'VALIDATE')}
                  style={{ fontFamily: th.fontUI, background: th.accent, color: th.onAccent, border: 'none', borderRadius: 10, padding: '7px 16px', fontWeight: 600, cursor: 'pointer', opacity: busy === m.id ? 0.5 : 1 }}>
                  Valider
                </button>
                <button type="button" disabled={busy === m.id} onClick={() => resolve(m.id, 'CANCEL')}
                  style={{ fontFamily: th.fontUI, background: 'transparent', color: th.text, border: `1px solid ${th.line}`, borderRadius: 10, padding: '7px 16px', cursor: 'pointer', opacity: busy === m.id ? 0.5 : 1 }}>
                  Annuler
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
