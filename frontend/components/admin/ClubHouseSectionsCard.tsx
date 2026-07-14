'use client';
import { useCallback, useEffect, useRef, useState, CSSProperties } from 'react';
import { api, ClubHouseSectionKey, ClubHouseSectionSetting } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { fullSectionSettings, SECTION_DEFS } from '@/lib/clubhouse';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// Carte « Sections du Club-house » : visibilité + ordre des sections de la landing du club.
// Drag natif HTML5 (pattern /admin/courts) + boutons ↑↓ (mobile/accessibilité) + interrupteurs.
// Persistance immédiate à chaque geste (état optimiste, erreur → recharge serveur).
// Reset → PATCH clubHouseSections: null (retour à l'ordre adaptatif visiteur/membre).
export function ClubHouseSectionsCard({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const [items, setItems] = useState<ClubHouseSectionSetting[] | null>(null); // null = chargement
  const [customized, setCustomized] = useState(false);
  const [dragKey, setDragKey] = useState<ClubHouseSectionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Vitesse d'auto-défilement du kiosque « À la une » : `speed` = secondes (3..20) mémorisées,
  // `manual` = true → pas de défilement auto (stocké 0). Persistance débouncée pour le curseur.
  const [speed, setSpeed] = useState(6);
  const [manual, setManual] = useState(false);
  const kioskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const club = await api.adminGetClub(clubId, token);
      setItems(fullSectionSettings(club.clubHouseSections));
      setCustomized(club.clubHouseSections != null);
      const s = club.clubHouseKioskSeconds ?? 6;
      setManual(s <= 0);
      setSpeed(s > 0 ? s : 6);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [clubId, token]);

  useEffect(() => { load(); }, [load]);

  const persistKiosk = (seconds: number) => {
    api.adminUpdateClub(clubId, { clubHouseKioskSeconds: seconds }, token).catch((e) => setError((e as Error).message));
  };
  // Curseur : maj optimiste + persistance débouncée (un seul PATCH en fin de glissement).
  const onSpeed = (v: number) => {
    setSpeed(v);
    if (kioskTimer.current) clearTimeout(kioskTimer.current);
    kioskTimer.current = setTimeout(() => persistKiosk(v), 350);
  };
  const onManual = (m: boolean) => {
    setManual(m);
    if (kioskTimer.current) clearTimeout(kioskTimer.current);
    persistKiosk(m ? 0 : speed);
  };

  // Persiste la liste complète (8 entrées) ; optimiste, recharge l'état serveur si échec.
  const persist = async (next: ClubHouseSectionSetting[]) => {
    setItems(next);
    setCustomized(true);
    try { setError(null); await api.adminUpdateClub(clubId, { clubHouseSections: next }, token); }
    catch (e) { setError((e as Error).message); await load(); }
  };

  if (!items) return null;

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(next);
  };

  const onDropRow = (targetKey: ClubHouseSectionKey) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    const next = [...items];
    const from = next.findIndex((r) => r.key === dragKey);
    const to = next.findIndex((r) => r.key === targetKey);
    setDragKey(null);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  };

  const toggle = (key: ClubHouseSectionKey) => {
    persist(items.map((r) => (r.key === key ? { ...r, visible: !r.visible } : r)));
  };

  const reset = async () => {
    setConfirmReset(false);
    try {
      setError(null);
      await api.adminUpdateClub(clubId, { clubHouseSections: null }, token);
      setItems(fullSectionSettings(null));
      setCustomized(false);
    } catch (e) { setError((e as Error).message); }
  };

  const defs = new Map<ClubHouseSectionKey, { label: string; hint?: string }>(
    SECTION_DEFS.map((d) => [d.key, d]),
  );
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1px solid ${th.line}`, background: th.bg };
  const arrowStyle = (disabled: boolean): CSSProperties => ({
    border: `1px solid ${th.line}`, background: 'transparent', cursor: disabled ? 'default' : 'pointer',
    borderRadius: 8, padding: '4px 9px', fontFamily: th.fontUI, fontSize: 12.5, color: disabled ? th.textFaint : th.text,
  });
  const toggleLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, cursor: 'pointer', whiteSpace: 'nowrap' };

  return (
    <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 4px', color: th.text }}>Sections du Club-house</h2>
      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '0 0 14px', lineHeight: 1.5 }}>
        Choisissez les sections affichées sur la page d’accueil et leur ordre (glissez, ou ↑↓).
        Le kiosque « À la une » (vos annonces) est toujours en tête de page.
        {!customized && ' Par défaut, l’ordre s’adapte automatiquement (visiteur / membre) ; dès que vous personnalisez, le même ordre s’applique à tous.'}
      </p>

      {/* Vitesse d'auto-défilement du kiosque « À la une ». */}
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>Défilement des annonces</span>
          <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: manual ? th.textMute : th.accent }}>
            {manual ? 'Manuel' : `${speed} s`}
          </span>
        </div>
        <input type="range" min={3} max={20} step={1} value={speed} disabled={manual}
          aria-label="Temps de pause entre deux annonces (secondes)"
          onChange={(e) => onSpeed(Number(e.target.value))}
          style={{ width: '100%', accentColor: th.accent, cursor: manual ? 'default' : 'pointer', opacity: manual ? 0.4 : 1 }} />
        <label style={{ ...toggleLabel, whiteSpace: 'normal' }}>
          <input type="checkbox" checked={manual} onChange={(e) => onManual(e.target.checked)} aria-label="Pas de défilement automatique" />
          Pas de défilement automatique (le visiteur navigue à la main)
        </label>
      </div>

      {error && <div style={{ marginBottom: 12, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((s, idx) => {
          const def = defs.get(s.key);
          return (
            <div key={s.key} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(s.key)}
              style={{ ...rowStyle, opacity: dragKey === s.key ? 0.4 : (s.visible ? 1 : 0.55) }}>
              <span draggable onDragStart={() => setDragKey(s.key)} onDragEnd={() => setDragKey(null)}
                title="Glisser pour réordonner" style={{ cursor: 'grab', display: 'flex' }}>
                <Icon name="grip" size={18} color={th.textFaint} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>{def?.label}</div>
                {def?.hint && <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{def.hint}</div>}
              </div>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Monter ${def?.label}`} style={arrowStyle(idx === 0)}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Descendre ${def?.label}`} style={arrowStyle(idx === items.length - 1)}>↓</button>
              <label style={toggleLabel}>
                <input type="checkbox" checked={s.visible} onChange={() => toggle(s.key)} aria-label={`Afficher ${def?.label}`} />
                Afficher
              </label>
            </div>
          );
        })}
      </div>
      {customized && (
        <button onClick={() => setConfirmReset(true)}
          style={{ marginTop: 12, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.accent, padding: 0 }}>
          Réinitialiser l’ordre par défaut
        </button>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Réinitialiser les sections ?"
          message="La page retrouvera l’ordre automatique (adapté visiteur / membre) avec toutes les sections affichées."
          confirmLabel="Réinitialiser"
          cancelLabel="Retour"
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
