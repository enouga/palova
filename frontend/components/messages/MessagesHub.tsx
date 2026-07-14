'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, notificationsStreamUrl, ConversationSummary, DmMeta, DmUserInfo } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { colorForSeed } from '@/lib/playerColors';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import { NewConversationPanel } from './NewConversationPanel';

// QG de la messagerie (/me/messages) : split view desktop (liste ~320px + fil),
// liste → fil plein écran en mobile. Deeplink initialWith = get-or-create + ouverture.
export function MessagesHub({ token, viewerUserId, clubSlug, initialWith, initialDraft }: {
  token: string;
  viewerUserId: string;
  clubSlug: string | null;
  initialWith?: string | null;
  initialDraft?: string | null;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop(900);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [meta, setMeta] = useState<DmMeta | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<DmUserInfo | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blocked, setBlocked] = useState<DmUserInfo[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => { setNow(new Date()); }, []);

  const reload = useCallback(() => {
    api.listConversations(token).then((rows) => {
      setConversations(rows);
      // re-dérive la sélection par id stable après reload
      setSelected((prev) => prev ? rows.find((c) => c.id === prev.id) ?? prev : prev);
    }).catch(() => {});
  }, [token]);
  useEffect(() => { reload(); }, [reload]);

  // Live : nouveau message ailleurs → cloche SSE ; lecture locale → event window.
  useEffect(() => {
    const es = new EventSource(notificationsStreamUrl(token));
    es.onmessage = (e: MessageEvent) => {
      try { if ((JSON.parse(e.data) as { type: string }).type === 'notification') reload(); } catch { /* ignore */ }
    };
    es.onerror = () => {};
    const onLocal = () => reload();
    window.addEventListener('palova:dm-unread', onLocal);
    return () => { es.close(); window.removeEventListener('palova:dm-unread', onLocal); };
  }, [token, reload]);

  // Deeplink ?with= : get-or-create puis ouverture.
  useEffect(() => {
    if (!initialWith) return;
    api.openConversation(initialWith, token, clubSlug)
      .then((c) => { setSelected(c); reload(); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWith, token, clubSlug]);

  const doBlock = async (u: DmUserInfo) => {
    try { await api.blockUser(u.userId, token); setMeta((m) => m ? { ...m, blocked: true } : m); }
    catch { /* noop */ }
    finally { setBlockTarget(null); setMenuOpen(false); }
  };
  const openBlocked = async () => {
    setBlockedOpen(true);
    try { setBlocked(await api.listBlockedUsers(token)); } catch { setBlocked([]); }
  };
  const unblock = async (u: DmUserInfo) => {
    try { await api.unblockUser(u.userId, token); setBlocked((prev) => prev.filter((x) => x.userId !== u.userId)); }
    catch { /* noop */ }
  };

  const threadHeader = selected && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${th.line}` }}>
      {!isDesktop && (
        <button type="button" aria-label="Retour" onClick={() => setSelected(null)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.text, fontSize: 18, padding: 4 }}>←</button>
      )}
      <Avatar firstName={selected.other.firstName} lastName={selected.other.lastName}
        avatarUrl={selected.other.avatarUrl} size={30} color={colorForSeed(selected.other.userId)} />
      <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text, flex: 1 }}>
        {selected.other.firstName} {selected.other.lastName}
      </span>
      <div style={{ position: 'relative' }}>
        <button type="button" aria-label="Options de la conversation" aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, padding: 4 }}>⋮</button>
        {menuOpen && (
          <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: th.bg,
            boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`, borderRadius: 12, padding: 6, minWidth: 200 }}>
            <button role="menuitem" type="button"
              onClick={() => (meta?.blocked ? (api.unblockUser(selected.other.userId, token).then(() => setMeta((m) => m ? { ...m, blocked: false } : m)), setMenuOpen(false)) : setBlockTarget(selected.other))}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                cursor: 'pointer', padding: '9px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              {meta?.blocked ? 'Débloquer ce membre' : 'Bloquer ce membre'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const thread = selected && (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {threadHeader}
      <MessageThread conversationId={selected.id} token={token} viewerUserId={viewerUserId}
        other={selected.other} onMeta={setMeta} onUnreadCleared={reload}
        initialDraft={selected.other.userId === initialWith ? initialDraft ?? undefined : undefined} />
    </div>
  );

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${th.line}` }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Conversations</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {clubSlug && (
            <button type="button" aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={() => setNewOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
              <Icon name="plus" size={13} color={th.accent} />Nouveau
            </button>
          )}
          <button type="button" aria-label="Membres bloqués" title="Membres bloqués" onClick={openBlocked}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12.5 }}>
            Bloqués
          </button>
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <ConversationList conversations={conversations} selectedId={selected?.id ?? null} now={now} onSelect={setSelected} />
      </div>
    </div>
  );

  return (
    <div style={{ border: `1px solid ${th.line}`, borderRadius: 16, background: th.bg, overflow: 'hidden',
      display: 'flex', height: 'min(680px, calc(100vh - 220px))', minHeight: 380 }}>
      {isDesktop ? (
        <>
          <div style={{ width: 320, borderRight: `1px solid ${th.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {thread ?? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>
                Sélectionnez une conversation
              </div>
            )}
          </div>
        </>
      ) : (
        // minWidth:0 — sans lui, le min-content du composer (textarea+boutons) remonte via
        // min-width:auto et pousse tout le fil hors de la carte sur mobile (bulles rognées).
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{selected ? thread : list}</div>
      )}

      {newOpen && clubSlug && (
        <NewConversationPanel slug={clubSlug} token={token} viewerUserId={viewerUserId}
          onClose={() => setNewOpen(false)}
          onOpened={(c) => { setSelected(c); reload(); setNewOpen(false); }} />
      )}
      {blockTarget && (
        <ConfirmDialog
          title="Bloquer ce membre"
          message={`${blockTarget.firstName} ${blockTarget.lastName} ne pourra plus vous écrire (et vous non plus). Vous pourrez le débloquer à tout moment.`}
          confirmLabel="Bloquer" cancelLabel="Annuler"
          onConfirm={() => doBlock(blockTarget)}
          onCancel={() => setBlockTarget(null)}
        />
      )}
      {blockedOpen && (
        <div role="dialog" aria-label="Membres bloqués" onClick={() => setBlockedOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 360, maxWidth: '100%', background: th.bg, border: `1px solid ${th.line}`, borderRadius: 16, padding: 16 }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text, marginBottom: 10 }}>Membres bloqués</div>
            {blocked.length === 0
              ? <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Personne n&apos;est bloqué.</div>
              : blocked.map((u) => (
                <div key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${th.line}` }}>
                  <Avatar firstName={u.firstName} lastName={u.lastName} avatarUrl={u.avatarUrl} size={30} color={colorForSeed(u.userId)} />
                  <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{u.firstName} {u.lastName}</span>
                  <button type="button" onClick={() => unblock(u)}
                    style={{ border: `1px solid ${th.accent}`, background: 'transparent', color: th.accent, borderRadius: 999,
                      padding: '4px 10px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    Débloquer
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
