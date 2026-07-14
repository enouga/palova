'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, conversationStreamUrl, dmImageUrl, DmMessage, DmMeta, DmUserInfo, DmReaction } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ReportDialog } from '@/components/moderation/ReportDialog';
import { colorForSeed } from '@/lib/playerColors';
import { QUICK_REACTIONS } from '@/lib/chatEmojis';
import { dayKey, dayLabel, isReadByOther, applyReactionToggle } from '@/lib/messages';
import { MessageComposer } from './MessageComposer';

const TYPING_TTL = 5000;

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', 'h');
}

// Fil d'une conversation privée : bulles groupées par jour, envoi optimiste, réactions,
// ✓/✓✓ Lu, « X écrit… », pierre tombale, pagination par curseur, photos.
// Le parent (hub ou widget) rend l'en-tête ; onMeta lui remonte { blocked } pour le menu.
export function MessageThread({ conversationId, token, viewerUserId, other, onMeta, onUnreadCleared, initialDraft }: {
  conversationId: string;
  token: string;
  viewerUserId: string;
  other: DmUserInfo;
  onMeta?: (meta: DmMeta) => void;
  onUnreadCleared?: () => void;
  initialDraft?: string;
}) {
  const { th } = useTheme();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [meta, setMeta] = useState<DmMeta | null>(null);
  const [now, setNow] = useState<Date | null>(null); // horloge posée en effet — jamais new Date() au rendu
  const [typingUntil, setTypingUntil] = useState(0);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DmMessage | null>(null);
  const [reportTarget, setReportTarget] = useState<DmMessage | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [writeBlocked, setWriteBlocked] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<DmMessage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setNow(new Date()); }, []);

  const upsert = useCallback((m: DmMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = prev.slice(); next[i] = m; return next;
    });
  }, []);

  const markRead = useCallback(() => {
    api.markConversationRead(conversationId, token)
      .then(() => { window.dispatchEvent(new Event('palova:dm-unread')); onUnreadCleared?.(); })
      .catch(() => {});
  }, [conversationId, token, onUnreadCleared]);

  useEffect(() => {
    let alive = true;
    api.getDmMessages(conversationId, token).then((r) => {
      if (!alive) return;
      setMessages(r.messages); setMeta(r.meta); onMeta?.(r.meta);
    }).catch(() => {});
    markRead();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, token]);

  useEffect(() => {
    const es = new EventSource(conversationStreamUrl(conversationId, token));
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; message?: DmMessage; messageId?: string; reactions?: DmReaction[]; userId?: string; lastReadAt?: string };
        if ((evt.type === 'dm_message' || evt.type === 'dm_deleted') && evt.message) {
          upsert(evt.message);
          if (evt.type === 'dm_message' && evt.message.author.userId !== viewerUserId) { setTypingUntil(0); markRead(); }
        } else if (evt.type === 'dm_reaction' && evt.messageId) {
          setMessages((prev) => prev.map((m) => m.id === evt.messageId ? { ...m, reactions: evt.reactions ?? [] } : m));
        } else if (evt.type === 'dm_read' && evt.userId !== viewerUserId && evt.lastReadAt) {
          setMeta((prev) => prev ? { ...prev, otherLastReadAt: evt.lastReadAt! } : prev);
        } else if (evt.type === 'dm_typing' && evt.userId !== viewerUserId) {
          setTypingUntil(Date.now() + TYPING_TTL);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* EventSource reconnecte tout seul */ };
    return () => es.close();
  }, [conversationId, token, viewerUserId, upsert, markRead]);

  // L'indicateur « écrit… » expire tout seul.
  useEffect(() => {
    if (!typingUntil) return;
    const t = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(t);
  }, [typingUntil]);

  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }); }, [messages, typingUntil]);

  const handleSendError = (err: unknown) => {
    const msg = (err as Error).message;
    if (msg === 'NOT_CO_MEMBERS') setWriteBlocked(true);
    else if (msg === 'RATE_LIMITED') setSendError('Vous envoyez trop de messages, patientez un instant.');
  };
  const send = async (body: string) => {
    setSendError(null);
    try { upsert(await api.postDmMessage(conversationId, body, token)); return true; }
    catch (err) { handleSendError(err); return false; }
  };
  const sendImage = async (file: File, caption: string) => {
    setSendError(null);
    try { upsert(await api.uploadDmImage(conversationId, file, caption, token)); return true; }
    catch (err) { handleSendError(err); return false; }
  };
  const typing = () => { api.sendTyping(conversationId, token).catch(() => {}); };

  const toggleReaction = async (m: DmMessage, emoji: string) => {
    setReactFor(null);
    const iReacted = !!m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(viewerUserId);
    // patch optimiste, réconcilié par la réponse (et par le broadcast SSE)
    setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, reactions: applyReactionToggle(x.reactions, emoji, viewerUserId) } : x));
    try {
      const reactions = iReacted
        ? await api.removeDmReaction(conversationId, m.id, emoji, token)
        : await api.addDmReaction(conversationId, m.id, emoji, token);
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, reactions } : x));
    } catch { /* le prochain broadcast resynchronisera */ }
  };

  const doDelete = async (m: DmMessage) => {
    try { upsert(await api.deleteDmMessage(conversationId, m.id, token)); }
    catch { /* best-effort */ }
    finally { setPendingDelete(null); }
  };

  const startEdit = (m: DmMessage) => { setEditingId(m.id); setEditDraft(m.body); setEditError(null); };
  const cancelEdit = () => { setEditingId(null); setEditError(null); };
  const saveEdit = async (m: DmMessage) => {
    const body = editDraft.trim();
    if (!body) return;
    setEditBusy(true); setEditError(null);
    try { upsert(await api.editDmMessage(conversationId, m.id, body, token)); setEditingId(null); }
    catch { setEditError('Échec de la modification, réessayez.'); }
    finally { setEditBusy(false); }
  };

  const loadMore = async () => {
    if (loadingMore || !messages.length) return;
    setLoadingMore(true);
    try {
      const r = await api.getDmMessages(conversationId, token, messages[0].id);
      setMessages((prev) => [...r.messages, ...prev]);
      setMeta((prev) => prev ? { ...prev, hasMore: r.meta.hasMore } : r.meta);
    } catch { /* noop */ }
    finally { setLoadingMore(false); }
  };

  // Dernier de MES messages : seul porteur du ✓/✓✓ (pattern messenger).
  const lastMineId = [...messages].reverse().find((m) => m.author.userId === viewerUserId && !m.deleted)?.id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div ref={listRef} style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {meta?.hasMore && (
          <button type="button" onClick={loadMore} disabled={loadingMore}
            style={{ alignSelf: 'center', border: `1px solid ${th.line}`, background: th.surface, color: th.textMute,
              borderRadius: 999, padding: '5px 14px', fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer' }}>
            {loadingMore ? 'Chargement…' : 'Messages précédents'}
          </button>
        )}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5, padding: '24px 0' }}>
            Aucun message. Écrivez le premier !
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.author.userId === viewerUserId;
          const newDay = i === 0 || dayKey(m.createdAt) !== dayKey(messages[i - 1].createdAt);
          return (
            <Fragment key={m.id}>
              {newDay && now && (
                <div style={{ alignSelf: 'center', fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint,
                  background: th.surface, borderRadius: 999, padding: '2px 10px' }}>
                  {dayLabel(m.createdAt, now)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                <Avatar firstName={m.author.firstName} lastName={m.author.lastName} avatarUrl={m.author.avatarUrl}
                  size={28} color={colorForSeed(m.author.userId)} />
                <div style={{ maxWidth: '72%', position: 'relative' }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                    {hhmm(m.createdAt)}{m.edited ? ' · modifié' : ''}
                  </div>
                  {editingId === m.id ? (
                    <div>
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value.slice(0, 2000))} rows={2} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m); } }}
                        style={{ width: '100%', border: `1px solid ${th.line}`, borderRadius: 12, padding: '8px 12px', resize: 'vertical', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
                      {editError && <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: '#e0554f', marginTop: 3 }}>{editError}</div>}
                      <div style={{ display: 'flex', gap: 10, marginTop: 3, justifyContent: 'flex-end' }}>
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
                  <div style={{ background: mine ? th.accent : th.surface, color: mine ? th.onAccent : th.text,
                    borderRadius: 14, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 14,
                    fontStyle: m.deleted ? 'italic' : 'normal', opacity: m.deleted ? 0.6 : 1 }}>
                    {m.deleted ? 'message supprimé' : (
                      <>
                        {m.imageUrl && (
                          <button type="button" aria-label="Agrandir la photo" onClick={() => setLightbox(m)}
                            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'block' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={dmImageUrl(conversationId, m.id, token)} alt="Photo"
                              style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block' }} />
                          </button>
                        )}
                        {m.body}
                      </>
                    )}
                  </div>
                  )}
                  {m.reactions.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      {m.reactions.map((r) => (
                        <button key={r.emoji} type="button" aria-label={`Réaction ${r.emoji} (${r.userIds.length})`}
                          onClick={() => toggleReaction(m, r.emoji)}
                          style={{ border: `1px solid ${r.userIds.includes(viewerUserId) ? th.accent : th.line}`,
                            background: th.surface, borderRadius: 999, padding: '1px 7px', cursor: 'pointer',
                            fontFamily: th.fontUI, fontSize: 12 }}>
                          {r.emoji} {r.userIds.length}
                        </button>
                      ))}
                    </div>
                  )}
                  {!m.deleted && editingId !== m.id && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <button type="button" aria-label={`Réagir au message de ${m.author.firstName}`}
                        onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                          fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                        Réagir
                      </button>
                      {mine && (
                        <button type="button" onClick={() => startEdit(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                            fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                          Modifier
                        </button>
                      )}
                      {mine && (
                        <button type="button" onClick={() => setPendingDelete(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                            fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                          Supprimer
                        </button>
                      )}
                      {!mine && (
                        <button type="button" onClick={() => setReportTarget(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                            fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                          Signaler
                        </button>
                      )}
                    </div>
                  )}
                  {reactFor === m.id && (
                    <div role="menu" aria-label="Réactions rapides"
                      style={{ position: 'absolute', zIndex: 5, bottom: '100%', [mine ? 'right' : 'left']: 0, marginBottom: 4,
                        background: th.bg, boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`,
                        borderRadius: 999, padding: '4px 8px', display: 'flex', gap: 4 }}>
                      {QUICK_REACTIONS.map((e) => (
                        <button key={e} type="button" aria-label={`Réaction ${e}`} onClick={() => toggleReaction(m, e)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  {mine && m.id === lastMineId && (
                    <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 11, marginTop: 2,
                      color: isReadByOther(m.createdAt, meta?.otherLastReadAt ?? null) ? th.accent : th.textFaint }}>
                      {isReadByOther(m.createdAt, meta?.otherLastReadAt ?? null) ? '✓✓ Lu' : '✓ Envoyé'}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {typingUntil > 0 && (
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, fontStyle: 'italic' }}>
            {other.firstName} écrit…
          </div>
        )}
      </div>

      {meta?.blocked || writeBlocked ? (
        <div style={{ borderTop: `1px solid ${th.line}`, padding: '14px 16px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, textAlign: 'center' }}>
          {writeBlocked && !meta?.blocked ? 'Vous ne pouvez plus écrire à ce joueur.' : 'Vous ne pouvez pas échanger avec ce membre.'}
        </div>
      ) : (
        <>
          {sendError && (
            <div style={{ padding: '6px 16px 0', fontFamily: th.fontUI, fontSize: 12.5, color: '#e0554f' }}>{sendError}</div>
          )}
          <MessageComposer onSend={send} onSendImage={sendImage} onTyping={typing} initialDraft={initialDraft} />
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Ce message sera retiré de la conversation."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {reportTarget && (
        <ReportDialog
          onCancel={() => setReportTarget(null)}
          onSubmit={async (reason, detail) => {
            await api.reportDmMessage(conversationId, reportTarget.id, reason, detail || null, token);
          }}
        />
      )}
      {lightbox && (
        <div role="dialog" aria-label="Photo" onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dmImageUrl(conversationId, lightbox.id, token)} alt="Photo"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
