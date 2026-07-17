'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubMatch } from '@/lib/api';
import { scoreLine } from '@/lib/match';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MatchDiscussion } from '@/components/match/MatchDiscussion';

// Matchs du club : segment « Litiges » (le staff valide/annule) et « Matchs confirmés » (annulation avec motif).
export default function AdminMatchesPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [tab, setTab] = useState<'DISPUTED' | 'CONFIRMED'>('DISPUTED');
  const [list, setList] = useState<ClubMatch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ClubMatch | null>(null);
  const [reason, setReason] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.getClubMatches(club.id, tab, token).then((l) => { setList(l); setError(null); })
      .catch(() => { setList([]); setError('Impossible de charger les matchs pour le moment.'); });
  }, [club?.id, token, tab]);

  useEffect(() => { reload(); }, [reload]);

  if (!club || !token) return null;

  const resolve = async (id: string, action: 'VALIDATE' | 'CANCEL') => {
    setBusy(id); setError(null);
    try { await api.resolveClubMatch(club.id, id, { action }, token); reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const doVoid = async () => {
    if (!voiding || !club || !token) return;
    setBusy(voiding.id); setError(null);
    try {
      await api.voidClubMatch(club.id, voiding.id, { reason: reason.trim() }, token);
      setVoiding(null); setReason(''); reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const teamNames = (m: ClubMatch, team: number) =>
    m.players.filter((p) => p.team === team).map((p) => `${p.user.firstName} ${p.user.lastName}`).join(' & ') || '—';

  const segStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: th.fontUI,
    fontWeight: 600,
    fontSize: 14,
    padding: '7px 16px',
    borderRadius: 999,
    cursor: 'pointer',
    background: active ? th.accent : 'transparent',
    color: active ? th.onAccent : th.text,
    border: active ? 'none' : `1px solid ${th.line}`,
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button type="button" onClick={() => setTab('DISPUTED')} style={segStyle(tab === 'DISPUTED')}>Litiges</button>
        <button type="button" onClick={() => setTab('CONFIRMED')} style={segStyle(tab === 'CONFIRMED')}>Matchs confirmés</button>
      </div>

      {tab === 'DISPUTED' ? (
        <>
          <h1 style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, marginBottom: 6, color: th.text }}>Litiges de matchs</h1>
          <p style={{ fontFamily: th.fontUI, color: th.textMute, marginBottom: 16 }}>
            Un joueur a contesté ces résultats. Valide pour appliquer les niveaux, ou annule le match.
          </p>
          {error && <p style={{ color: th.danger, marginBottom: 12 }}>{error}</p>}
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
                  <MatchDiscussion matchId={m.id} token={token} canWrite />
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
        </>
      ) : (
        <>
          <h1 style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, marginBottom: 6, color: th.text }}>Matchs confirmés</h1>
          <p style={{ fontFamily: th.fontUI, color: th.textMute, marginBottom: 16 }}>
            Annuler un match recalcule les niveaux des joueurs et le retire de leur courbe de progression.
          </p>
          {error && <p style={{ color: th.danger, marginBottom: 12 }}>{error}</p>}
          {list.length === 0 ? (
            <p style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun match confirmé.</p>
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
                  {m.commentCount > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <button type="button" onClick={() => setOpenThread(openThread === m.id ? null : m.id)}
                        style={{ fontFamily: th.fontUI, fontSize: 13, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: th.text }}>
                        💬 Voir la discussion ({m.commentCount})
                      </button>
                      {openThread === m.id && <MatchDiscussion matchId={m.id} token={token} canWrite={false} />}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" disabled={busy === m.id} onClick={() => { setVoiding(m); setReason(''); }}
                      style={{ fontFamily: th.fontUI, background: 'transparent', color: th.text, border: `1px solid ${th.line}`, borderRadius: 10, padding: '7px 16px', cursor: 'pointer', opacity: busy === m.id ? 0.5 : 1 }}>
                      Annuler le match
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {voiding && (
        <ConfirmDialog
          title="Annuler ce match ?"
          detail={`${scoreLine(voiding.sets)} · ${new Date(voiding.playedAt).toLocaleDateString('fr-FR')}`}
          message={
            <>
              <p style={{ marginBottom: 10 }}>L&apos;annulation recalcule les niveaux des joueurs concernés et retire le match de leur courbe de progression.</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motif de l'annulation (obligatoire)"
                maxLength={200}
                rows={3}
                style={{ width: '100%', fontFamily: th.fontUI, padding: 10, borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text }}
              />
            </>
          }
          confirmLabel="Annuler le match"
          cancelLabel="Retour"
          busy={busy === voiding.id}
          confirmDisabled={!reason.trim()}
          onConfirm={doVoid}
          onCancel={() => { setVoiding(null); setReason(''); }}
        />
      )}
    </div>
  );
}
