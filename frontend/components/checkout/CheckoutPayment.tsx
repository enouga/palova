'use client';
import { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { api, Reservation, MemberPackage, Subscription } from '@/lib/api';
import { packageLabel, canCover, remainingAfterLabel } from '@/lib/packages';
import { coverageLabel } from '@/lib/subscriptions';
import { rememberCgvAccepted } from '@/lib/cgv';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { Icon, IconName } from '@/components/ui/Icon';

const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });

export interface CheckoutPaymentProps {
  cover: Subscription | null;
  useSub: boolean;
  setUseSub: (v: boolean) => void;
  payMode: 'club' | 'online';
  setPayMode: (m: 'club' | 'online') => void;
  paySource: string | null;
  setPaySource: (id: string | null) => void;
  packages: MemberPackage[];
  requireOnlinePayment?: boolean;
  requireCardFingerprint?: boolean;
  onlineAvailable: boolean;
  onlineRequiredButUnavailable: boolean;
  onlineShare: boolean;
  perPerson: string;
  totalPrice: string;
  capacity: number;
  totalEuros: number;
  cardPath: boolean;
  cgvAccepted: boolean;
  setCgvAccepted: (v: boolean) => void;
  cgvStatus: 'published' | 'fallback' | null;
  slug?: string;
  reservation: Reservation | null;
  token: string;
  createStripeIntent: () => Promise<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null }>;
  stripeType: 'payment' | 'setup';
  stripeAmountLabel: string;
  persistHoldSetup: () => Promise<void>;
  handleStripeSuccess: (r: Reservation) => void;
  onExit: () => void;
  errorMsg: string;
}

/**
 * Bloc « Mode de paiement » — port fidèle de BookingModal (lignes 615-707 : avenues
 * abonnement / club / en ligne / carnets) + bandeau d'erreur (712-714) + pied CGV/Stripe
 * du chemin carte (718-764). Le pied « Abandonner / Confirmer » du chemin non-carte
 * vit dans `CheckoutFooter`.
 */
