import sharp from 'sharp';

// Ré-encodage d'un logo de club uploadé (pattern photos DM) : format réel détecté par sharp
// (le mimetype client n'est plus source de vérité), rotation EXIF appliquée puis métadonnées
// retirées (défaut sharp), redimensionnement plafonné, sortie PNG (transparence + Outlook).

export type LogoKind = 'icon' | 'wide' | 'wideDark';
export type LogoWarning = 'NOT_SQUARE' | 'TOO_SMALL' | 'LOOKS_SQUARE';

export interface ProcessedLogo {
  png: Buffer;
  width: number;
  height: number;
  warnings: LogoWarning[];
}

const CAPS: Record<'icon' | 'wide', [number, number]> = {
  icon: [1024, 1024],
  wide: [1600, 320],
};

export async function processClubLogo(buffer: Buffer, kind: LogoKind): Promise<ProcessedLogo> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp') {
    throw new Error('VALIDATION_ERROR');
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error('VALIDATION_ERROR');

  const warnings: LogoWarning[] = [];
  if (kind === 'icon') {
    if (Math.max(w, h) / Math.min(w, h) > 1.05) warnings.push('NOT_SQUARE');
    if (Math.min(w, h) < 512) warnings.push('TOO_SMALL');
  } else {
    if (h < 160) warnings.push('TOO_SMALL');
    if (w / h < 1.5) warnings.push('LOOKS_SQUARE');
  }

  const [maxW, maxH] = kind === 'icon' ? CAPS.icon : CAPS.wide;
  let png: Buffer;
  try {
    png = await sharp(buffer)
      .rotate() // oriente selon EXIF puis .png() retire les métadonnées
      .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  const out = await sharp(png).metadata();
  return { png, width: out.width ?? 0, height: out.height ?? 0, warnings };
}
