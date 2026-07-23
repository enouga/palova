'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, NationalOpenMatch, NationalTournament, PlayerMembership } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { hardNavigate } from '@/lib/nav';
import { platformUrl } from '@/lib/clubUrl';
import { parseLocationQuery } from '@/lib/discover';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle, BackButton } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Icon } from '@/components/ui/Icon';
import { ACCENTS } from '@/lib/theme';
import { DiscoverAnchors } from '@/components/discover/DiscoverAnchors';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';
import { ClubDirectory } from '@/components/ClubDirectory';
import { HERO_GRADIENT, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';
import { LocationSearchPill, PILL_INK } from '@/components/discover/LocationSearchPill';

const SECTION_IDS = ['parties', 'tournois', 'clubs'] as const;
type SectionId = (typeof SECTION_IDS)[number];

// Page « Où jouer » v2 : UNE page, trois sections empilées (Parties → Tournois → Clubs),
// rangée d'ancres collante (navigation dans le scroll, pas des onglets), barre de
// localisation unique (ville / code postal / département + géoloc) qui filtre tout.
// Deep-links : #parties / #tournois / #clubs (les redirections /clubs et /tournois les posent).
export function DiscoverClient() {
  const { th } = useTheme();
  const { slug } = useClub();
  const { token } = useAuth();

  const [locInput, setLocInput] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const location = useMemo(() => parseLocationQuery(locInput), [locInput]);

  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  const [tournaments, setTournaments] = useState<NationalTournament[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [memberships, setMemberships] = useState<PlayerMembership[] | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  // Compteurs remontés par chaque section (items actuellement affichés).
  const [counts, setCounts] = useState<Record<SectionId, number | null>>({ parties: null, tournois: null, clubs: null });
  const countFor = useCallback((id: SectionId) => (n: number) => setCounts((c) => (c[id] === n ? c : { ...c, [id]: n })), []);
  const onCountParties = useMemo(() => countFor('parties'), [countFor]);
  const onCountTournois = useMemo(() => countFor('tournois'), [countFor]);
  const onCountClubs = useMemo(() => countFor('clubs'), [countFor]);

  // Scroll-spy : section active = la plus visible (IntersectionObserver, stubé en jsdom).
  const [active, setActive] = useState<SectionId>('parties');
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({ parties: null, tournois: null, clubs: null });

  // /decouvrir n'existe que sur la plateforme : un hôte club renvoie vers le domaine racine
  // (query + hash conservés) — et les effets data restent inertes pendant la redirection.
  useEffect(() => {
    if (slug) hardNavigate(platformUrl('/decouvrir' + window.location.search + window.location.hash));
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([]));
    api.listNationalTournaments().then(setTournaments).catch(() => setTournaments([]));
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    if (!token) { setMemberships(null); return; }
    api.getMyMemberships(token).then(setMemberships).catch(() => setMemberships([]));
  }, [slug, token]);

  // Adhésions ACTIVE seulement — le backend renvoie aussi les BLOCKED sans les filtrer, un
  // membre bloqué ne compte pas comme « son » club pour ce filtre.
  const myClubSlugs = useMemo(
    () => new Set((memberships ?? []).filter((m) => m.status === 'ACTIVE').map((m) => m.club.slug)),
    [memberships],
  );
  // Mirroir du chip « À mon niveau » de DiscoverMatches : pas de toggle mort pour un joueur
  // non connecté ou sans adhésion active.
  const myClubsChipVisible = Boolean(token) && myClubSlugs.size > 0;
  const myClubsActive = myClubsChipVisible && mineOnly;

  const filteredMatches = useMemo(
    () => (myClubsActive && matches ? matches.filter((m) => myClubSlugs.has(m.club.slug)) : matches),
    [matches, myClubsActive, myClubSlugs],
  );
  const filteredTournaments = useMemo(
    () => (myClubsActive && tournaments ? tournaments.filter((t) => myClubSlugs.has(t.club.slug)) : tournaments),
    [tournaments, myClubsActive, myClubSlugs],
  );

  // Deep-links posés par le hero de la vitrine : ?q= préremplit la recherche, ?pres=1 lance la
  // géoloc à l'arrivée. Lus une fois au montage (même idiome que le hash plus bas).
  useEffect(() => {
    if (slug) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setLocInput(q);
    if (params.get('pres') === '1') locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const id = visible?.target.getAttribute('data-section') as SectionId | undefined;
      if (id) setActive(id);
    }, { rootMargin: '-96px 0px -55% 0px' });
    for (const id of SECTION_IDS) { const el = sectionRefs.current[id]; if (el) io.observe(el); }
    return () => io.disconnect();
  }, [slug]);

  const jumpTo = useCallback((id: string) => {
    sectionRefs.current[id as SectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Deep-link #hash : on ne scrolle qu'une fois les sections du dessus dimensionnées
  // (parties + tournois chargés), sinon l'ancre dérive pendant que la page grandit.
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (slug || jumpedRef.current || matches === null || tournaments === null) return;
    const target = window.location.hash.slice(1) as SectionId;
    if ((SECTION_IDS as readonly string[]).includes(target)) { jumpedRef.current = true; jumpTo(target); }
  }, [slug, matches, tournaments, jumpTo]);

  const locateMe = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); },
      () => setGeoState('denied'),
      { timeout: 8000 },
    );
  };

  if (slug) return null; // hôte club : redirection vers la plateforme en cours

  // Sections au langage éditorial du site : tiret accent + kicker petites capitales + titre display.
  const kickStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute };
  const tick = <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: th.accent }} />;
  const titleStyle: React.CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text, letterSpacing: -0.5, margin: '7px 0 0', scrollMarginTop: 72 };

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ThemeToggle />
              <ProfileMenu />
            </div>
          </div>
        </div>

        <div style={{ padding: '4px 20px 0' }}>
          <BackButton href="/" label="Accueil" />
        </div>

        {/* Mini-hero brume : l'établi ne re-séduit pas (pas de titre-promesse — le hero complet
            vit sur la vitrine anonyme) ; petite France en filigrane pour la continuité. */}
        <div style={{ padding: '10px 18px 0' }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: HERO_GRADIENT, padding: '26px 24px 46px' }}>
            <FranceDotsMap pins="few" style={{ height: '150%', right: -20, opacity: 0.55 }} />
            <div style={{ position: 'relative', fontFamily: th.fontBrand, fontSize: 15, letterSpacing: 3, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
              Où jouer
            </div>
          </div>
        </div>

        {/* Recherche par lieu + ancres : collantes ENSEMBLE (un seul conteneur sticky) pour
            garder le filtre lieu actionnable en scrollant les listes, sans dupliquer la pilule. */}
        <div style={{ position: 'sticky', top: 0, zIndex: 30, background: th.bg }}>
          <div style={{ padding: '0 18px' }}>
            <LocationSearchPill value={locInput} onChange={setLocInput} onNearMe={locateMe}
              nearActive={!!coords} locating={geoState === 'locating'}
              onClear={() => { setLocInput(''); setCoords(null); setGeoState('idle'); }}
              extra={myClubsChipVisible && (
                <button type="button" onClick={() => setMineOnly((v) => !v)} aria-pressed={mineOnly}
                  aria-label="Mes clubs" title="Mes clubs" style={{
                    flexShrink: 0, border: 'none', cursor: 'pointer', width: 42, height: 42, borderRadius: 999,
                    background: mineOnly ? ACCENTS.blue : '#eef1f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <Icon name="home" size={18} color={mineOnly ? '#ffffff' : PILL_INK} />
                </button>
              )} />
            {geoState === 'denied' && (
              <div style={{ textAlign: 'center', margin: '8px 0 0', fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
                Localisation indisponible — cherchez par ville ou département.
              </div>
            )}
          </div>

          <DiscoverAnchors
            items={[
              { id: 'parties', label: 'Parties', count: counts.parties },
              { id: 'tournois', label: 'Tournois', count: counts.tournois },
              { id: 'clubs', label: 'Clubs', count: counts.clubs },
            ]}
            active={active}
            onJump={jumpTo}
          />
        </div>

        <section id="parties" data-section="parties" ref={(el) => { sectionRefs.current.parties = el; }} style={{ paddingTop: 10 }}>
          <div style={{ padding: '0 20px' }}>
            <div style={kickStyle}>{tick}Parties ouvertes</div>
            <h2 style={titleStyle}>Ça joue bientôt</h2>
            <DiscoverMatches matches={filteredMatches} location={location} coords={coords} now={now}
              onSeeClubs={() => jumpTo('clubs')} onCount={onCountParties} />
          </div>
        </section>

        <section id="tournois" data-section="tournois" ref={(el) => { sectionRefs.current.tournois = el; }} style={{ paddingTop: 26 }}>
          <div style={{ padding: '0 20px' }}>
            <div style={kickStyle}>{tick}Compétition</div>
            <h2 style={titleStyle}>Tournois</h2>
          </div>
          <TournamentFinder hideTitle items={filteredTournaments} coords={coords}
            city={location.city ?? ''} deptCodes={location.deptCodes} onCount={onCountTournois} />
        </section>

        <section id="clubs" data-section="clubs" ref={(el) => { sectionRefs.current.clubs = el; }} style={{ paddingTop: 26 }}>
          <div style={{ padding: '0 20px' }}>
            <div style={kickStyle}>{tick}Annuaire</div>
            <h2 style={titleStyle}>Clubs</h2>
          </div>
          <ClubDirectory city={location.city ?? ''} coords={coords} deptCodes={location.deptCodes}
            onlySlugs={myClubsActive ? myClubSlugs : null} onCount={onCountClubs} />
        </section>
      </div>
    </Screen>
  );
}
