'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, ClubSummary, Sport } from '@/lib/api';
import { COVER_PHOTOS } from '@/lib/clubCover';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { ClubCard } from '@/components/ClubCard';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Moteur de recherche d'annuaire (nom / ville / sport) + grille de résultats.
// Bloc embeddable : ne rend QUE la recherche + les résultats (pas de Screen ni de titre de page),
// pour être réutilisé sur /clubs comme sur l'accueil plateforme.
// Mode contrôlé (props city/coords, ex. future page /decouvrir) : la page porte une barre de
// localisation PARTAGÉE (ville + géoloc) au-dessus — le composant masque alors ses propres
// contrôles de localisation et se contente d'appliquer city/coords reçus comme filtre.
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

  const controlled = cityProp !== undefined || coordsProp !== undefined || deptCodes !== undefined;
  const effCity = controlled ? (cityProp ?? '') : cityInput;
  const effCoords = controlled ? (coordsProp ?? null) : coordsInput;

  useEffect(() => { api.getSports().then(setSports).catch(() => setSports([])); }, []);

  // Pré-sélectionne le sport préféré du joueur connecté (modifiable librement ensuite).
  useEffect(() => {
    if (!token) return;
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

  const { railRef, edges, scrollByPage } = useScrollRail([visibleClubs.length]);

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

  return (
    <>
      {/* recherche */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club" style={inputStyle} />
          {!controlled && (
            <input value={cityInput} onChange={(e) => setCityInput(e.target.value)} placeholder="Ville ou région" style={inputStyle} />
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button onClick={() => setSport('')} style={chipBtn(th, sport === '')}>Tous</button>
          {sports.map((s) => (
            <button key={s.key} onClick={() => setSport(sport === s.key ? '' : s.key)} style={chipBtn(th, sport === s.key)}>
              {s.icon ? `${s.icon} ` : ''}{s.name}
            </button>
          ))}
        </div>
        {!controlled && (
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
        )}
      </div>

      {/* résultats — étagère qui défile horizontalement sur 2 lignes (grid-auto-flow:
          column), pas une grille qui wrap : c'est un vrai annuaire (recherche + filtres),
          aucun plafond — tout résultat filtré doit rester atteignable via le défilement. */}
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
          <>
            <style>{`.discover-clubs-grid{display:grid;grid-template-rows:repeat(2,auto);grid-auto-flow:column;grid-auto-columns:270px;gap:16px;align-items:start}`}</style>
            <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 4 }}>
              {visibleClubs.length} club{visibleClubs.length > 1 ? 's' : ''}
            </div>
            <div style={{ position: 'relative', margin: '0 -20px' }}>
              <div ref={railRef} className="sp-scroll-x discover-clubs-grid" style={{ padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
                {visibleClubs.map((c, i) => <ClubCard key={c.id} club={c} defaultCover={COVER_PHOTOS[i % COVER_PHOTOS.length]} />)}
              </div>
              <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Clubs précédents" nextLabel="Clubs suivants" fadeBottom={8} />
            </div>
          </>
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
