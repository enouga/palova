'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, chatStreamUrl, OpenMatchMessage } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ReportDialog } from '@/components/moderation/ReportDialog';
import { colorForSeed } from '@/lib/playerColors';
import { CHAT_EMOJIS } from '@/lib/chatEmojis';

export interface OpenMatchChatSheetProps {
  slug: string;
  token: string;
  reservationId: string;
  viewerUserId: string;
  viewerIsOrganizer: boolean;
  canModerate?: boolean;
  title: string;
  timezone: string;
  onClose: () => void;
}

function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export function OpenMatchChatSheet({ slug, token, reservationId, viewerUserId, viewerIsOrganizer, canModerate, title, timezone, onClose }: OpenMatchChatSheetProps) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  const [messages, setMessages] = useState<OpenMatchMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OpenMatchMessage | null>(null);
  const [reportTarget, setReportTarget] = useState<OpenMatchMessage | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const addEmoji = (e: string) => setDraft((d) => (d + e).slice(0, 2000));

  const upsert = useCallback((m: OpenMatchMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = prev.slice(); next[i] = m; return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    api.getChatMessages(slug, reservationId, token).then((rows) => { if (alive) setMessages(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, reservationId, token]);

  useEffect(() => {
    const es = new EventSource(chatStreamUrl(slug, reservationId, token));
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; message?: OpenMatchMessage };
        if ((evt.type === 'chat_message' || evt.type === 'chat_deleted') && evt.message) upsert(evt.message);
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* EventSource reconnecte tout seul */ };
    return () => es.close();
  }, [slug, reservationId, token, upsert]);

  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }); }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft(''); setSendError(null);
    try { upsert(await api.postChatMessage(slug, reservationId, body, token)); }
    catch (err) {
      setDraft(body);
      if ((err as Error).message === 'RATE_LIMITED') setSendError('Vous envoyez trop de messages, patientez un instant.');
    }
    finally { setSending(false); }
  };

  const canDelete = (m: OpenMatchMessage) => !m.deleted && (m.author.userId === viewerUserId || viewerIsOrganizer || !!canModerate);

  const doDelete = async (m: OpenMatchMessage) => {
    try { upsert(await api.deleteChatMessage(slug, reservationId, m.id, token)); }
    catch { /* best-effort */ }
    finally { setPendingDelete(null); }
  };

  const startEdit = (m: OpenMatchMessage) => { setEditingId(m.id); setEditDraft(m.body); setEditError(null); };
  const cancelEdit = () => { setEditingId(null); setEditError(null); };
  const saveEdit = async (m: OpenMatchMessage) => {
    const body = editDraft.trim();
    if (!body) return;
    setEditBusy(true); setEditError(null);
    try { upsert(await api.editChatMessage(slug, reservationId, m.id, body, token)); setEditingId(null); }
    catch { setEditError('Échec de la modification, réessayez.'); }
    finally { setEditBusy(false); }
  };

  return (
    <div role="dialog" aria-label="Discussion de la partie"
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex',
        ...(isDesktop
          // Desktop : widget ancré en bas à droite, sans fond grisé — la page reste
          // visible ET cliquable (pointerEvents:none sur l'enveloppe, auto sur le panneau).
          ? { alignItems: 'flex-end', justifyContent: 'flex-end', padding: 24, background: 'transparent', pointerEvents: 'none' }
          : { flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.4)' }) }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
          ...(isDesktop
            ? { width: 'min(380px, 92vw)', maxHeight: '70vh', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }
            : { width: '100%', maxHeight: '85vh', borderTopLeftRadius: 20, borderTopRightRadius: 20 }) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${th.line}` }}>
          <Icon name="users" size={18} color={th.accent} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{title}</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5, padding: '24px 0' }}>
              Aucun message. Lancez la discussion !
            </div>
          ) : messages.map((m) => {
            const mine = m.author.userId === viewerUserId;
            return (
              <div key={m.id} style={{ display: 'flex', gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                <Avatar firstName={m.author.firstName} lastName={m.author.lastName} avatarUrl={m.author.avatarUrl} size={28} color={colorForSeed(m.author.userId)} />
                <div style={{ maxWidth: '72%' }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                    {m.author.firstName} · {hhmm(m.createdAt, timezone)}{m.edited ? ' · modifié' : ''}
                  </div>
                  {editingId === m.id ? (
                    <div>
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value.slice(0, 2000))} rows={2} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m); } }}
                        style={{ width: '100%', border: `1px solid ${th.line}`, borderRadius: 12, padding: '8px 12px', resize: 'vertical', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
                      {editError && <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.danger, marginTop: 3 }}>{editError}</div>}
                      <div style={{ display: 'flex', gap: 10, marginTop: 3, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <button type="button" onClick={cancelEdit} disabled={editBusy}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, padding: 0 }}>
                          Annuler
                        </button>
                        <button type="button" onClick={() => saveEdit(m)} disabled={editBusy || !editDraft.trim()}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, padding: 0 }}>
                          {editBusy ? '…' : 'Enregistrer'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ background: mine ? th.accent : th.surface, color: mine ? th.onAccent : th.text, borderRadius: 14, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 14, fontStyle: m.deleted ? 'italic' : 'normal', opacity: m.deleted ? 0.6 : 1 }}>
                        {m.deleted ? 'message supprimé' : m.body}
                      </div>
                      {(mine || canDelete(m) || (!m.deleted && !mine)) && (
                        <div style={{ display: 'flex', gap: 10, justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: 2 }}>
                          {mine && !m.deleted && (
                            <button type="button" onClick={() => startEdit(m)}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, padding: 0 }}>
                              Modifier
                            </button>
                          )}
                          {canDelete(m) && (
                            <button type="button" onClick={() => setPendingDelete(m)}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, padding: 0 }}>
                              Supprimer
                            </button>
                          )}
                          {!m.deleted && !mine && (
                            <button type="button" onClick={() => setReportTarget(m)}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, padding: 0 }}>
                              Signaler
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ position: 'relative', borderTop: `1px solid ${th.line}` }}>
          {sendError && (
            <div style={{ padding: '6px 16px 0', fontFamily: th.fontUI, fontSize: 12.5, color: th.danger }}>{sendError}</div>
          )}
          {emojiOpen && (
            <div role="menu" aria-label="Choisir un emoji"
              style={{ position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8, background: th.surface,
                boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`, borderRadius: 12, padding: 8,
                display: 'flex', flexWrap: 'wrap', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
              {CHAT_EMOJIS.map((e) => (
                <button key={e} type="button" aria-label={`Emoji ${e}`} onClick={() => addEmoji(e)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 6, borderRadius: 8 }}>
                  {e}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, padding: '10px 16px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
            <button type="button" aria-label="Emojis" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}
              style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: emojiOpen ? th.surface : 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 12px', color: th.text }}>
              🙂
            </button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setEmojiOpen(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setEmojiOpen(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Votre message…" maxLength={2000}
              style={{ flex: 1, minWidth: 0, border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
            <button type="button" aria-label="Envoyer" onClick={send} disabled={sending || !draft.trim()}
              style={{ border: 'none', borderRadius: 12, padding: '0 16px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700, cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.5 : 1 }}>
              Envoyer
            </button>
          </div>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Ce message sera retiré de la discussion."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {reportTarget && (
        <ReportDialog
          onCancel={() => setReportTarget(null)}
          onSubmit={async (reason, detail) => {
            await api.reportChatMessage(slug, reservationId, reportTarget.id, reason, detail || null, token);
          }}
        />
      )}
    </div>
  );
}
