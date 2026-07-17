import sharp from 'sharp';

// Ré-encodage d'une image uploadée par un utilisateur (pattern posé pour les photos de
// messagerie privée, généralisé aux avatars/logos/couvertures/affiches — audit pré-MEP §2.3) :
// le mimetype déclaré par le CLIENT n'est jamais source de vérité (sharp détecte le format
// réel), l'orientation EXIF est appliquée puis les métadonnées (EXIF/GPS/ICC) sont retirées
// par le ré-encodage lui-même, et les dimensions sont plafonnées sans jamais agrandir.

export type ImageExt = 'jpg' | 'png' | 'webp';

export interface ReencodedImage {
  buffer: Buffer;
  ext: ImageExt;
  width: number;
  height: number;
}

/** Fichier corrompu ou format non supporté (autre que JPEG/PNG/WebP) → VALIDATION_ERROR. */
export async function reencodeImage(input: Buffer, maxDim = 2048, quality = 82): Promise<ReencodedImage> {
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw new Error('VALIDATION_ERROR');

  const resized = sharp(input).rotate().resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  let buffer: Buffer;
  try {
    buffer = format === 'jpeg' ? await resized.jpeg({ quality }).toBuffer()
      : format === 'webp' ? await resized.webp({ quality }).toBuffer()
      : await resized.png().toBuffer();
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  const ext: ImageExt = format === 'jpeg' ? 'jpg' : format;
  const out = await sharp(buffer).metadata();
  return { buffer, ext, width: out.width ?? 0, height: out.height ?? 0 };
}
