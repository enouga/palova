'use client';
import type { Sport } from '@/lib/api';
import type { SportDraftRow } from '@/lib/adminSports';
import { durationLabel, proposableDurations } from '@/lib/duration';
import { useSettingsStyles } from './shared';

// Onglet « Sports » des Réglages. Composant contrôlé : la page détient le brouillon
// (comme les 5 autres onglets) et persiste tout via la barre « Enregistrer ».
export function SettingsSports({ rows, catalog, onAdd, onToggleDuration }: {
  rows: SportDraftRow[];
  catalog: Sport[];
  onAdd: (sport: Sport) => void;
  onToggleDuration: (sportId: string, min: number) => void;
}) {
  const { th, card, h2, hint } = useSettingsStyles();

  const enabledIds = new Set(rows.map((r) => r.sportId));
  const available = catalog.filter((s) => !enabledIds.has(s.id));

  return (
    <>
      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 14 }}>Proposés par le club</h2>
        {rows.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>Aucun sport activé pour l&apos;instant.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {rows.map((r) => (
              <div key={r.sportId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text, minWidth: 110 }}>{r.name}</span>
                {r.clubSportId === null && (
                  // Sport ajouté au brouillon : rien n'est créé tant qu'on n'a pas enregistré.
                  <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.accent, border: `1px solid ${th.accent}`, borderRadius: 999, padding: '2px 8px' }}>
                    À enregistrer
                  </span>
                )}
                <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Durées proposées :</span>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {proposableDurations(r.defaultDurationsMin).map((m) => {
                    const on = r.durationsMin.includes(m);
                    return (
                      <button key={m} onClick={() => onToggleDuration(r.sportId, m)} aria-pressed={on}
                        style={{ border: on ? 'none' : `1px solid ${th.line}`, cursor: 'pointer', borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, background: on ? th.accent : 'transparent', color: on ? th.onAccent : th.textMute }}>
                        {durationLabel(m)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
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
              <button key={s.id} onClick={() => onAdd(s)}
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
