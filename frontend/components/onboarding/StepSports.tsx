'use client';
import { useState } from 'react';
import { api, AdminClubSport, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { WIZ, WizHeader, WizError, WizActions } from './wizardUi';

export function StepSports({ clubName, catalog, clubSports, clubId, token, onAdded, advance }: {
  clubName: string;
  catalog: Sport[];
  clubSports: AdminClubSport[];
  clubId: string;
  token: string;
  onAdded: (cs: AdminClubSport) => void;
  advance: () => void;
}) {
  const { th } = useTheme();
  const activeIds = new Set(clubSports.map((cs) => cs.sport.id));
  const [selected, setSelected] = useState<Set<string>>(new Set(activeIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Étape volontairement sobre : pill active = blanc plein, lisible quel que soit l'accent
  // (les chips sports de l'aperçu portent déjà la couleur du club).

  const toggle = (id: string) => {
    if (activeIds.has(id)) return; // déjà actif : non décochable (pas de retrait de sport dans le wizard)
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Séquentiel : en cas d'échec au milieu, les sports déjà ajoutés ont été propagés
      // via onAdded → au retry, activeIds (recalculé au re-render) les exclut.
      for (const id of selected) {
        if (activeIds.has(id)) continue;
        const cs = await api.adminAddSport(clubId, id, token);
        onAdded(cs);
      }
      advance();
    } catch { setError('Impossible d’ajouter un sport. Réessayez.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <WizHeader accent="#ffffff" surtitle={`Vos sports · ${clubName}`}
        title={<>Que joue-t-on<br />chez vous ?</>}
        sub="Cochez tout ce que votre club propose. Vous pourrez en ajouter d’autres plus tard." />

      {error && <WizError>{error}</WizError>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Sports proposés">
        {catalog.map((s) => {
          const isActive = activeIds.has(s.id);
          const isOn = selected.has(s.id);
          return (
            <button key={s.id} type="button" role="checkbox" aria-checked={isOn} disabled={isActive}
              aria-label={`${s.name}${isActive ? ' (déjà actif)' : ''}`}
              onClick={() => toggle(s.id)}
              style={{
                borderRadius: 20, padding: '9px 18px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
                cursor: isActive ? 'default' : 'pointer',
                background: isOn ? '#ffffff' : WIZ.card,
                color: isOn ? inkOn('#ffffff') : WIZ.mute,
                border: `1px solid ${isOn ? '#ffffff' : WIZ.line}`,
                opacity: isActive ? 0.85 : 1,
              }}>
              {s.icon ? `${s.icon} ` : ''}{s.name}{isOn ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      <WizActions accent="#ffffff" busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
