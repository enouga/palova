'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, ClubSummary, Sport } from '@/lib/api';
import { COVER_PHOTOS } from '@/lib/clubCover';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { ClubCard } from '@/components/ClubCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { Icon } from '@/components/ui/Icon';
import { FiltersToggle } from '@/components/ui/FiltersToggle';
import { DISCOVER_CLUBS_FILTERS_KEY, clubsStateToStored, storedToClubsFilters } from '@/lib/discover';

// Moteur de recherche d'annuaire (nom / ville / sport) + grille de résultats.
// Bloc embeddable : ne rend QUE la recherche + les résultats (pas de Screen ni de titre de page),
// pour être réutilisé sur /clubs comme sur l'accueil plateforme.
// Mode contrôlé (props city/coords, page /decouvrir) : la page porte une barre de localisation
// PARTAGÉE (ville + géoloc) au-dessus — le composant masque ses propres contrôles de
// localisation ; le champ « Nom du club » + les chips sport passent alors derrière un tiroir
// repliable « Filtres · N » (mémorisé en localStorage) et les cartes utilisent le rail compact
// 272px (comme les cartes de parties). La vitrine anonyme (mode autonome) garde sa recherche
// toujours visible, ses cartes larges, et ne mémorise rien.
export function ClubDirectory({ city: cityProp, coords: coordsProp, deptCodes, onlySlugs, onCount }: { city?: string; coords?: { lat: number; lng: number } | null; deptCodes?: string[]; onlySlugs?: Set<string> | null; onCount?: (n: number) => void } = {}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const [sports, setSports] = useState<Sport[]>([]);
  const [clubs, setClubs]   = useState<ClubSummary[]>([]);
  const [q, setQ]           = useState('');
  const [cityInput, setCityInput] = useState('');
  const [sport, setSport]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [coordsInput, setCoordsInput] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const controlled = cityProp !== undefined || coordsProp !== undefined || deptCodes !== undefined;
  const effCity = controlled ? (cityProp ?? '') : cityInput;
  const effCoords = controlled ? (coordsProp ?? null) : coordsInput;

  useEffect(() => { api.getSports().then(setSports).catch(() => setSports([])); }, []);

  // Restauration des filtres (mode contrôlé seulement — la vitrine anonyme ne mémorise rien).
  // Déclarée AVANT l'effet de pré-sélection du sport préféré ci-dessous : une entrée stockée
  // (même vide) doit empêcher ce dernier de forcer un sport (sinon impossible de mémoriser
  // le choix « Tous »).
  const skipSportPreselect = useRef(false);
  useEffect(() => {
    if (!controlled) return;
    try {
      const raw = localStorage.getItem(DISCOVER_CLUBS_FILTERS_KEY);
      if (raw != null) {
        skipSportPreselect.current = true;
        const s = storedToClubsFilters(JSON.parse(raw));
        setQ(s.q); setSport(s.sport);
      }
    } catch { /* stockage indisponible (mode privé/quota) : état par défaut */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pré-sélectionne le sport préféré du joueur connecté (modifiable librement ensuite) — sauté
  // si une mémoire de filtres existe déjà (mode contrôlé), pour ne jamais écraser un choix
  // explicite restauré depuis le stockage.
  useEffect(() => {
    if (!token) return;
    if (skipSportPreselect.current) return;
    api.getMyProfile(token).then((p) => {
      if (p.preferredSport?.key) setSport((cur) => cur || p.preferredSport!.key);
    }).catch(() => {});
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listClubs({
        q: q || undefined, city: effCity || undefined, sport: sport || undefined,
        ...(effCoords ? { lat: effCoords.lat, lng: effCoords.lng } : {}),
        ...(deptCodes && deptCodes.length ? { dept: deptCodes } : {}),
      });
      setClubs(list);
      setError(false);
    } catch { setClubs([]); setError(true); }
    finally { setLoading(false); }
  }, [q, effCity, effCoords, sport, deptCodes?.join(',')]);

  // Mémorisation des filtres (mode contrôlé seulement), après la restauration (le 1ᵉʳ passage
  // est sauté — sinon on écrirait l'état par défaut avant que la restauration n'ait pris effet).
  const wroteClubFiltersOnce = useRef(false);
  useEffect(() => {
    if (!controlled) return;
    if (!wroteClubFiltersOnce.current) { wroteClubFiltersOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_CLUBS_FILTERS_KEY, JSON.stringify(clubsStateToStored({ q, sport }))); } catch { /* stockage indisponible */ }
  }, [controlled, q, sport]);

  // Rétrécit les clubs déjà chargés par slug (filtre « Mes clubs » posé par /decouvrir) —
  // purement côté client, `onlySlugs` reste hors des deps de `load()` : basculer le filtre ne
  // redéclenche jamais `listClubs`.
  const visibleClubs = useMemo(
    () => (onlySlugs ? clubs.filter((c) => onlySlugs.has(c.slug)) : clubs),
    [clubs, onlySlugs],
  );

  // Notifie le parent du nombre de clubs affichés — effet DÉDIÉ, découplé de `load` (dont
  // l'identité pilote le debounce de fetch) pour qu'un changement d'identité de `onCount`
  // ne relance jamais le fetch. `visibleClubs` reflète déjà le résultat (y compris `[]` sur erreur).
  useEffect(() => { onCount?.(visibleClubs.length); }, [visibleClubs.length, onCount]);

  const locateMe = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoordsInput({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); },
      () => setGeoState('denied'),
      { timeout: 8000 },
    );
  };

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const inputStyle = { flex: 1, minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12, background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`, fontFamily: th.fontUI, fontSize: 15 } as const;

  // Filtres propres à l'annuaire (la localisation en mode contrôlé vient de la barre partagée,
  // réinitialisée à part) : nom + sport, plus ville/géoloc en mode autonome (/clubs).
  const clubFiltersActive = !!q || !!sport || (!controlled && (!!cityInput || !!coordsInput));
  const clubsFilterCount = (q ? 1 : 0) + (sport ? 1 : 0);
  const resetClubFilters = () => {
    setQ(''); setSport('');
    if (!controlled) { setCityInput(''); setCoordsInput(null); setGeoState('idle'); }
  };

  return (
    <>
      {controlled ? (
        <>
          <FiltersToggle count={clubsFilterCount} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} onClear={resetClubFilters} controlsId="clubs-facets" />
          {filtersOpen && (
            <div id="clubs-facets" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 20px 0' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club" style={inputStyle} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setSport('')} style={chipBtn(th, sport === '')}>Tous</button>
                {sports.map((s) => (
                  <button key={s.key} onClick={() => setSport(sport === s.key ? '' : s.key)} style={chipBtn(th, sport === s.key)}>
                    {s.icon ? `${s.icon} ` : ''}{s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club" style={inputStyle} />
            <input value={cityInput} onChange={(e) => setCityInput(e.target.value)} placeholder="Ville ou région" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setSport('')} style={chipBtn(th, sport === '')}>Tous</button>
            {sports.map((s) => (
              <button key={s.key} onClick={() => setSport(sport === s.key ? '' : s.key)} style={chipBtn(th, sport === s.key)}>
                {s.icon ? `${s.icon} ` : ''}{s.name}
              </button>
            ))}
            {clubFiltersActive && (
              <button onClick={resetClubFilters} style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
                borderRadius: 999, padding: '6px 12px', background: 'transparent', boxShadow: `inset 0 0 0 1px ${th.lineStrong}`,
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute,
              }}>
                <Icon name="x" size={12} color={th.textMute} />Effacer les filtres
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={locateMe} style={chipBtn(th, !!coordsInput)}>
              📍 {coordsInput ? 'Autour de moi ✓' : geoState === 'locating' ? 'Localisation…' : 'Autour de moi'}
            </button>
            {geoState === 'denied' && (
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
                Localisation indisponible — cherchez par ville ou région.
              </span>
            )}
          </div>
        </div>
      )}

      {/* résultats — rail partagé AgendaRail (1 rangée) : c'est un vrai annuaire (recherche +
          filtres), aucun plafond de résultats — tout résultat filtré reste atteignable via
          le défilement (les points de pagination du rail se masquent au-delà de 12 cartes).
          Mode contrôlé (/decouvrir) : cartes compactes 272px, comme les cartes de parties. */}
      <div style={{ padding: '20px 20px 0' }}>
        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : error ? (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
            Impossible de charger les clubs pour le moment.
            <div style={{ marginTop: 10 }}>
              <button onClick={load} style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '8px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>Réessayer</button>
            </div>
          </div>
        ) : visibleClubs.length === 0 ? (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Aucun club ne correspond.</div>
        ) : (
          <AgendaRail
            countLabel={`${visibleClubs.length} club${visibleClubs.length > 1 ? 's' : ''}`}
            desktopColumns={controlled ? '272px' : 'calc((100% - 24px) / 3)'} desktopRows={1}
            mobileColumns={controlled ? '272px' : undefined}
            prevLabel="Clubs précédents" nextLabel="Clubs suivants"
          >
            {visibleClubs.map((c, i) => <ClubCard key={c.id} club={c} defaultCover={COVER_PHOTOS[i % COVER_PHOTOS.length]} />)}
          </AgendaRail>
        )}
      </div>
    </>
  );
}

function chipBtn(th: ReturnType<typeof useTheme>['th'], active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '8px 14px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
    background: active ? th.ink : th.surface2,
    color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
  };
}
