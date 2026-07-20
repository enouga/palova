'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Promotion } from '@/lib/api';
import { promoStatus, discountLabel, windowLabel, targetLabel } from '@/lib/adminPromotions';

export interface PromotionCardProps {
  promo: Promotion;
  totalCourts: number;
  faded?: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

/** Petit rond de date « DD/MM/YYYY » sans passer par Date (aucun décalage de fuseau). */
function frLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function PromotionCard(props: PromotionCardProps) {
  const { th } = useTheme();
  const { promo, totalCourts, faded, busy, onEdit, onToggleEnabled, onDelete } = props;
  const status = promoStatus(promo, Date.now());
  const tint = status === 'running' ? ACCENTS.emerald : status === 'upcoming' ? th.accentWarm : th.textFaint;

  const card: CSSProperties = {
    position: 'relative', overflow: 'hidden', background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    display: 'flex', flexDirection: 'column', opacity: faded ? 0.6 : promo.enabled ? 1 : 0.7,
  };
  const mini: CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9,
    padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
  };
  const window = windowLabel(promo);

  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: tint }} />
      <div style={{ position: 'relative', padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 15, letterSpacing: -0.2, color: th.text }}>{promo.name}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
          {frLabel(promo.startDate)} → {frLabel(promo.endDate)}
        </div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, letterSpacing: -1, color: th.text, marginTop: 4 }}>
          {discountLabel(promo)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, background: th.surface2, borderRadius: 999, padding: '3px 9px' }}>
            {targetLabel(promo, totalCourts)}
          </span>
          {window && (
            <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, background: th.surface2, borderRadius: 999, padding: '3px 9px' }}>
              {window}
            </span>
          )}
        </div>
      </div>
      <div style={{ position: 'relative', borderTop: `1px solid ${th.line}`, padding: '9px 15px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" role="switch" aria-checked={promo.enabled} aria-label={promo.enabled ? 'Désactiver la promotion' : 'Activer la promotion'}
          disabled={busy} onClick={onToggleEnabled}
          style={{ width: 36, height: 21, borderRadius: 999, border: 'none', cursor: 'pointer', background: promo.enabled ? th.accent : th.lineStrong, position: 'relative', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 2.5, left: promo.enabled ? 17 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.textMute, marginRight: 'auto' }}>
          {promo.enabled ? 'Activée' : 'Désactivée'}
        </span>
        <button type="button" onClick={onEdit} disabled={busy} style={mini}>Modifier</button>
        <button type="button" onClick={onDelete} disabled={busy} style={{ ...mini, color: '#ff7a4d' }}>Supprimer</button>
      </div>
    </div>
  );
}
