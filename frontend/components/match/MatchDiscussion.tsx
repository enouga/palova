'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchComment } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';

// Fil de discussion d'un match en litige. Réutilisé côté joueur et côté staff.
export function MatchDiscussion({ matchId, token, canWrite }: { matchId: string; token: string; canWrite: boolean }) {
  const [comments, setComments] = useState<MatchComment[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getMatchComments(matchId, token).then((t) => setComments(t.comments)).catch(() => setComments([]));
  }, [matchId, token]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try { await api.postMatchComment(matchId, text, token); setBody(''); load(); }
    finally { setBusy(false); }
  };

  if (comments === null) return <p className="p-2 text-sm opacity-60">Chargement…</p>;

  return (
    <div className="mt-2 rounded-lg bg-black/[0.03] p-3">
      <div className="space-y-3">
        {comments.length === 0 && <p className="text-sm opacity-60">Aucun message.</p>}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Avatar firstName={c.author.firstName} lastName={c.author.lastName} avatarUrl={c.author.avatarUrl} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">{c.author.firstName} {c.author.lastName}</span>
                {c.isStaff && <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Staff</span>}
                <span className="opacity-50">
                  {new Date(c.createdAt).toLocaleDateString('fr-FR')} {new Date(c.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      {canWrite ? (
        <div className="mt-3 flex gap-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2}
            placeholder="Votre message…" className="flex-1 rounded-lg border p-2 text-sm" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
          <button type="button" disabled={busy || !body.trim()} onClick={send}
            className="self-end rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Envoyer</button>
        </div>
      ) : (
        <p className="mt-3 text-xs opacity-50">Discussion close.</p>
      )}
    </div>
  );
}
