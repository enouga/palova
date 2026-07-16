import type { ThemeMode } from './theme';

// Règle de repli unique des logos (miroir de la spec) : logoUrl = icône carrée ;
// logotype clair = wide ?? icon ; logotype sombre = dark ?? wide ?? icon.

export type LogoWarning = 'NOT_SQUARE' | 'TOO_SMALL' | 'LOOKS_SQUARE';
export type LogoKind = 'icon' | 'wide' | 'wideDark';

interface ClubLogos {
  logoUrl: string | null;
  logoWideUrl: string | null;
  logoWideDarkUrl: string | null;
}

export function iconLogo(club: ClubLogos): string | null {
  return club.logoUrl;
}

export function wideLogo(club: ClubLogos, mode: ThemeMode): string | null {
  if (mode === 'floodlit') return club.logoWideDarkUrl ?? club.logoWideUrl ?? club.logoUrl;
  return club.logoWideUrl ?? club.logoUrl;
}

export const LOGO_WARNING_LABEL: Record<LogoWarning, string> = {
  NOT_SQUARE: "Votre image n'est pas carrée — elle sera affichée dans un carré.",
  TOO_SMALL: 'Image un peu petite : elle risque d’être floue sur les grands écrans.',
  LOOKS_SQUARE: 'Cette image semble carrée — utilisez plutôt l’emplacement « Icône ».',
};

// Miroir client des seuils serveur (processClubLogo) pour l'alerte persistante sur l'icône en place.
export function clientRatioWarning(w: number, h: number, kind: LogoKind): LogoWarning | null {
  if (!w || !h) return null;
  if (kind === 'icon') {
    if (Math.max(w, h) / Math.min(w, h) > 1.05) return 'NOT_SQUARE';
    if (Math.min(w, h) < 512) return 'TOO_SMALL';
    return null;
  }
  if (h < 160) return 'TOO_SMALL';
  if (w / h < 1.5) return 'LOOKS_SQUARE';
  return null;
}
