'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { api, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Icon, type IconName } from '@/components/ui/Icon';

// Permet à une page (ex. Planning) de replier la barre latérale et d'élargir le contenu.
export const AdminChromeContext = createContext<{ collapsed: boolean; setCollapsed: (v: boolean) => void }>({
  collapsed: false,
  setCollapsed: () => {},
});
export function useAdminChrome() { return useContext(AdminChromeContext); }

// Préférence persistante de repli de la sidebar (survit à la navigation et au rechargement).
const SIDEBAR_KEY = 'palova:admin-sidebar';
// Sections du menu repliées (liste de titres), persistée comme le repli global.
const SECTIONS_KEY = 'palova:admin-sidebar-sections';

// Assombrit (factor<1) ou éclaircit (>1) une couleur hex #rrggbb. Sert à rendre les
// titres de section colorés lisibles sur fond clair sans perdre la teinte.
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // Pas de mismatch d'hydration : le premier rendu est « Chargement… », indépendant de cette valeur.
  const [collapsed, setCollapsedState] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem(SIDEBAR_KEY);
    if (saved === 'collapsed') return true;
    if (saved === 'open') return false;
    // Aucune préférence enregistrée : replié par défaut sur téléphone (petit écran),
    // où la sidebar de 244 px mangerait l'essentiel de la largeur.
    return window.matchMedia('(max-width: 768px)').matches;
  });
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { window.localStorage.setItem(SIDEBAR_KEY, v ? 'collapsed' : 'open'); } catch { /* stockage indisponible : préférence non persistée */ }
  }, []);

  // Sections repliées (par titre). Tout déplié par défaut ; choix mémorisé en localStorage.
  const [collapsedSections, setCollapsedSectionsState] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SECTIONS_KEY);
      if (raw) return JSON.parse(raw) as string[];
    } catch { /* stockage indisponible : pas de préférence */ }
    return [];
  });
  const setCollapsedSections = useCallback((next: string[]) => {
    setCollapsedSectionsState(next);
    try { window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* non persisté */ }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!token) { router.replace('/login'); return; }
    if (!club) return; // attend le fetch du club (host)
    api.getMyClubs(token)
      .then((cs) => setAllowed(cs.some((c) => c.clubId === club.id)))
      .catch(() => setAllowed(false));
  }, [ready, token, club, router]);

  useEffect(() => { if (allowed === false) router.replace('/'); }, [allowed, router]);

  if (!ready || !token || !club || allowed !== true) {
    return (
      <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>
        Chargement…
      </div>
    );
  }

  // Menu groupé en familles : chaque entrée garde sa page (rien de fusionné), mais les
  // sections rendent les 18 liens scannables. Icônes dé-dupliquées (plus de doublon).
  type NavItem = { href: string; label: string; icon: IconName };
  // Une couleur par famille (palette du thème) — appliquée à la pastille + au titre de section.
  const sections: { title?: string; color?: string; items: NavItem[] }[] = [
    { items: [
      { href: '/admin', label: 'Tableau de bord', icon: 'grid' },
    ] },
    { title: 'Au quotidien', color: '#5e93da', items: [
      { href: '/admin/planning',     label: 'Planning',     icon: 'calendar' },
      { href: '/admin/reservations', label: 'Encaissement', icon: 'ticket' },
      { href: '/admin/caisse',       label: 'Caisse',       icon: 'euro' },
    ] },
    { title: 'Animations & jeu', color: '#e6a93c', items: [
      { href: '/admin/tournaments', label: 'Tournois', icon: 'trophy' },
      { href: '/admin/events',      label: 'Events',   icon: 'bolt' },
      // Lien « Matchs » masqué quand le système de niveau est désactivé pour le club.
      ...(club.levelSystemEnabled === false
        ? []
        : [{ href: '/admin/matches', label: 'Matchs', icon: 'trophy' } as NavItem]),
      { href: '/admin/coaches',     label: 'Coachs',   icon: 'user' },
    ] },
    { title: 'Communauté', color: '#2bb6a3', items: [
      { href: '/admin/members',       label: 'Membres',     icon: 'users' },
      { href: '/admin/announcements', label: 'Annonces',    icon: 'bell' },
      { href: '/admin/broadcast',     label: 'Messages',    icon: 'mail' },
      { href: '/admin/sponsors',      label: 'Partenaires', icon: 'share' },
    ] },
    { title: 'Finances', color: '#5bbd6e', items: [
      { href: '/admin/payments',     label: 'Paiement en ligne', icon: 'lock' },
      { href: '/admin/comptabilite', label: 'Comptabilité',     icon: 'chart' },
      { href: '/admin/packages',     label: 'Offres prépayées', icon: 'card' },
    ] },
    { title: 'Configuration', color: '#9b8cf0', items: [
      { href: '/admin/courts',   label: 'Ressources',         icon: 'indoor' },
      { href: '/admin/sports',   label: 'Sports',             icon: 'ball' },
      { href: '/admin/pages',    label: 'Contenu & mentions', icon: 'info' },
      { href: '/admin/settings', label: 'Réglages',           icon: 'settings' },
    ] },
  ];

  // Repli des sections : liste des titres repliables, état « tout replié », bascules.
  const titledSections = sections.map((s) => s.title).filter((t): t is string => !!t);
  const allCollapsed = titledSections.length > 0 && titledSections.every((t) => collapsedSections.includes(t));
  const toggleSection = (title: string) =>
    setCollapsedSections(
      collapsedSections.includes(title)
        ? collapsedSections.filter((t) => t !== title)
        : [...collapsedSections, title],
    );
  const toggleAll = () => setCollapsedSections(allCollapsed ? [] : titledSections);

  const sectionHeaderStyle = {
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
    textTransform: 'uppercase' as const, color: th.textFaint, padding: '6px 10px 6px',
  };

  return (
    <AdminChromeContext.Provider value={{ collapsed, setCollapsed }}>
    <div style={{ minHeight: '100vh', background: th.bg, color: th.text, fontFamily: th.fontUI, display: 'flex' }}>
      {!collapsed && (
      <aside style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh',
        width: 244, flexShrink: 0, boxSizing: 'border-box',
        background: th.bgElev, borderRight: `1px solid ${th.line}`,
        display: 'flex', flexDirection: 'column', padding: '20px 14px',
      }}>
        {/* marque + identité club */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 6px' }}>
          {club.logoUrl
            ? <img src={assetUrl(club.logoUrl) ?? undefined} alt={club.name} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
            : <Logotype size={22} />}
          <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{club.name}</span>
          <button type="button" aria-label="Masquer le menu" title="Masquer le menu" onClick={() => setCollapsed(true)} style={{
            marginLeft: 'auto', flexShrink: 0, width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${th.line}`, color: th.textMute,
            fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>⟨</button>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', marginTop: 10 }}>
          <button type="button" onClick={toggleAll} title={allCollapsed ? 'Tout déplier' : 'Tout replier'} style={{
            alignSelf: 'flex-end', background: 'transparent', border: 'none', cursor: 'pointer',
            color: th.textFaint, fontFamily: th.fontUI, fontSize: 11, padding: '0 8px 4px',
          }}>{allCollapsed ? 'Tout déplier' : 'Tout replier'}</button>
          {sections.map((sec, i) => {
            const isCollapsed = sec.title ? collapsedSections.includes(sec.title) : false;
            return (
              <div key={sec.title ?? 'top'} role="group" aria-label={sec.title} style={{ display: 'contents' }}>
                {sec.title && (
                  <button type="button" onClick={() => toggleSection(sec.title!)} aria-expanded={!isCollapsed}
                    title={isCollapsed ? `Déplier ${sec.title}` : `Replier ${sec.title}`}
                    style={{
                      ...sectionHeaderStyle, marginTop: i === 0 ? 0 : 12,
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: sec.color, flexShrink: 0 }} />
                    {/* Titre teinté : assombri en mode clair (lisible), couleur d'origine en sombre. */}
                    <span style={{ color: th.mode === 'daylight' ? shade(sec.color!, 0.6) : sec.color, fontWeight: 700, flex: 1 }}>{sec.title}</span>
                    <Icon name="chevR" size={13} color={th.textFaint} style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s' }} />
                  </button>
                )}
                {!isCollapsed && sec.items.map((l) => {
                  const active = pathname === l.href;
                  return (
                    <Link key={l.href} href={l.href} style={{
                      display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 11, textDecoration: 'none',
                      fontFamily: th.fontUI, fontSize: 14, fontWeight: active ? 700 : 500,
                      background: active ? th.surface2 : 'transparent',
                      color: active ? th.text : th.textMute,
                    }}>
                      <Icon name={l.icon} size={18} color={active ? th.accent : th.textMute} />{l.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
          <ThemeToggle />
          <ProfileMenu direction="up" align="left" />
        </div>
      </aside>
      )}

      <main style={{ flex: 1, minWidth: 0, maxWidth: '100%', padding: collapsed ? '22px 30px 48px' : '28px 32px 48px' }}>
        {collapsed && (
          // height: 0 — le bouton flotte sans décaler le contenu ; sticky pour rester accessible en scrollant.
          <div style={{ position: 'sticky', top: 12, zIndex: 40, height: 0, marginLeft: -14 }}>
            <button type="button" aria-label="Afficher le menu" title="Afficher le menu" onClick={() => setCollapsed(false)} style={{
              width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
              background: th.bgElev, border: `1px solid ${th.line}`, color: th.textMute,
              fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⟩</button>
          </div>
        )}
        {children}
      </main>
    </div>
    </AdminChromeContext.Provider>
  );
}
