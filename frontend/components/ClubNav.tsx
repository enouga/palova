'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClubDetail, assetUrl, api } from '@/lib/api';
import { subscribeNotifications } from '@/lib/notificationsStream';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { platformUrl } from '@/lib/clubUrl';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Icon, IconName } from '@/components/ui/Icon';
import { clubHasPadel } from '@/lib/sport';
import { buildAgendaList } from '@/lib/calendar';
import { wideLogo } from '@/lib/clubLogos';

type Tab = { label: string; short?: string; href: string; icon: IconName; match: (p: string) => boolean; show: boolean; brand?: boolean };

// Pastille de compteur posée sur un onglet. Défaut = rouge notification (non lus Parties) ;
// `bg`/`fg` permettent le style accent (compteur « à venir », même langage que l'onglet
// À venir de /me/reservations).
function CountBadge({ count, label, fontFamily, bg = '#e5484d', fg = '#fff' }: { count: number; label: string; fontFamily: string; bg?: string; fg?: string }) {
  return (
    <span className="cn-badge" aria-label={label} style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: bg, color: fg, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily, flexShrink: 0 }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

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
  // Logotype horizontal du bandeau, choisi selon le thème courant (repli en cascade sur l'icône).
  const bannerLogo = wideLogo(club, th.mode);
  const showClubLogo = !!bannerLogo && !logoFailed;

  // Deux compteurs sur l'onglet Parties : messages non lus (pastille rouge, priorité) et
  // nombre de parties ouvertes à venir (pastille accent, même langage que « À venir » de Résas).
  const [partiesUnread, setPartiesUnread] = useState(0);
  const [openPartiesCount, setOpenPartiesCount] = useState(0);
  const showPartiesTab = ready && !!token && clubHasPadel(club);
  useEffect(() => {
    if (!showPartiesTab || !token) { setPartiesUnread(0); setOpenPartiesCount(0); return; }
    let alive = true;
    const refresh = () => {
      api.getOpenMatchUnread(club.slug, token)
        .then((r) => { if (alive) setPartiesUnread(r.count); }).catch(() => {});
      // listOpenMatches ne renvoie que les parties à venir (startTime > now) → même total que /parties.
      api.getOpenMatches(club.slug, token)
        .then((list) => { if (alive) setOpenPartiesCount(list.length); }).catch(() => {});
    };
    refresh();
    const unsub = subscribeNotifications(token, refresh);
    const onLocal = () => refresh();
    window.addEventListener('palova:openmatch-unread', onLocal);
    return () => { alive = false; unsub(); window.removeEventListener('palova:openmatch-unread', onLocal); };
  }, [showPartiesTab, token, club.slug, pathname]);

  // Compteur de messages privés non lus (badge 💬 du header) — route /api/me/* (pas de slug).
  // Rafraîchi par la cloche SSE (nouvelle notification), l'event window `palova:dm-unread`
  // (lecture locale d'une conversation) et chaque navigation.
  const [dmUnread, setDmUnread] = useState(0);
  const showMessages = ready && !!token;
  useEffect(() => {
    if (!showMessages || !token) { setDmUnread(0); return; }
    let alive = true;
    const refresh = () => api.getDmUnread(token)
      .then((r) => { if (alive) setDmUnread(r.count); }).catch(() => {});
    refresh();
    const unsub = subscribeNotifications(token, refresh);
    const onLocal = () => refresh();
    window.addEventListener('palova:dm-unread', onLocal);
    return () => { alive = false; unsub(); window.removeEventListener('palova:dm-unread', onLocal); };
  }, [showMessages, token, pathname]);

  // Raccourci « Espace club » dans l'en-tête : visible pour l'OWNER/ADMIN/STAFF du club courant
  // (rôle indifférent, cf. api.getMyClubs qui renvoie toute adhésion ClubMember). Le même lien
  // dans le menu ProfileMenu est réservé aux AUTRES clubs gérés (pas de doublon).
  const [manages, setManages] = useState(false);
  useEffect(() => {
    if (!ready || !token) { setManages(false); return; }
    let alive = true;
    api.getMyClubs(token).then((list) => { if (alive) setManages(list.some((m) => m.clubId === club.id)); }).catch(() => {});
    return () => { alive = false; };
  }, [ready, token, club.id]);

  // Compteur « Mes réservations » À VENIR — identique au compteur de l'onglet « À venir »
  // de /me/reservations : réservations terrain + inscriptions tournois + events + cours, fusionnés
  // par buildAgendaList (annulés exclus), même cloisonnement par club (sauf si le club ouvre la
  // vue des autres). Calculé en effet (jamais au rendu → pas de mismatch d'hydration), rafraîchi
  // à chaque navigation. Les appels tournois/events/cours sont best-effort (badge dégradé si échec).
  const [upcomingCount, setUpcomingCount] = useState(0);
  const showResasTab = ready && !!token;
  const showAllResas = !!club.showOtherClubsReservations;
  useEffect(() => {
    if (!showResasTab || !token) { setUpcomingCount(0); return; }
    let alive = true;
    Promise.all([
      api.getMyReservations(token),
      api.getMyTournaments(token).catch(() => []),
      api.getMyEvents(token).catch(() => []),
      api.getMyLessons(token).catch(() => []),
    ]).then(([reservations, tournaments, events, lessons]) => {
      if (!alive) return;
      const fItems   = showAllResas ? reservations : reservations.filter((r) => r.resource.club.slug === club.slug);
      const fRegs    = showAllResas ? tournaments  : tournaments.filter((r) => r.tournament.club.slug === club.slug);
      const fEvts    = showAllResas ? events       : events.filter((e) => e.event.club.slug === club.slug);
      const fLessons = showAllResas ? lessons      : lessons.filter((l) => l.lesson.club.slug === club.slug);
      const upcoming = buildAgendaList(fItems, fRegs, fEvts, fLessons, new Date()).filter((i) => !i.past);
      setUpcomingCount(upcoming.length);
    }).catch(() => {});
    return () => { alive = false; };
  }, [showResasTab, token, club.slug, showAllResas, pathname]);

  const tabs: Tab[] = [
    { label: 'Club-house', short: 'Club', href: '/', icon: 'home', brand: true, match: (p) => p === '/' || p.startsWith('/club-house') || p.startsWith('/infos'), show: true },
    { label: 'Réserver', href: '/reserver', icon: 'calendar', match: (p) => p.startsWith('/reserver') || p.startsWith('/courts'), show: true },
    { label: 'Mes réservations', short: 'Résas', href: '/me/reservations', icon: 'ticket', match: (p) => p.startsWith('/me/'), show: ready && !!token },
    { label: 'Parties', href: '/parties', icon: 'users', match: (p) => p.startsWith('/parties'), show: ready && clubHasPadel(club) },
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
        /* Nom du club en pied de barre : réservé au mobile (sur desktop il vit dans la rangée 1). */
        .cn-title-bottom { display: none; }
        @media (max-width:600px){
          .cn-card { padding: 10px 10px 11px !important; border-radius: 20px !important; }
          /* Sur mobile, le nom du club sort de la rangée 1 (où la grappe d'icônes — jusqu'à 5 chez
             un gérant — le compressait jusqu'à « Padel … ») : rangée 1 = logo + icônes, et le nom
             s'affiche en pleine largeur tout en bas de la barre, sous les onglets. */
          .cn-title { display: none; }
          .cn-actions { margin-left: auto; }
          .cn-title-bottom { display: block; }
          .cn-tabs { gap: 4px !important; margin-top: 10px !important; }
          .cn-tab { flex-direction: column !important; gap: 3px !important; padding: 7px 3px !important; border-radius: 13px !important; }
          .cn-tab svg { width: 22px; height: 22px; }
          .cn-tab .cn-tab-label { font-size: 10.5px !important; letter-spacing: 0 !important; line-height: 1.1; }
          .cn-tab:not(.is-active) { background: transparent !important; border-color: transparent !important; }
          .cn-tab:has(.cn-lbl-short) .cn-lbl-full { display: none; }
          .cn-tab .cn-lbl-short { display: inline; }
          /* Compteur (Résas / Parties) en pastille flottante posée sur l'onglet (coin haut-droit,
             comme les compteurs « À venir / Passées ») : hors flux → l'onglet garde la même taille
             qu'il y ait un compteur ou non. */
          .cn-badge { position: absolute; top: 4px; right: 8px; }
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
        <div className="cn-row1" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {showClubLogo ? (
            <Link href="/" style={{ display: 'inline-flex', flexShrink: 0 }}>
              <img src={assetUrl(bannerLogo) ?? undefined} alt={`Logo ${club.name}`}
                onError={() => setLogoFailed(true)}
                style={{ height: 24, width: 'auto', objectFit: 'contain', display: 'block' }} />
            </Link>
          ) : (
            <Logotype href={platformUrl('/')} size={22} />
          )}
          <span className="cn-title" style={{ flex: 1, minWidth: 0, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{club.name}</span>
          <div className="cn-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <ThemeToggle />
            {showMessages && (
              // Icône Messages : même langage que la cloche (rond surface2, badge rouge non-lus).
              <Link href="/me/messages" aria-label="Messages" title="Messages"
                style={{ width: 38, height: 38, borderRadius: '50%', position: 'relative', background: th.surface2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', flexShrink: 0 }}>
                <Icon name="chat" size={19} color={th.text} />
                {dmUnread > 0 && (
                  <span aria-label={`${dmUnread} messages non lus`} style={{
                    position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
                    borderRadius: 8, background: '#e5484d', color: '#fff', fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI,
                  }}>{dmUnread > 99 ? '99+' : dmUnread}</span>
                )}
              </Link>
            )}
            {manages && (
              // Raccourci direct vers le back-office, même langage que l'icône Messages.
              <Link href="/admin" aria-label="Espace club" title="Espace club"
                style={{ width: 38, height: 38, borderRadius: '50%', background: th.surface2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', flexShrink: 0 }}>
                <Icon name="settings" size={19} color={th.text} />
              </Link>
            )}
            <NotificationBell /><ProfileMenu />
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
                style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, whiteSpace: 'nowrap', textDecoration: 'none',
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
                {t.href === '/parties' && partiesUnread > 0 && (
                  <CountBadge count={partiesUnread} label={`${partiesUnread} non lus`} fontFamily={th.fontUI} />
                )}
                {t.href === '/parties' && partiesUnread === 0 && openPartiesCount > 0 && (
                  // Aucun message non lu : on montre le nombre de parties ouvertes (pastille accent,
                  // inversée sur l'onglet actif pour rester lisible — comme la pastille « À venir »).
                  <CountBadge count={openPartiesCount} label={`${openPartiesCount} parties ouvertes`} fontFamily={th.fontUI}
                    bg={active ? th.onAccent : th.accent} fg={active ? th.accent : th.onAccent} />
                )}
                {t.href === '/me/reservations' && upcomingCount > 0 && (
                  // Accent comme la pastille de l'onglet « À venir » ; inversé sur l'onglet
                  // actif (fond déjà accent → la pastille passe en onAccent pour rester lisible).
                  <CountBadge count={upcomingCount} label={`${upcomingCount} à venir`} fontFamily={th.fontUI}
                    bg={active ? th.onAccent : th.accent} fg={active ? th.accent : th.onAccent} />
                )}
              </Link>
            );
          })}
        </div>

        {/* Nom du club en pied de barre (mobile uniquement, cf. `.cn-title-bottom`) : le nom ne
            tient pas à côté de la grappe d'icônes dans la rangée 1, on l'affiche ici en entier. */}
        <div className="cn-title-bottom" style={{ marginTop: 11, textAlign: 'center', fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, color: th.text, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{club.name}</div>
      </div>
    </div>
  );
}
