'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NationalOpenMatch, NationalTournament } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { parseLocationQuery, DISCOVER_LOCATION_KEY, DISCOVER_MINE_ONLY_KEY } from '@/lib/discover';
import { Icon } from '@/components/ui/Icon';
import { DiscoverAnchors } from '@/components/discover/DiscoverAnchors';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';
import { ClubDirectory } from '@/components/ClubDirectory';
import { LocationSearchPill, PILL_INK } from '@/components/discover/LocationSearchPill';

const SECTION_IDS = ['parties', 'tournois', 'clubs'] as const;
type SectionId = (typeof SECTION_IDS)[number];

// Moteur de découverte de l'accueil : barre de localisation unique (ville / code postal /
// département + géoloc) qui filtre TOUT, rangée d'ancres collante (navigation dans le scroll,
// pas des onglets — les trois sections restent rendues), puis les trois sections filtrables.
// Extrait de l'ex-page /decouvrir pour être embarqué dans l'accueil (`PalovaHome`) : il ne
// porte donc ni `Screen`, ni en-tête, ni hero — le parent s'en charge, et lui passe les
// données brutes. Frontière : le parent possède les DONNÉES, ce composant le FILTRAGE.
// Ancres profondes : #parties / #tournois / #clubs (posées par les redirections /clubs,
// /tournois et /decouvrir).
export function DiscoverSections({ matches, tournaments, now, myClubSlugs, intro }: {
  matches: NationalOpenMatch[] | null;
  tournaments: NationalTournament[] | null;
  now: Date | null;
  /** Slugs des clubs du joueur — active le filtre « Mes clubs ». `null` (visiteur, ou aucune
   * adhésion active) ⇒ pas de chip : jamais de bouton mort. */
  myClubSlugs: Set<string> | null;
  /** Contenu inséré ENTRE la barre collante et la première section (« Comment ça marche »
   * pour le visiteur, blocs personnels pour le connecté). Il vit ici plutôt que chez le
   * parent parce que la pilule de recherche chevauche le bord bas du hero (marge négative) :
   * intercaler quoi que ce soit avant elle la ferait mordre sur ce contenu. */
  intro?: React.ReactNode;
}) {
  const { th } = useTheme();

  const [locInput, setLocInput] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const location = useMemo(() => parseLocationQuery(locInput), [locInput]);
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

  const myClubsChipVisible = (myClubSlugs?.size ?? 0) > 0;
  const myClubsActive = myClubsChipVisible && mineOnly;

  const filteredMatches = useMemo(
    () => (myClubsActive && matches ? matches.filter((m) => myClubSlugs!.has(m.club.slug)) : matches),
    [matches, myClubsActive, myClubSlugs],
  );
  const filteredTournaments = useMemo(
    () => (myClubsActive && tournaments ? tournaments.filter((t) => myClubSlugs!.has(t.club.slug)) : tournaments),
    [tournaments, myClubsActive, myClubSlugs],
  );

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); },
      () => setGeoState('denied'),
      { timeout: 8000 },
    );
  }, []);

  // Deep-links hérités de l'ancienne vitrine, qui envoyait ici : ?q= préremplit la recherche,
  // ?pres=1 lance la géoloc à l'arrivée. Lus une fois au montage (même idiome que le hash plus
  // bas). À défaut de ?q=, on restaure la dernière recherche par lieu mémorisée (localStorage)
  // — la géoloc, elle, n'est jamais rejouée automatiquement.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setLocInput(q);
    else { try { const saved = localStorage.getItem(DISCOVER_LOCATION_KEY); if (saved) setLocInput(saved); } catch { /* stockage indispo */ } }
    if (params.get('pres') === '1') locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mémorise le texte de recherche par lieu d'une session à l'autre (le montage est sauté pour
  // ne pas écraser la valeur restaurée avant sa relecture).
  const wroteLocOnce = useRef(false);
  useEffect(() => {
    if (!wroteLocOnce.current) { wroteLocOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_LOCATION_KEY, locInput); } catch { /* stockage indispo */ }
  }, [locInput]);

  // « Mes clubs » mémorisé d'une session à l'autre (comme la recherche par lieu et les filtres
  // Tournois/Parties/Clubs) — ne s'applique, comme toujours, que si une adhésion active existe.
  useEffect(() => {
    try { if (localStorage.getItem(DISCOVER_MINE_ONLY_KEY) === '1') setMineOnly(true); }
    catch { /* stockage indisponible */ }
  }, []);

  const wroteMineOnlyOnce = useRef(false);
  useEffect(() => {
    if (!wroteMineOnlyOnce.current) { wroteMineOnlyOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_MINE_ONLY_KEY, mineOnly ? '1' : '0'); } catch { /* stockage indisponible */ }
  }, [mineOnly]);

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const id = visible?.target.getAttribute('data-section') as SectionId | undefined;
      if (id) setActive(id);
    }, { rootMargin: '-96px 0px -55% 0px' });
    for (const id of SECTION_IDS) { const el = sectionRefs.current[id]; if (el) io.observe(el); }
    return () => io.disconnect();
  }, []);

  const jumpTo = useCallback((id: string) => {
    sectionRefs.current[id as SectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Deep-link #hash : on ne scrolle qu'une fois les sections du dessus dimensionnées
  // (parties + tournois chargés), sinon l'ancre dérive pendant que la page grandit.
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (jumpedRef.current || matches === null || tournaments === null) return;
    const target = window.location.hash.slice(1) as SectionId;
    if ((SECTION_IDS as readonly string[]).includes(target)) { jumpedRef.current = true; jumpTo(target); }
  }, [matches, tournaments, jumpTo]);

  // Sections au langage éditorial du site : tiret accent + kicker petites capitales + titre display.
  const kickStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute };
  const tick = <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: th.accent }} />;
  const titleStyle: React.CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text, letterSpacing: -0.5, margin: '7px 0 0', scrollMarginTop: 72 };

  return (
    <>
      {/* Recherche par lieu + ancres : collantes ENSEMBLE (un seul conteneur sticky) pour
          garder le filtre lieu actionnable en scrollant les listes, sans dupliquer la pilule. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: th.bg }}>
        <div style={{ padding: '0 18px' }}>
          <LocationSearchPill value={locInput} onChange={setLocInput} onNearMe={locateMe}
            nearActive={!!coords} locating={geoState === 'locating'}
            onClear={() => { setLocInput(''); setCoords(null); setGeoState('idle'); }}
            extra={myClubsChipVisible && (
              <button type="button" onClick={() => setMineOnly((v) => !v)} aria-pressed={mineOnly}
                aria-label="Mes clubs" title="Filtrer sur ses clubs" style={{
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

      {intro}

      <section id="parties" data-section="parties" ref={(el) => { sectionRefs.current.parties = el; }} style={{ paddingTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ padding: '0 20px', flex: '1 1 auto', minWidth: 0 }}>
          <div style={kickStyle}>{tick}En ce moment</div>
          <h2 style={titleStyle}>Ça joue bientôt</h2>
        </div>
        <DiscoverMatches matches={filteredMatches} location={location} coords={coords} now={now}
          onSeeClubs={() => jumpTo('clubs')} onCount={onCountParties} />
      </section>

      <section id="tournois" data-section="tournois" ref={(el) => { sectionRefs.current.tournois = el; }} style={{ paddingTop: 26, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ padding: '0 20px', flex: '1 1 auto', minWidth: 0 }}>
          <div style={kickStyle}>{tick}Compétition</div>
          <h2 style={titleStyle}>Prochains tournois</h2>
        </div>
        <TournamentFinder hideTitle items={filteredTournaments} coords={coords}
          city={location.city ?? ''} deptCodes={location.deptCodes} onCount={onCountTournois} />
      </section>

      <section id="clubs" data-section="clubs" ref={(el) => { sectionRefs.current.clubs = el; }} style={{ paddingTop: 26, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ padding: '0 20px', flex: '1 1 auto', minWidth: 0 }}>
          <div style={kickStyle}>{tick}Annuaire</div>
          <h2 style={titleStyle}>Clubs près de chez vous</h2>
        </div>
        <ClubDirectory city={location.city ?? ''} coords={coords} deptCodes={location.deptCodes}
          onlySlugs={myClubsActive ? myClubSlugs : null} onCount={onCountClubs} />
      </section>
    </>
  );
}
