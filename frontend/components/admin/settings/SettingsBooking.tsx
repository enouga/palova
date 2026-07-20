'use client';
import type { ClubAdminDetail } from '@/lib/api';
import { Segmented } from '@/components/ui/atoms';
import { CANCEL_PRESETS } from '@/lib/onboarding';
import { DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER, BOOKING_RELEASE_MODE_HELP } from '@/lib/adminSettings';
import { PresetChips } from './PresetChips';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { SettingsTabProps, useSettingsStyles } from './shared';

const CANCEL_HOURS = CANCEL_PRESETS.map((p) => p.hours);              // [0, 4, 24]
const cancelLabel = (n: number) => CANCEL_PRESETS.find((p) => p.hours === n)?.label ?? `${n} h avant`;

export function SettingsBooking({ club, set }: SettingsTabProps) {
  const { th, card, label, field, h2, hint } = useSettingsStyles();
  const rolling = club.bookingReleaseMode === 'ROLLING_SLOT';
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Réservation à l&apos;avance</h2>
        <p style={hint}>Jusqu&apos;à combien de jours à l&apos;avance vos joueurs peuvent réserver. Les abonnés profitent d&apos;une fenêtre élargie.</p>
        <span style={label}>Fenêtre publique (jours)</span>
        <PresetChips presets={DAY_PRESETS_PUBLIC} value={club.publicBookingDays} unit="jours" min={0} max={365}
          onChange={(v) => set('publicBookingDays', v)} />
        <span style={{ ...label, marginTop: 18 }}>Fenêtre abonnés (jours)</span>
        <PresetChips presets={DAY_PRESETS_MEMBER} value={club.memberBookingDays} unit="jours" min={0} max={365}
          onChange={(v) => set('memberBookingDays', v)} />

        <div style={{ marginTop: 18 }}>
          <span style={label}>Ouverture des nouvelles réservations</span>
          <Segmented
            options={[
              { value: 'DAY_AT_HOUR', label: 'Journée à heure fixe' },
              { value: 'ROLLING_SLOT', label: 'Au fil de l’eau' },
              { value: 'WINDOW_SHIFT', label: 'Fenêtre glissante' },
            ]}
            value={club.bookingReleaseMode}
            onChange={(v) => set('bookingReleaseMode', v as ClubAdminDetail['bookingReleaseMode'])}
          />
          <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '8px 0 0' }}>
            {BOOKING_RELEASE_MODE_HELP[club.bookingReleaseMode]}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, opacity: rolling ? 0.4 : 1 }}>
          <div style={{ flex: 1 }}>
            <span style={label}>Heure publique (0-23)</span>
            <input type="number" min={0} max={23} disabled={rolling}
              value={club.publicReleaseHour} onChange={(e) => set('publicReleaseHour', Number(e.target.value))} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={label}>Heure abonnés (0-23)</span>
            <input type="number" min={0} max={23} disabled={rolling}
              value={club.memberReleaseHour} onChange={(e) => set('memberReleaseHour', Number(e.target.value))} style={field} />
          </div>
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Délais (annulation & changement de joueurs)</h2>
        <p style={hint}>Au-delà de ce délai avant le début, le joueur ne peut plus annuler / modifier les joueurs de sa partie.</p>
        <span style={label}>Annulation</span>
        <PresetChips presets={CANCEL_HOURS} value={club.cancellationCutoffHours} format={cancelLabel} min={0} max={365}
          onChange={(v) => set('cancellationCutoffHours', v)} />
        <span style={{ ...label, marginTop: 18 }}>Changement de joueurs</span>
        <PresetChips presets={CANCEL_HOURS} value={club.playerChangeCutoffHours} format={cancelLabel} min={0} max={365}
          onChange={(v) => set('playerChangeCutoffHours', v)} />
        <div style={{ marginTop: 16 }}>
          <SwitchRow
            checked={club.refundOnCancelWithinCutoff}
            onChange={(v) => set('refundOnCancelWithinCutoff', v)}
            title="Rembourser automatiquement en cas d’annulation dans les délais"
            description="Le joueur est remboursé (recrédit du carnet / porte-monnaie si prépayé) lorsqu’il annule avant le délai."
          />
        </div>
      </div>
    </>
  );
}
