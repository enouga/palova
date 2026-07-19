'use client';
import { useEffect, useRef, useState } from 'react';
import { api, NationalOpenMatch } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { hardNavigate } from '@/lib/nav';
import { platformUrl } from '@/lib/clubUrl';
import { Screen } from '@/components/ui/Screen';
import { Logotype, MyBookingsButton, ThemeToggle, PillTabs } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';
import { ClubDirectory } from '@/components/ClubDirectory';

type DiscoverTab = 'parties' | 'tournois' | 'clubs';

const TAB_OPTIONS: { value: DiscoverTab; label: string }[] = [
  { value: 'parties', label: 'Parties' },
  { value: 'tournois', label: 'Tournois' },
  { value: 'clubs', label: 'Clubs' },
];

// Page « Découvrir » : point d'entrée unique de la vitrine plateforme pour parcourir parties
// ouvertes / tournois / clubs, avec une barre de localisation (ville + géoloc) PARTAGÉE entre
// les 3 onglets. Orchestrateur fin : gère seulement l'état commun (onglet, ville/coords,
// horloge, chargement des parties) et délègue tout le rendu métier aux composants déjà bâtis
// (DiscoverMatches, TournamentFinder, ClubDirectory) — un seul monté à la fois.
export default function DiscoverPage() {
  const { th } = useTheme();
  const { slug } = useClub();

  const [tab, setTab] = useState<DiscoverTab>('parties');
  const tabUrlReady = useRef(false);

  const [city, setCity] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');

  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // /decouvrir n'existe que sur la plateforme (annuaire cross-club) : un hôte club renvoie
  // vers le même chemin sur le domaine racine, query string conservée (ex. ?tab=clubs).
  useEffect(() => {
    if (slug) hardNavigate(platformUrl('/decouvrir' + window.location.search));
  }, [slug]);

  // Lecture initiale de ?tab= (seuls tournois/clubs reconnus, sinon Parties par défaut).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'tournois' || q === 'clubs') setTab(q);
    tabUrlReady.current = true;
  }, []);

  // Écriture de l'URL (replaceState : lien partageable). Ne touche QUE la clé `tab` — même
  // règle de merge que TournamentFinder — pour préserver les autres paramètres de la page
  // (ex. les filtres du calendrier des tournois une fois cet onglet actif).
  useEffect(() => {
    if (!tabUrlReady.current) return;
    const q = new URLSearchParams(window.location.search);
    q.delete('tab');
    if (tab !== 'parties') q.set('tab', tab);
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [tab]);

  // Horloge (hydration-safe : null au 1er rendu), consommée par l'onglet Parties.
  // Inerte sur un hôte club : la page ne rend rien pendant la redirection (voir plus bas).
  useEffect(() => {
    if (slug) return;
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, [slug]);

  // Parties ouvertes nationales : chargées une fois au montage, indépendamment de l'onglet
  // actif (l'onglet Parties ne fait aucun fetch lui-même — il reçoit la liste en props).
  // Inerte sur un hôte club : inutile de fetcher juste avant de rediriger vers la plateforme.
  useEffect(() => {
    if (slug) return;
    api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([]));
  }, [slug]);

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

        {/* Barre de localisation partagée entre les 3 onglets (pattern ClubDirectory). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 20px 0' }}>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Ville"
            style={{
              flex: '1 1 220px', minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12,
              background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`,
              fontFamily: th.fontUI, fontSize: 15,
            }}
          />
          <button onClick={locateMe} style={locateBtnStyle(th, !!coords)}>
            📍 {coords ? 'Autour de moi ✓' : geoState === 'locating' ? 'Localisation…' : 'Autour de moi'}
          </button>
          {geoState === 'denied' && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
              Localisation indisponible — cherchez par ville.
            </span>
          )}
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          <PillTabs options={TAB_OPTIONS} value={tab} onChange={setTab} />
        </div>

        <div style={{ paddingTop: 18 }}>
          {tab === 'parties' && (
            <div style={{ padding: '0 20px' }}>
              <DiscoverMatches matches={matches} location={{ city, deptCodes: [] }} coords={coords} now={now} onSeeClubs={() => setTab('clubs')} />
            </div>
          )}
          {tab === 'tournois' && <TournamentFinder hideTitle coords={coords} city={city} />}
          {tab === 'clubs' && <ClubDirectory city={city} coords={coords} />}
        </div>
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
