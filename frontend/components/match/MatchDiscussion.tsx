'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchComment } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';

// Fil de discussion d'un match en litige. Réutilisé côté joueur et côté staff.
export function MatchDiscussion({ matchId, token, canWrite }: { matchId: string; token: string; canWrite: boolean }) {
  const { th } = useTheme();
  const [comments, setComments] = useState<MatchComment[] | null>(null);
  const [error, setError] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getMatchComments(matchId, token).then((t) => { setComments(t.comments); setError(false); })
      .catch(() => { setComments([]); setError(true); });
  }, [matchId, token]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try { await api.postMatchComment(matchId, text, token); setBody(''); load(); }
    finally { setBusy(false); }
  };

  if (comments === null) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, padding: '8px 0' }}>Chargement…</p>;
  }

  return (
    <div style={{ marginTop: 8, borderRadius: 12, background: th.surface2, padding: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && (
          <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.danger }}>
            Impossible de charger la discussion.
            <button type="button" onClick={load}
              style={{ marginLeft: 8, border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '4px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700 }}>Réessayer</button>
          </p>
        )}
        {!error && comments.length === 0 && (
          <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun message.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 8 }}>
            <Avatar firstName={c.author.firstName} lastName={c.author.lastName} avatarUrl={c.author.avatarUrl} size={28} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: th.text }}>{c.author.firstName} {c.author.lastName}</span>
                {c.isStaff && (
                  <span style={{ borderRadius: 6, background: th.surfaceHi, color: th.textMute, padding: '2px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Staff</span>
                )}
                <span style={{ color: th.textFaint }}>
                  {new Date(c.createdAt).toLocaleDateString('fr-FR')} {new Date(c.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', fontFamily: th.fontUI, fontSize: 13.5, color: th.text, margin: '3px 0 0' }}>{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      {canWrite ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2}
            placeholder="Votre message…" style={{
              flex: 1, borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text,
              padding: 8, fontFamily: th.fontUI, fontSize: 13.5, resize: 'vertical',
            }} />
          <button type="button" disabled={busy || !body.trim()} onClick={send} style={{
            alignSelf: 'flex-end', border: 'none', borderRadius: 10, background: th.accent, color: th.onAccent,
            padding: '7px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            opacity: busy || !body.trim() ? 0.4 : 1,
          }}>Envoyer</button>
        </div>
      ) : (
        <p style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Discussion close.</p>
      )}
    </div>
  );
}
