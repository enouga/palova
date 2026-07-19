'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, NationalOpenMatch, NationalTournament } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { hardNavigate } from '@/lib/nav';
import { platformUrl } from '@/lib/clubUrl';
import { parseLocationQuery } from '@/lib/discover';
import { Screen } from '@/components/ui/Screen';
import { Logotype, MyBookingsButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { DiscoverAnchors } from '@/components/discover/DiscoverAnchors';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';
import { ClubDirectory } from '@/components/ClubDirectory';

const SECTION_IDS = ['parties', 'tournois', 'clubs'] as const;
type SectionId = (typeof SECTION_IDS)[number];

// Page « Découvrir » v2 : UNE page, trois sections empilées (Parties → Tournois → Clubs),
// rangée d'ancres collante (navigation dans le scroll, pas des onglets), barre de
// localisation unique (ville / code postal / département + géoloc) qui filtre tout.
// Deep-links : #parties / #tournois / #clubs (les redirections /clubs et /tournois les posent).
export default function DiscoverPage() {
  const { th } = useTheme();
  const { slug } = useClub();

  const [locInput, setLocInput] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const location = useMemo(() => parseLocationQuery(locInput), [locInput]);

  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  const [tournaments, setTournaments] = useState<NationalTournament[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);

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

  const sectionTitle: React.CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text, letterSpacing: -0.3, scrollMarginTop: 72 };

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <MyBookingsButton />
              <ThemeToggle />
              <ProfileMenu />
            </div>
          </div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, marginTop: 22, letterSpacing: -0.5 }}>
            Découvrir
          </div>
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 8 }}>
            Clubs, parties et tournois, partout sur Palova.
          </p>
        </div>

        {/* Barre de localisation unique : ville, code postal ou département + géoloc. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 20px 0' }}>
          <input
            value={locInput}
            onChange={(e) => setLocInput(e.target.value)}
            placeholder="Ville, code postal ou département"
            style={{ flex: '1 1 220px', minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12,
              background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`,
              fontFamily: th.fontUI, fontSize: 15 }}
          />
          <button onClick={locateMe} style={locateBtnStyle(th, !!coords)}>
            📍 {coords ? 'Autour de moi ✓' : geoState === 'locating' ? 'Localisation…' : 'Autour de moi'}
          </button>
          {geoState === 'denied' && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
              Localisation indisponible — cherchez par ville ou département.
            </span>
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

        <section id="parties" data-section="parties" ref={(el) => { sectionRefs.current.parties = el; }} style={{ paddingTop: 10 }}>
          <div style={{ padding: '0 20px' }}>
            <h2 style={sectionTitle}>Ça joue bientôt</h2>
            <DiscoverMatches matches={matches} location={location} coords={coords} now={now}
              onSeeClubs={() => jumpTo('clubs')} onCount={onCountParties} />
          </div>
        </section>

        <section id="tournois" data-section="tournois" ref={(el) => { sectionRefs.current.tournois = el; }} style={{ paddingTop: 26 }}>
          <div style={{ padding: '0 20px' }}>
            <h2 style={sectionTitle}>Tournois</h2>
          </div>
          <TournamentFinder hideTitle items={tournaments} coords={coords}
            city={location.city ?? ''} deptCodes={location.deptCodes} onCount={onCountTournois} />
        </section>

        <section id="clubs" data-section="clubs" ref={(el) => { sectionRefs.current.clubs = el; }} style={{ paddingTop: 26 }}>
          <div style={{ padding: '0 20px' }}>
            <h2 style={sectionTitle}>Clubs</h2>
          </div>
          <ClubDirectory city={location.city ?? ''} coords={coords} deptCodes={location.deptCodes} onCount={onCountClubs} />
        </section>
      </div>
    </Screen>
  );
}

function locateBtnStyle(th: ReturnType<typeof useTheme>['th'], active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '10px 16px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
    background: active ? th.ink : th.surface2,
    color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
  };
}
