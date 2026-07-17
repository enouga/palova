// Styles et types partagés des onglets du profil. Miroir de components/admin/settings/shared.ts.
import { CSSProperties } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { cardStyle } from '@/components/clubhouse/SectionHeader';

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
  // Surface + ombre du Club-house ; padding/layout restent locaux (cardStyle ne les porte pas).
  const card: CSSProperties = {
    ...cardStyle(th),
    padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14,
  };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute };
  const primaryBtn = (busy: boolean): CSSProperties => ({
    cursor: 'pointer', border: 'none', background: th.accent, color: th.onAccent, borderRadius: 11,
    padding: '10px 18px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5,
    opacity: busy ? 0.6 : 1, alignSelf: 'flex-start',
  });
  return { th, card, label, primaryBtn };
}
