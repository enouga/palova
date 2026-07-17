import sharp from 'sharp';
import { reencodeImage } from '../imagePipeline';

describe('reencodeImage', () => {
  it('détecte le format RÉEL via sharp (mimetype client ignoré), plafonne les dimensions, retire l’EXIF', async () => {
    const bigPng = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 200, b: 30 } } })
      .withMetadata({ exif: { IFD0: { Make: 'TestCam' } } })
      .png().toBuffer();

    const out = await reencodeImage(bigPng);

    expect(out.ext).toBe('png');
    expect(out.width).toBeLessThanOrEqual(2048);
    expect(out.height).toBeLessThanOrEqual(2048);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('ne redimensionne jamais à la hausse une petite image', async () => {
    const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const out = await reencodeImage(small);
    expect(out.width).toBe(100);
    expect(out.height).toBe(80);
  });

  it('respecte un plafond de dimensions personnalisé', async () => {
    const img = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const out = await reencodeImage(img, 512);
    expect(out.width).toBeLessThanOrEqual(512);
    expect(out.height).toBeLessThanOrEqual(512);
  });

  it('conserve le format jpeg/webp d’origine (ne force pas tout en PNG)', async () => {
    const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 5, g: 5, b: 5 } } }).webp().toBuffer();
    expect((await reencodeImage(jpeg)).ext).toBe('jpg');
    expect((await reencodeImage(webp)).ext).toBe('webp');
  });

  it('fichier corrompu → VALIDATION_ERROR', async () => {
    await expect(reencodeImage(Buffer.from('pas une image'))).rejects.toThrow('VALIDATION_ERROR');
  });

  it('format non supporté (gif) → VALIDATION_ERROR', async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 1, b: 1 } } }).gif().toBuffer();
    await expect(reencodeImage(gif)).rejects.toThrow('VALIDATION_ERROR');
  });
});
