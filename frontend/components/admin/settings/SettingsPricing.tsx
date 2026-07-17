'use client';
import { Segmented } from '@/components/ui/atoms';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { OffPeakEditor } from './OffPeakEditor';
import { SettingsTabProps, useSettingsStyles } from './shared';
import type { BookingQuotas } from '@/lib/api';

const EMPTY_QUOTAS: BookingQuotas = {
  model: 'UPCOMING',
  subscriber: { peak: null, offPeak: null },
  nonSubscriber: { peak: null, offPeak: null },
};

export function SettingsPricing({ club, set }: SettingsTabProps) {
  const { th, card, label, field, h2, hint } = useSettingsStyles();
  const quotas = club.bookingQuotas ?? null;

  const setQuotaLimit = (who: 'subscriber' | 'nonSubscriber', kind: 'peak' | 'offPeak', raw: string) => {
    if (!quotas) return;
    const v = raw === '' ? null : Math.max(0, Math.min(999, Math.trunc(Number(raw))));
    set('bookingQuotas', { ...quotas, [who]: { ...quotas[who], [kind]: v } });
  };

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Heures pleines / creuses</h2>
        <p style={hint}>Ajoutez des plages d&apos;<strong>heures creuses</strong> (tarif réduit) jour par jour. Le reste de la journée est en heures pleines. Le tarif creux se règle par terrain dans <strong>Ressources</strong>.</p>
        <OffPeakEditor value={club.offPeakHours} onChange={(v) => set('offPeakHours', v)} />
      </div>

      <div style={card}>
        <h2 style={h2}>Quotas de réservation</h2>
        <p style={hint}>Limitez le nombre de réservations de terrain par joueur, en heures pleines et creuses, avec des limites différentes pour les abonnés. Vide = illimité, 0 = bloqué.</p>
        <SwitchRow
          checked={!!quotas}
          onChange={(on) => set('bookingQuotas', on ? EMPTY_QUOTAS : null)}
          title="Limiter les réservations par joueur"
        />
        {quotas && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            <div>
              <span style={label}>Période de comptage</span>
              <Segmented
                options={[{ value: 'UPCOMING', label: 'À venir simultanées' }, { value: 'WEEKLY', label: 'Par semaine' }]}
                value={quotas.model}
                onChange={(v) => set('bookingQuotas', { ...quotas, model: v as BookingQuotas['model'] })}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 10, alignItems: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <span />
              <span style={{ ...label, marginBottom: 0 }}>Heures pleines</span>
              <span style={{ ...label, marginBottom: 0 }}>Heures creuses</span>
              {(['nonSubscriber', 'subscriber'] as const).map((who) => (
                <span key={`${who}-row`} style={{ display: 'contents' }}>
                  <span>{who === 'subscriber' ? 'Abonnés' : 'Non-abonnés'}</span>
                  <input type="number" min={0} max={999} placeholder="illimité" value={quotas[who].peak ?? ''}
                    onChange={(e) => setQuotaLimit(who, 'peak', e.target.value)} style={field} />
                  <input type="number" min={0} max={999} placeholder="illimité" value={quotas[who].offPeak ?? ''}
                    onChange={(e) => setQuotaLimit(who, 'offPeak', e.target.value)} style={field} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
