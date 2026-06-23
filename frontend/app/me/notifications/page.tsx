'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';

export default function NotificationsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

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
        <p style={{ color: th.textFaint, fontFamily: th.fontUI }}>Aucune notification.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((n) => (
          <button key={n.id} onClick={() => openItem(n)} style={{
            textAlign: 'left', border: `1px solid ${th.line}`, borderRadius: 12, cursor: 'pointer',
            background: n.readAt ? th.surface : th.surface2, padding: '12px 14px', fontFamily: th.fontUI,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: th.text }}>{n.title}</div>
            <div style={{ fontSize: 13, color: th.textMute, marginTop: 2 }}>{n.body}</div>
          </button>
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
