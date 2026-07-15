'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { BackButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Icon } from '@/components/ui/Icon';
import { NotificationRow } from '@/components/notifications/NotificationRow';

// Liste des notifications (ouverte depuis la cloche). Shell standard des pages /me :
// Screen + ClubNav sur hôte club / en-tête plateforme sinon (pattern /me/profile).
export default function NotificationsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const { slug, club } = useClub();
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
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Notifications
        </div>

        <div style={{ padding: '18px 20px 0' }}>
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
      </div>
    </Screen>
  );
}
