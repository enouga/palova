'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClubDetail, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { platformUrl } from '@/lib/clubUrl';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Icon, IconName } from '@/components/ui/Icon';

type Tab = { label: string; short?: string; href: string; icon: IconName; match: (p: string) => boolean; show: boolean; brand?: boolean };

// Barre de navigation club, présente sur toutes les pages d'un sous-domaine club.
// Figée en haut (position: sticky) : une carte flottante « verre dépoli » qui reste collée au
// sommet quand on scrolle, le contenu défile dessous. Rangée 1 : logo du club (repli marque
// Palova ‹) → accueil · identité club (titre) · thème/profil. Rangée 2 : onglets Club-house
// (accueil du club, police brand) / Réserver / Events / Parties / Mes réservations (ou Connexion).
// Sur téléphone (≤600px) : onglets en colonne (icône au-dessus, petit libellé en dessous, toujours
// visible), inactifs transparents, actif en pastille accent.
export function ClubNav({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const pathname = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const showClubLogo = !!club.logoUrl && !logoFailed;

  const tabs: Tab[] = [
    { label: 'Club-house', short: 'Club', href: '/', icon: 'home', brand: true, match: (p) => p === '/' || p.startsWith('/club-house') || p.startsWith('/infos'), show: true },
    { label: 'Réserver', href: '/reserver', icon: 'calendar', match: (p) => p.startsWith('/reserver') || p.startsWith('/courts'), show: true },
    { label: 'Mes réservations', short: 'Résas', href: '/me/reservations', icon: 'ticket', match: (p) => p.startsWith('/me/'), show: ready && !!token },
    { label: 'Parties', href: '/parties', icon: 'users', match: (p) => p.startsWith('/parties'), show: ready && !!token },
    { label: 'Events', href: '/events', icon: 'trophy', match: (p) => p.startsWith('/events') || p.startsWith('/tournois'), show: true },
    { label: 'Connexion', href: '/login', icon: 'user', match: (p) => p.startsWith('/login'), show: ready && !token },
  ];

  // Fond translucide de la carte (verre dépoli) selon le thème ; repli plus opaque quand
  // backdrop-filter n'est pas supporté (cf. règle @supports du bloc <style>).
  const glass = th.mode === 'floodlit' ? 'rgba(20,19,18,0.66)' : 'rgba(255,255,255,0.72)';
  const glassSolid = th.mode === 'floodlit' ? 'rgba(20,19,18,0.94)' : 'rgba(255,255,255,0.96)';

  return (
    <div className="cn-root" style={{ position: 'sticky', top: 0, zIndex: 50, padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 12px 0' }}>
      {/* Responsive : desktop = onglets en ligne (icône + libellé) ; téléphone (≤600px) = onglets
          en colonne, libellé court prioritaire toujours affiché, inactifs transparents. */}
      <style>{`
        @supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
          .cn-card { background: ${glassSolid} !important; }
        }
        .cn-lbl-short { display: none; }
        @media (max-width:600px){
          .cn-card { padding: 10px 10px 11px !important; border-radius: 20px !important; }
          .cn-tabs { gap: 4px !important; margin-top: 10px !important; }
          .cn-tab { flex-direction: column !important; gap: 3px !important; padding: 7px 3px !important; border-radius: 13px !important; }
          .cn-tab svg { width: 22px; height: 22px; }
          .cn-tab .cn-tab-label { font-size: 10.5px !important; letter-spacing: 0 !important; line-height: 1.1; }
          .cn-tab:not(.is-active) { background: transparent !important; border-color: transparent !important; }
          .cn-tab:has(.cn-lbl-short) .cn-lbl-full { display: none; }
          .cn-tab .cn-lbl-short { display: inline; }
        }
      `}</style>

      {/* Polish : léger dégradé qui masque le contenu défilant dans la fine bande au-dessus de
          la carte (sous l'encoche). Invisible au repos (couleur = fond de page). */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 'calc(env(safe-area-inset-top, 0px) + 16px)', pointerEvents: 'none', background: `linear-gradient(to bottom, ${th.bg} 35%, transparent)` }} />

      <div className="cn-card" style={{
        position: 'relative',
        zIndex: 1,
        background: glass,
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        border: `1px solid ${th.line}`,
        borderRadius: 18,
        boxShadow: th.shadow,
        padding: '12px 16px',
        overflow: 'visible',
      }}>
        {/* Rangée 1 : logo du club (repli marque Palova) → accueil · nom du club · actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {showClubLogo ? (
            <Link href="/" style={{ display: 'inline-flex', flexShrink: 0 }}>
              <img src={assetUrl(club.logoUrl) ?? undefined} alt={`Logo ${club.name}`}
                onError={() => setLogoFailed(true)}
                style={{ height: 24, width: 'auto', objectFit: 'contain', display: 'block' }} />
            </Link>
          ) : (
            <Logotype href={platformUrl('/')} size={22} />
          )}
          <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{club.name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <ThemeToggle /><ProfileMenu />
          </div>
        </div>

        {/* Rangée 2 : onglets (sur téléphone : icône + petit libellé en colonne ; passe à la ligne si besoin) */}
        <div className="cn-tabs" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 6, marginTop: 14 }}>
          {tabs.filter((t) => t.show).map((t) => {
            const active = t.match(pathname);
            const hov = !active && hovered === t.label;
            const iconColor = active ? th.onAccent : hov ? th.text : th.textMute;
            return (
              <Link key={t.label} href={t.href} aria-current={active ? 'page' : undefined}
                aria-label={t.label} title={t.label}
                className={`cn-tab${active ? ' is-active' : ''}`}
                onMouseEnter={() => setHovered(t.label)}
                onMouseLeave={() => setHovered((h) => (h === t.label ? null : h))}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, whiteSpace: 'nowrap', textDecoration: 'none',
                         boxSizing: 'border-box', padding: '8px 13px', borderRadius: 11,
                         border: `1px solid ${active ? 'transparent' : th.lineStrong}`,
                         fontFamily: th.fontUI, fontSize: 14, fontWeight: 600,
                         background: active ? th.accent : hov ? th.surfaceHi : th.surface2,
                         color: active ? th.onAccent : hov ? th.text : th.textMute,
                         transition: 'background .15s, border-color .15s, transform .12s, color .15s',
                         transform: hov ? 'translateY(-1px)' : 'none' }}>
                <Icon name={t.icon} size={16} color={iconColor} />
                {/* Righteous n'existe qu'en 400 → graisse normale, taille/espacement ajustés pour s'aligner sur les labels 14/600. */}
                <span className="cn-tab-label cn-lbl-full" style={t.brand ? { fontFamily: th.fontBrand, fontWeight: 400, fontSize: 15, letterSpacing: 0.2 } : undefined}>{t.label}</span>
                {t.short && (
                  <span className="cn-tab-label cn-lbl-short" style={t.brand ? { fontFamily: th.fontBrand, fontWeight: 400, fontSize: 15, letterSpacing: 0.2 } : undefined}>{t.short}</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
