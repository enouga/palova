'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubDetail, Announcement, Sponsor, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle, MyBookingsButton, LogoutButton, Btn, Chip } from '@/components/ui/atoms';
import { Icon, IconName } from '@/components/ui/Icon';

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function ClubHome({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [spons, setSpons] = useState<Sponsor[]>([]);
  const [next, setNext] = useState<MyReservation[]>([]);
  const [isSub, setIsSub] = useState(false);

  useEffect(() => { api.getClubAnnouncements(club.slug).then(setAnn).catch(() => setAnn([])); }, [club.slug]);
  useEffect(() => { api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([])); }, [club.slug]);
  useEffect(() => {
    if (!ready || !token) return;
    api.getMyReservations(token)
      .then((rs) => setNext(rs.filter((r) => r.resource.club.slug === club.slug && r.status !== 'CANCELLED' && new Date(r.startTime) > new Date()).slice(0, 3)))
      .catch(() => {});
    api.getMySubscriptions(token).then((ids) => setIsSub(ids.includes(club.id))).catch(() => {});
  }, [ready, token, club.slug, club.id]);

  const sectionTitle = (t: string) => (
    <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>{t}</div>
  );

  const links: { label: string; icon: IconName; href: string; show: boolean }[] = [
    { label: 'Réserver', icon: 'arrowR', href: '/reserver', show: true },
    { label: 'Terrains', icon: 'indoor', href: '/reserver?tab=courts', show: true },
    { label: 'Mes réservations', icon: 'ticket', href: '/me/reservations', show: !!token },
    { label: 'Connexion', icon: 'user', href: '/login', show: ready && !token },
    { label: 'Créer un compte', icon: 'user', href: '/register', show: ready && !token },
  ];

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        {/* En-tête */}
        <div style={{ padding: '24px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logotype size={22} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isSub && <Chip tone="accent" icon="check">Abonné</Chip>}
            <MyBookingsButton /><ThemeToggle /><LogoutButton />
          </div>
        </div>

        {/* Identité club */}
        <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
          {club.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={club.logoUrl} alt={club.name} style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 14, background: th.accent, color: th.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26 }}>{club.name.slice(0, 1)}</div>
          )}
          <div>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, lineHeight: 1.02, color: th.text, letterSpacing: -0.5 }}>{club.name}</div>
            {club.city && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4 }}><Icon name="pin" size={13} color={th.textMute} />{club.city}</div>}
          </div>
        </div>

        {/* CTA principal */}
        <div style={{ padding: '20px 20px 0' }}>
          <Btn full icon="arrowR" onClick={() => router.push('/reserver')}>Réserver un créneau</Btn>
        </div>

        {/* Notifications (joueur connecté) */}
        {next.length > 0 && (
          <div style={{ padding: '26px 20px 0' }}>
            {sectionTitle('Vos prochaines réservations')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {next.map((r) => (
                <div key={r.id} style={{ background: th.surface, borderRadius: 14, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="ticket" size={18} color={th.accent} />
                  <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{r.resource.name} · {formatDateTime(r.startTime, r.resource.club.timezone)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Annonces */}
        {ann.length > 0 && (
          <div style={{ padding: '26px 20px 0' }}>
            {sectionTitle('Annonces')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ann.map((a) => (
                <div key={a.id} style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.pinned && <Chip tone="accent">Épinglé</Chip>}
                    <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{a.title}</span>
                  </div>
                  <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.body}</p>
                  {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noreferrer" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.accent }}>En savoir plus →</a>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hub de liens */}
        <div style={{ padding: '26px 20px 0' }}>
          {sectionTitle('Accès rapide')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {links.filter((l) => l.show).map((l) => (
              <button key={l.label} onClick={() => router.push(l.href)} style={{ border: 'none', cursor: 'pointer', textAlign: 'left', background: th.surface2, borderRadius: 16, padding: '16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name={l.icon} size={18} color={th.text} />
                <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5, color: th.text }}>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sponsors */}
        {spons.length > 0 && (
          <div style={{ padding: '26px 20px 0' }}>
            {sectionTitle('Partenaires')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {spons.map((s) => (
                <a key={s.id} href={s.linkUrl ?? '#'} target={s.linkUrl ? '_blank' : undefined} rel="noreferrer" title={s.name} style={{ display: 'block' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.logoUrl} alt={s.name} style={{ height: 44, width: 'auto', borderRadius: 8, background: th.surface, padding: 6, objectFit: 'contain' }} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
