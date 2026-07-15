import { CSSProperties } from 'react';
import type { ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

/** Setter typé d'un champ du brouillon (fourni par la page orchestratrice). */
export type SetClubField = <K extends keyof ClubAdminDetail>(k: K, v: ClubAdminDetail[K]) => void;

/** Props communes à tous les composants d'onglet. */
export interface SettingsTabProps {
  club: ClubAdminDetail;
  set: SetClubField;
}

/** Styles partagés (carte, label, champ, titre de section). Hook car dépend du thème. */
export function useSettingsStyles() {
  const { th } = useTheme();
  const card: CSSProperties = { background: th.surface, borderRadius: 18, padding: 22, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute, display: 'block', marginBottom: 7 };
  const field: CSSProperties = { width: '100%', height: 48, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const h2: CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 6px', color: th.text };
  const hint: CSSProperties = { fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 16px' };
  return { th, card, label, field, h2, hint };
}
