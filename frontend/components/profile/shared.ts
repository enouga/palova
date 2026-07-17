// Styles et types partagés des onglets du profil. Miroir de components/admin/settings/shared.ts.
import { CSSProperties } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

/** Setter typé d'un champ du brouillon (fourni par la page orchestratrice). */
export type SetProfileField = <K extends keyof MyProfile>(k: K, v: MyProfile[K]) => void;

/** Props communes aux onglets porteurs du brouillon. */
export interface ProfileTabProps {
  profile: MyProfile;
  set: SetProfileField;
}

/** Styles partagés (carte, titre, label, champ, bouton). Hook car dépend du thème. */
export function useProfileStyles() {
  const { th } = useTheme();
  // Ombre douce (même recette que cardStyle() du Club-house) — fini le liseré inset gris.
  const card: CSSProperties = {
    background: th.surface, borderRadius: 18,
    boxShadow: th.mode === 'floodlit'
      ? `0 14px 34px rgba(0,0,0,0.42), inset 0 0 0 1px ${th.line}`
      : '0 14px 34px rgba(24,21,16,0.08), 0 1px 2px rgba(24,21,16,0.05)',
    padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14,
  };
  const cardTitle: CSSProperties = {
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
    textTransform: 'uppercase', color: th.textFaint,
  };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute };
  const input: CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`,
    borderRadius: 11, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text,
  };
  const primaryBtn = (busy: boolean): CSSProperties => ({
    cursor: 'pointer', border: 'none', background: th.accent, color: th.onAccent, borderRadius: 11,
    padding: '10px 18px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5,
    opacity: busy ? 0.6 : 1, alignSelf: 'flex-start',
  });
  return { th, card, cardTitle, label, input, primaryBtn };
}
