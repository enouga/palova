'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, notificationsStreamUrl, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Cloche du header : badge de non-lus, panneau déroulant, live via SSE.
export function NotificationBell() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Compteur initial + abonnement live (incrémente à chaque évènement).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.getUnreadCount(token).then((r) => { if (alive) setUnread(r.count); }).catch(() => {});
    const es = new EventSource(notificationsStreamUrl(token));
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.type === 'notification') setUnread((n) => n + 1);
      } catch { /* ping / connected */ }
    };
    es.onerror = () => es.close();
    return () => { alive = false; es.close(); };
  }, [token]);

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!ready || !token) return null;

  const toggle = () => {
    if (!open && token) {
      api.getNotifications(token).then((p) => { setItems(p.items); setLoaded(true); }).catch(() => {});
    }
    setOpen(!open);
  };

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt && token) {
      api.markNotificationRead(n.id, token).catch(() => {});
      setUnread((u) => Math.max(0, u - 1));
    }
    if (n.url) router.push(n.url);
  };

  const markAll = () => {
    if (!token) return;
    api.markAllNotificationsRead(token).catch(() => {});
    setUnread(0);
    setItems((list) => list.map((n) => ({ ...n, readAt: new Date().toISOString() })));
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={toggle} aria-label="Notifications" aria-haspopup="true" aria-expanded={open}
        style={{
          width: 38, height: 38, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
          position: 'relative', background: open ? th.surfaceHi : th.surface2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <Icon name="bell" size={19} color={th.text} />
        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: '#e5484d', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div role="region" aria-label="Notifications" style={{
          position: 'absolute', right: 0, top: 46, width: 340, maxWidth: '90vw', zIndex: 60,
          background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
          boxShadow: th.shadowSoft, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12.5 }}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {loaded && items.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5 }}>Aucune notification</div>
            )}
            {items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  background: n.readAt ? 'transparent' : th.surface2, padding: '12px 16px',
                  borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI,
                }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: th.text }}>{n.title}</div>
                <div style={{ fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{n.body}</div>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); router.push('/me/notifications'); }}
            style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '12px 16px', color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>
            Voir toutes les notifications
          </button>
        </div>
      )}
    </div>
  );
}
