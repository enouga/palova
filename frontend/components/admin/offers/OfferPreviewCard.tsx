'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export interface OfferPreview {
  kindLabel: string;        // « Abonnement » / « Carnet » / « Porte-monnaie »
  tint: string;             // accent hex
  name: string;
  price: string;            // « 49 € »
  priceSuffix: string | null; // « /mois » | null
  lines: string[];          // caractéristiques (sports, créneaux, avantage, validité…)
  description: string;
  ctaLabel: string;         // « Souscrire · 49 € »
  imageUrl: string | null;  // object URL (aperçu local) ou asset URL
}

/** Carte « ce que verront vos joueurs » — miroir statique de OffersShowcase. */
export function OfferPreviewCard({ preview }: { preview: OfferPreview }) {
  const { th } = useTheme();
  const { kindLabel, tint, name, price, priceSuffix, lines, description, ctaLabel, imageUrl } = preview;
  const card: CSSProperties = {
    background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    width: 236, overflow: 'hidden', position: 'relative',
    padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4,
  };
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" style={{ position: 'relative', display: 'block', width: '100%', height: 'auto', maxHeight: 120, objectFit: 'cover', borderRadius: 10, marginBottom: 4 }} />
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${tint}26` : `${tint}40`, color: th.mode === 'floodlit' ? tint : th.ink }}>
          {kindLabel}
        </span>
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginTop: 6 }}>{name || 'Sans nom'}</div>
      <div style={{ position: 'relative', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: th.text }}>
        <span>{price}</span>{priceSuffix && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {priceSuffix}</span>}
      </div>
      {lines.length > 0 && (
        <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.55 }}>{lines.join(' · ')}</div>
      )}
      {description && (
        <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{description}</div>
      )}
      <div style={{ position: 'relative', marginTop: 10, border: `1.5px solid ${tint}`, textAlign: 'center', color: th.mode === 'floodlit' ? tint : th.ink, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
        {ctaLabel}
      </div>
    </div>
  );
}
