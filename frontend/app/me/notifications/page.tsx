'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { NotificationRow } from '@/components/notifications/NotificationRow';

export default function NotificationsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState<Date | null>(null); // horloge unique posée au mount (hydration-safe)

  useEffect(() => { setNow(new Date()); }, []);

  const load = (c?: string) => {
    if (!token) return;
    setLoading(true);
    api.getNotifications(token, c).then((p) => {
      setItems((prev) => (c ? [...prev, ...p.items] : p.items));
      setCursor(p.nextCursor);
      if (!p.nextCursor) setDone(true);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  if (ready && !token) { if (typeof window !== 'undefined') router.push('/login'); return null; }

  const openItem = (n: AppNotification) => {
    if (!n.readAt && token) api.markNotificationRead(n.id, token).catch(() => {});
    if (n.url) router.push(n.url);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 22, color: th.text, marginBottom: 16 }}>Notifications</h1>
      {items.length === 0 && !loading && (
        <div style={{ padding: '56px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <span aria-hidden="true" style={{ width: 60, height: 60, borderRadius: '50%', background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={28} color={th.textFaint} />
          </span>
          <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 15, fontWeight: 600 }}>Aucune notification</span>
          <span style={{ color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5 }}>Vous êtes à jour.</span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((n) => (
          <NotificationRow key={n.id} n={n} now={now} variant="page" onClick={() => openItem(n)} />
        ))}
      </div>
      {!done && items.length > 0 && (
        <button onClick={() => cursor && load(cursor)} disabled={loading} style={{
          marginTop: 16, width: '100%', padding: '10px 0', borderRadius: 10, border: `1px solid ${th.line}`,
          background: th.surface, color: th.text, cursor: 'pointer', fontFamily: th.fontUI, fontWeight: 600,
        }}>{loading ? 'Chargement…' : 'Charger plus'}</button>
      )}
    </div>
  );
}
