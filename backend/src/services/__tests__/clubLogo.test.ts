import sharp from 'sharp';
import { processClubLogo } from '../clubLogo';

async function png(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
}

describe('processClubLogo', () => {
  it('rejette un buffer non-image', async () => {
    await expect(processClubLogo(Buffer.from('nope'), 'icon')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('icône : carrée ≥512 → aucun warning, sortie PNG plafonnée à 1024', async () => {
    const out = await processClubLogo(await png(2000, 2000), 'icon');
    expect(out.warnings).toEqual([]);
    expect(out.width).toBe(1024);
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
  });

  it('icône non carrée + trop petite → NOT_SQUARE et TOO_SMALL', async () => {
    const out = await processClubLogo(await png(300, 120), 'icon');
    expect(out.warnings).toEqual(expect.arrayContaining(['NOT_SQUARE', 'TOO_SMALL']));
  });

  it('logotype carré → LOOKS_SQUARE', async () => {
    const out = await processClubLogo(await png(400, 400), 'wide');
    expect(out.warnings).toContain('LOOKS_SQUARE');
  });

  it('logotype trop bas → TOO_SMALL, plafonné à 320 de haut', async () => {
    const out = await processClubLogo(await png(1200, 100), 'wide');
    expect(out.warnings).toContain('TOO_SMALL');
    expect(out.height).toBeLessThanOrEqual(320);
  });

  it('accepte le JPEG (format réel, pas le mimetype)', async () => {
    const jpeg = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const out = await processClubLogo(jpeg, 'wide');
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
  });
});
