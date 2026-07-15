'use client';
import { QUICK_METHODS, QUICK_METHOD_LABEL } from '@/lib/caisse';
import type { PaymentMethod } from '@/lib/api';
import { SwitchRow } from './SwitchRow';
import { SettingsTabProps, useSettingsStyles } from './shared';

export function SettingsCollect({ club, set }: SettingsTabProps) {
  const { th, card, h2, hint } = useSettingsStyles();
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Moyens d&apos;encaissement rapides</h2>
        <p style={hint}>Choisissez les moyens proposés en <strong>1 clic</strong> sur chaque ligne joueur de la page <strong>Paiements</strong>. Les autres moyens restent accessibles via « Détails ».</p>

        <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${th.line}` }}>
          <SwitchRow
            checked={!!club.payAtClubOnly}
            onChange={(v) => set('payAtClubOnly', v)}
            title="Paiement au club — encaissement en un clic"
            description="À l’encaissement, un seul bouton « Encaissé » au lieu du choix du moyen. Le paiement est enregistré (il compte dans le chiffre d’affaires) sous le libellé neutre « Au club ». Les moyens rapides ci-dessous sont alors masqués."
          />
        </div>

        {!club.payAtClubOnly && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {QUICK_METHODS.map((m) => {
              const checked = (club.quickPaymentMethods ?? []).includes(m);
              return (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...(club.quickPaymentMethods ?? []), m]
                        : (club.quickPaymentMethods ?? []).filter((x) => x !== m);
                      set('quickPaymentMethods', QUICK_METHODS.filter((x) => next.includes(x)) as PaymentMethod[]);
                    }}
                    style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
                  <span style={{ fontFamily: th.fontUI, fontSize: 15, color: th.text }}>{QUICK_METHOD_LABEL[m]}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>Paiement en ligne</h2>
        <p style={hint}>La connexion Stripe et les réglages de paiement CB ont leur page dédiée.</p>
        <a href="/admin/payments" style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.accent }}>
          Gérer le paiement en ligne →
        </a>
      </div>
    </>
  );
}
