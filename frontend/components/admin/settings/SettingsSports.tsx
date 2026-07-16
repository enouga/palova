'use client';
import { useSettingsStyles } from './shared';
import { durationLabel, effectiveDurations, proposableDurations } from '@/lib/duration';
import { SportsDraftItem } from '@/lib/adminSettings';

/** Sous-ensemble du catalogue plateforme dont ce composant a besoin. */
export interface SportsCatalogEntry {
  id: string;
  name: string;
  icon: string | null;
  defaultDurationsMin: number[];
}

interface Props {
  catalog: SportsCatalogEntry[];
  items: SportsDraftItem[];
  onAdd: (sportId: string) => void;
  onToggleDuration: (sportId: string, min: number) => void;
}

// Onglet « Sports » des Réglages. Composant CONTRÔLÉ : la page orchestratrice
// (app/admin/settings/page.tsx) possède le brouillon et l'enregistrement différé (SaveBar) —
// ce composant n'appelle jamais l'API lui-même (avant le 2026-07-16 : enregistrement immédiat).
export function SettingsSports({ catalog, items, onAdd, onToggleDuration }: Props) {
  const { th, card, h2, hint } = useSettingsStyles();
  const bySportId = new Map(catalog.map((s) => [s.id, s]));
  const enabledIds = new Set(items.map((i) => i.sportId));
  const available = catalog.filter((s) => !enabledIds.has(s.id));

  return (
    <>
      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 14 }}>Proposés par le club</h2>
        {items.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>Aucun sport activé pour l&apos;instant.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {items.map((item) => {
              const sport = bySportId.get(item.sportId);
              if (!sport) return null;
              const eff = effectiveDurations(item.durationsMin, sport.defaultDurationsMin);
              return (
                <div key={item.sportId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text, minWidth: 110 }}>{sport.name}</span>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Durées proposées :</span>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {proposableDurations(sport.defaultDurationsMin).map((m) => {
                      const on = eff.includes(m);
                      return (
                        <button key={m} onClick={() => onToggleDuration(item.sportId, m)}
                          style={{ border: on ? 'none' : `1px solid ${th.line}`, cursor: 'pointer', borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, background: on ? th.accent : 'transparent', color: on ? th.onAccent : th.textMute }}>
                          {durationLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>Ajouter un sport</h2>
        <p style={hint}>Depuis le catalogue de la plateforme.</p>
        {available.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>Tous les sports du catalogue sont déjà activés.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {available.map((s) => (
              <button key={s.id} onClick={() => onAdd(s.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px dashed ${th.lineStrong}`, background: 'transparent', cursor: 'pointer', borderRadius: 12, padding: '9px 14px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
                {s.icon ? `${s.icon} ` : ''}{s.name}
                <span style={{ color: th.accent, fontWeight: 700 }}>+</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