export function CheckoutPayment({
  cover, useSub, setUseSub, payMode, setPayMode, paySource, setPaySource, packages,
  requireOnlinePayment, requireCardFingerprint,
  onlineAvailable, onlineRequiredButUnavailable, onlineShare,
  perPerson, totalPrice, capacity, totalEuros,
  cardPath, cgvAccepted, setCgvAccepted, cgvStatus,
  slug, reservation, token,
  createStripeIntent, stripeType, stripeAmountLabel,
  persistHoldSetup, handleStripeSuccess, onExit, errorMsg,
}: CheckoutPaymentProps) {
  const { th } = useTheme();

  // ── Briques de présentation (copies des helpers BookingModal, closure sur `th`) ──
  const sectionLabel = (icon: IconName, label: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
      <Icon name={icon} size={13} color={th.textMute} />
      <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>{label}</span>
    </div>
  );
  const payCard = (selected: boolean): React.CSSProperties => ({
    border: `1.5px solid ${selected ? th.accent : th.lineStrong}`,
    background: selected ? `${th.accent}14` : th.surface,
    borderRadius: 14,
    transition: 'border-color .15s, background .15s',
  });
  const payTile = (selected: boolean): React.CSSProperties => ({
    width: 36, height: 36, flex: '0 0 auto', borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: selected ? th.accent : `${th.accent}14`,
  });
  const payTitle: React.CSSProperties = { flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text };
  const payDesc: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, lineHeight: 1.4, marginTop: 8, paddingLeft: 48 };
  const checkBadge = (
    <span style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: '50%', background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="check" size={13} color={th.onAccent} />
    </span>
  );

  return (
    <>
      {/* Choix du mode de paiement — avenues mutuellement exclusives. */}
      <div style={{ marginTop: 20 }}>
        {sectionLabel('card', 'Mode de paiement')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Avenue 0 — couverture par abonnement (sélectionnée par défaut si le créneau est couvert). */}
          {cover && (
            <button type="button" onClick={() => { setUseSub(true); setPaySource(null); setPayMode('club'); }}
              style={{ ...payCard(useSub), display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer', padding: '11px 13px' }}>
              <span style={payTile(useSub)}><Icon name="bolt" size={18} color={useSub ? th.onAccent : th.accent} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text }}>Couvert par votre abonnement</span>
                <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 2 }}>{coverageLabel(cover)}</span>
              </span>
              {useSub && checkBadge}
            </button>
          )}

          {/* Avenue 1 — régler au club (caché si paiement en ligne imposé). */}
          {!requireOnlinePayment && (() => {
            const sel = !useSub && payMode === 'club' && !paySource;
            return (
            <div style={{ ...payCard(sel), padding: '11px 13px' }}>
              <button type="button" onClick={() => { setUseSub(false); setPayMode('club'); setPaySource(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                <span style={payTile(sel)}><Icon name="home" size={18} color={sel ? th.onAccent : th.accent} /></span>
                <span style={payTitle}>Régler au club</span>
                {sel && checkBadge}
              </button>
              <div style={payDesc}>
                {requireCardFingerprint
                  ? <>Le club enregistre une <b style={{ color: th.textMute }}>empreinte de votre carte</b> (protection no-show) ; le règlement se fait sur place.</>
                  : <>Vous réglez directement au club — <b style={{ color: th.textMute }}>aucune carte enregistrée</b>.</>}
              </div>
            </div>
            );
          })()}

          {/* Avenue 2 — payer en ligne (visible si Stripe actif ou imposé). */}
          {onlineAvailable && (() => {
            const sel = !useSub && payMode === 'online' && !paySource;
            return (
            <div style={{ ...payCard(sel), padding: '11px 13px', opacity: onlineRequiredButUnavailable ? 0.55 : 1 }}>
              <button type="button" disabled={onlineRequiredButUnavailable}
                onClick={() => { setUseSub(false); setPayMode('online'); setPaySource(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: onlineRequiredButUnavailable ? 'default' : 'pointer', padding: 0 }}>
                <span style={payTile(sel)}><Icon name="card" size={18} color={sel ? th.onAccent : th.accent} /></span>
                <span style={payTitle}>Payer en ligne</span>
                {sel && checkBadge}
              </button>
              {onlineRequiredButUnavailable ? (
                <div style={payDesc}>Paiement en ligne momentanément indisponible — contactez le club.</div>
              ) : sel && (
                <div style={{ ...payDesc, color: th.textMute, fontSize: 12 }}>
                  {onlineShare
                    ? <>Votre part : <b style={{ color: th.text }}>{perPerson}€</b> <span style={{ color: th.textFaint }}>· {totalPrice}€ ÷ {capacity} joueurs</span></>
                    : <>Montant : <b style={{ color: th.text }}>{totalPrice}€</b> <span style={{ color: th.textFaint }}>· part trop faible (minimum 0,50 €)</span></>}
                </div>
              )}
            </div>
            );
          })()}

          {/* Avenue 3 — carnets prépayés (paient le TOTAL depuis le solde). */}
          {packages.length > 0 && (() => {
            const selPkg = paySource ? packages.find((p) => p.id === paySource) ?? null : null;
            return (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {packages.map((p) => {
                  const ok = canCover(p, totalEuros);
                  const sel = paySource === p.id;
                  return (
                    <button key={p.id} type="button" disabled={!ok} onClick={() => { setUseSub(false); setPaySource(p.id); setPayMode('club'); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1.5px solid ${sel ? th.accent : th.lineStrong}`, background: sel ? `${th.accent}14` : th.surface, borderRadius: 12, padding: '9px 12px', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                      <Icon name="ticket" size={15} color={sel ? th.accent : th.textMute} />
                      {packageLabel(p)}
                      {!ok && <span style={{ color: th.textFaint, fontWeight: 600 }}>· solde insuffisant</span>}
                      {sel && <Icon name="check" size={13} color={th.accent} />}
                    </button>
                  );
                })}
              </div>
              {selPkg && (
                <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 8 }}>
                  Après paiement : {remainingAfterLabel(selPkg, totalEuros)}
                </div>
              )}
            </div>
            );
          })()}
        </div>
      </div>

      {errorMsg && (
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.onAccent, background: th.accent, padding: '8px 12px', borderRadius: 10, fontWeight: 600, marginTop: 14 }}>{errorMsg}</div>
      )}

      {/* Pied du chemin Stripe : CGV puis formulaire Stripe DIRECT (ses propres boutons
          « Annuler / Payer »). Le pied « Abandonner / Confirmer » du chemin non-carte
          vit dans CheckoutFooter (rendu par la page uniquement si !cardPath). */}
      {cardPath && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
          {/* CGV — requise avant tout intent CB ; cocher révèle le formulaire Stripe. */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={cgvAccepted}
              onChange={(e) => { const v = e.target.checked; setCgvAccepted(v); if (v) rememberCgvAccepted(slug); }}
              aria-label="J'accepte les conditions générales de vente et la politique de confidentialité"
              style={{ width: 15, height: 15, marginTop: 1, accentColor: th.accent, flex: '0 0 auto', cursor: 'pointer' }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint, lineHeight: 1.4 }}>
              J&apos;accepte les{' '}
              <a href="/cgv" target="_blank" rel="noopener noreferrer" style={{ color: th.textMute, textDecoration: 'underline' }}>conditions générales de vente</a>
              {' '}et la{' '}
              <a href="/confidentialite" target="_blank" rel="noopener noreferrer" style={{ color: th.textMute, textDecoration: 'underline' }}>politique de confidentialité</a>.
              {cgvStatus === 'fallback' && (
                <span style={{ display: 'block', color: th.textFaint, fontSize: 10, marginTop: 2 }}>
                  Les conditions générales de la plateforme s&apos;appliquent.
                </span>
              )}
            </span>
          </label>

          {cgvAccepted && reservation ? (
            <div style={{ marginTop: 16 }}>
              <StripePaymentStep
                type={stripeType}
                amountLabel={stripeAmountLabel}
                cgvAccepted={cgvAccepted} beforeSubmit={persistHoldSetup}
                createIntent={createStripeIntent}
                confirm={async (ids) => { await api.confirmReservation(reservation!.id, token, { ...ids, cgvAccepted }); }}
                onSuccess={() => handleStripeSuccess(reservation!)}
                onCancel={onExit} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Acceptez les conditions pour continuer.</span>
              <Btn variant="surface" onClick={onExit}>Abandonner</Btn>
            </div>
          )}
        </div>
      )}
    </>
  );
}
