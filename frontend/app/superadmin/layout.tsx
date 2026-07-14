'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Icon, type IconName } from '@/components/ui/Icon';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug } = useClub();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [openReportCount, setOpenReportCount] = useState(0);

  useEffect(() => {
    if (!ready) return;
    if (slug) { router.replace('/'); return; }        // pas de super-admin sur un host club
    if (!token) { router.replace('/login'); return; }
    api.platformStats(token)                            // 403 ⇒ pas super-admin, le serveur tranche
      .then(() => setAllowed(true))
      .catch(() => setAllowed(false));
  }, [ready, token, slug, router]);

  useEffect(() => { if (allowed === false) router.replace('/'); }, [allowed, router]);

  useEffect(() => {
    if (allowed !== true || !token) return;
    api.platformListReports(token, 'OPEN').then((r) => setOpenReportCount(r.items.length)).catch(() => {});
  }, [allowed, token]);

  if (!ready || slug || !token || allowed !== true) {
    return (
      <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>
        Chargement…
      </div>
    );
  }

  type LinkItem = { href: string; label: string; icon: IconName; badge?: number };
  const links: LinkItem[] = [
    { href: '/superadmin',           label: 'Tableau de bord', icon: 'grid' },
    { href: '/superadmin/clubs',     label: 'Clubs',           icon: 'indoor' },
    { href: '/superadmin/billing',   label: 'Facturation',     icon: 'euro' },
    { href: '/superadmin/stats',     label: 'Statistiques',    icon: 'chart' },
    { href: '/superadmin/moderation', label: 'Modération',     icon: 'flag', badge: openReportCount },
    { href: '/superadmin/sports',    label: 'Sports',          icon: 'trophy' },
    { href: '/superadmin/clubs/new', label: 'Créer un club',   icon: 'bolt' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: th.bg, color: th.text, fontFamily: th.fontUI, display: 'flex' }}>
      <aside style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh',
        width: 244, flexShrink: 0, boxSizing: 'border-box',
        background: th.bgElev, borderRight: `1px solid ${th.line}`,
        display: 'flex', flexDirection: 'column', padding: '20px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 6px' }}>
          <Logotype size={22} />
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textFaint, padding: '6px 10px 14px' }}>
          Plateforme
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {links.map((l) => {
            // La fiche /superadmin/clubs/[id] allume « Clubs » ; /clubs/new son propre item.
            const active = pathname === l.href
              || (l.href !== '/superadmin' && l.href !== '/superadmin/clubs/new' && pathname.startsWith(l.href + '/'));
            return (
              <Link key={l.href} href={l.href} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                textDecoration: 'none', fontSize: 14, fontWeight: 600,
                color: active ? th.onAccent : th.textMute, background: active ? th.accent : 'transparent',
              }}>
                <Icon name={l.icon} size={17} />
                <span style={{ flex: 1 }}>{l.label}</span>
                {!!l.badge && (
                  <span style={{
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                    background: active ? th.onAccent : ACCENTS.coral, color: active ? th.accent : '#fff',
                    fontFamily: th.fontUI, fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>{l.badge > 99 ? '99+' : l.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
          <ThemeToggle />
          <ProfileMenu direction="up" align="left" />
        </div>
      </aside>
      <main style={{ flex: 1, padding: '28px 32px', maxWidth: 1100 }}>{children}</main>
    </div>
  );
}
