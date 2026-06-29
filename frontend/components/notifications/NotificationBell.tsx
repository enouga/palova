'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, notificationsStreamUrl, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Icon } from '@/components/ui/Icon';
import { NotificationRow } from '@/components/notifications/NotificationRow';

// Cloche du header : badge de non-lus, panneau déroulant, live via SSE.
export function NotificationBell() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<Date | null>(null); // horloge unique posée à l'ouverture (hydration-safe)

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
      setNow(new Date());
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

  // Contenu du panneau, partagé par les deux variantes (dropdown desktop / feuille mobile).
  const panelInner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px 12px', borderBottom: `1px solid ${th.line}` }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 16, color: th.text }}>Notifications</span>
          {unread > 0 && (
            <span style={{
              minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999,
              background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{unread > 99 ? '99+' : unread}</span>
          )}
        </span>
        {unread > 0 && (
          <button onClick={markAll} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
            Tout marquer comme lu
          </button>
        )}
      </div>

      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {loaded && items.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: '50%', background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bell" size={24} color={th.textFaint} />
            </span>
            <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>Aucune notification</span>
            <span style={{ color: th.textFaint, fontFamily: th.fontUI, fontSize: 12.5 }}>Vous êtes à jour.</span>
          </div>
        )}
        {items.map((n) => (
          <NotificationRow key={n.id} n={n} now={now} onClick={() => openItem(n)} />
        ))}
      </div>

      {items.length > 0 && (
        <button onClick={() => { setOpen(false); router.push('/me/notifications'); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', border: 'none', borderTop: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', padding: '13px 16px', color: th.accent, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>
          Voir toutes les notifications
          <Icon name="arrowR" size={15} color={th.accent} />
        </button>
      )}
    </>
  );

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

      {open && (isDesktop ? (
        // Desktop : dropdown ancré sous la cloche (inchangé).
        <div role="region" aria-label="Notifications" style={{
          position: 'absolute', right: 0, top: 46, width: 340, maxWidth: '90vw', zIndex: 60,
          background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
          boxShadow: th.shadowSoft, overflow: 'hidden',
        }}>
          {panelInner}
        </div>
      ) : (
        // Mobile : feuille centrée plein largeur (langage visuel des modales, cf. ConfirmDialog).
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', zIndex: 80, animation: 'sp-fade .25s ease' }} />
          <div role="region" aria-label="Notifications" style={{
            position: 'fixed', top: 0, left: 0, right: 0, width: '100%', maxWidth: 480, margin: '0 auto', zIndex: 81,
            background: th.surface, border: `1px solid ${th.line}`, borderTop: 'none', borderRadius: '0 0 24px 24px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)', overflow: 'hidden', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)',
          }}>
            {panelInner}
          </div>
        </>
      ))}
    </div>
  );
}
