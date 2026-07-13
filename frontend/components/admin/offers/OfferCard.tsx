'use client';
import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';

export interface OfferCardProps {
  tint: string;
  kindLabel: string;      // « Abonnement » / « Carnet » / « Porte-monnaie »
  name: string;
  price: string;          // « 49 € »
  priceSuffix: string | null; // « /mois · 12 mois » | « · 10 entrées » | …
  features: string;       // ligne de caractéristiques (déjà jointe au « · »)
  pulse: ReactNode;       // ligne de pouls (string ou bouton)
  isActive: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}

export function OfferCard(props: OfferCardProps) {
  const { th } = useTheme();
  const { tint, kindLabel, name, price, priceSuffix, features, pulse, isActive, busy, onEdit, onToggleActive } = props;
  const card: CSSProperties = {
    position: 'relative', overflow: 'hidden', background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    display: 'flex', flexDirection: 'column', opacity: isActive ? 1 : 0.55,
  };
  const mini: CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9,
    padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
  };
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: isActive ? tint : th.textFaint }} />
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 52, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '20' : '2e'}, transparent)`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ alignSelf: 'flex-start', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${tint}26` : `${tint}40`, color: th.mode === 'floodlit' ? tint : th.ink }}>
          {kindLabel}
        </span>
        <div style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 15, letterSpacing: -0.2, color: th.text, marginTop: 6 }}>{name}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, letterSpacing: -1, color: th.text }}>
          <span>{price}</span>{priceSuffix && <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {priceSuffix}</span>}
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, lineHeight: 1.45, marginTop: 2 }}>{features}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: isActive ? tint : th.textMute, marginTop: 8 }}>{pulse}</div>
      </div>
      <div style={{ position: 'relative', borderTop: `1px solid ${th.line}`, padding: '9px 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: isActive ? ACCENTS.emerald : th.textFaint }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.textMute, marginRight: 'auto' }}>{isActive ? 'En vente' : 'Retirée de la vente'}</span>
        <button type="button" onClick={onEdit} disabled={busy} style={mini}>Modifier</button>
        <button type="button" onClick={onToggleActive} disabled={busy} style={{ ...mini, color: isActive ? '#ff7a4d' : th.text }}>
          {isActive ? 'Retirer' : 'Remettre en vente'}
        </button>
      </div>
    </div>
  );
}
