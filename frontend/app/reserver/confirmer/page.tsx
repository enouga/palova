'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ClubDetail, MemberPackage, MyQuotaStatus, Subscription, TimeSlot } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { playerCount } from '@/lib/courtType';
import { HOLD_SECONDS } from '@/lib/bookingErrors';
import { useBookingCheckout } from '@/components/checkout/useBookingCheckout';
import { Screen } from '@/components/ui/Screen';
import { Btn, TopBar } from '@/components/ui/atoms';
import { CheckoutHero } from '@/components/checkout/CheckoutHero';
import { CheckoutPlayers } from '@/components/checkout/CheckoutPlayers';
import { CheckoutMatchOptions } from '@/components/checkout/CheckoutMatchOptions';
import { CheckoutPayment } from '@/components/checkout/CheckoutPayment';
import { CheckoutFooter } from '@/components/checkout/CheckoutFooter';
import { CancellationNotice } from '@/components/reservations/CancellationNotice';
import { QuotaStatus } from '@/components/quota/QuotaStatus';

/**
 * Page checkout — /reserver/confirmer?resource=&start=&duration=&price=&sport=&format=&name=&offpeak=
 * Assemble le hook `useBookingCheckout` + les composants `components/checkout/*` (déjà construits).
 * Remplace le flux modal (BookingModal) par une page dédiée. `useSearchParams` impose une frontière
 * Suspense (convention Next.js pour les client components qui lisent la query pendant le rendu statique).
 */
export default function ConfirmerReservationPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <ConfirmerPageInner />
    </Suspense>
  );
}

function ConfirmerPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club, loading: clubLoading } = useClub();

  // Paramètres de la grille (Réserver) — mêmes champs que le lien profond ?resource=&start=,
  // plus des indices d'affichage (price/sport/format/name/offpeak) pour ne pas dépendre d'un
  // aller-retour réseau avant le premier rendu du hero.
  const resource = sp.get('resource');
  const start = sp.get('start');
  const durationParam = sp.get('duration');
  const duration = durationParam ? Number(durationParam) : NaN;
  const price = sp.get('price') ?? '0';
  const sport = sp.get('sport') ?? undefined;
  const format = sp.get('format') ?? undefined;
  const name = sp.get('name') ?? undefined;
  const offpeak = sp.get('offpeak') === '1';
  const paramsValid = !!resource && !!start && !Number.isNaN(duration) && duration > 0;

  // Contexte joueur (soldes, abonnements, quotas, empreinte carte) — mêmes appels API que
  // ClubReserve (components/ClubReserve.tsx). Best-effort : un échec laisse un état neutre,
  // il n'empêche jamais le hold/la confirmation (juste les options associées).
  const [packages, setPackages] = useState<MemberPackage[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [quotaStatus, setQuotaStatus] = useState<MyQuotaStatus | null>(null);
  const [hasCardOnFile, setHasCardOnFile] = useState(false);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);
  useEffect(() => { if (!paramsValid) router.replace('/reserver'); }, [paramsValid, router]);

  useEffect(() => {
    if (!token || !slug) return;
    api.getMyClubPackages(slug, token).then(setPackages).catch(() => setPackages([]));
    api.getMyClubSubscriptions(slug, token).then(setSubscriptions).catch(() => setSubscriptions([]));
    api.getMyQuotaStatus(slug, token).then(setQuotaStatus).catch(() => setQuotaStatus(null));
    api.getMyCardStatus(slug, token).then((s) => setHasCardOnFile(s.hasCardOnFile)).catch(() => {});
  }, [token, slug]);

  const slot: TimeSlot = useMemo(() => {
    const startMs = start ? Date.parse(start) : NaN;
    const endTime = !Number.isNaN(startMs) && !Number.isNaN(duration)
      ? new Date(startMs + duration * 60000).toISOString()
      : (start ?? '');
    return { startTime: start ?? '', endTime, price, offPeak: offpeak, available: true };
  }, [start, duration, price, offpeak]);

  // Contexte essentiel avant de poser le hold (le hook bloque le créneau au montage — il lui
  // faut un token et un club définitifs). Soldes/abonnements/quotas arrivent en best-effort
  // APRÈS : le hook les accepte en défaut ([]/null) et se met à jour au fil de l'eau.
  const essentialReady = ready && !!token && !clubLoading && !!club && paramsValid;

  if (!essentialReady) {
    return (
      <Screen>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>
          Chargement…
        </div>
      </Screen>
    );
  }

  return (
    <CheckoutView
      slot={slot} resource={resource!} price={price} duration={duration} token={token!}
      club={club!} slug={slug!} sport={sport} format={format} name={name}
      packages={packages} subscriptions={subscriptions} quotaStatus={quotaStatus} hasCardOnFile={hasCardOnFile}
    />
  );
}

function CheckoutView({
  slot, resource, price, duration, token, club, slug, sport, format, name,
  packages, subscriptions, quotaStatus, hasCardOnFile,
}: {
  slot: TimeSlot; resource: string; price: string; duration: number; token: string;
  club: ClubDetail; slug: string; sport?: string; format?: string; name?: string;
  packages: MemberPackage[]; subscriptions: Subscription[]; quotaStatus: MyQuotaStatus | null; hasCardOnFile: boolean;
}) {
  const { th } = useTheme();
  const router = useRouter();
  const isDesktop = useIsDesktop(900);

  // Pas d'effet de nettoyage au démontage de cette page : `useBookingCheckout` pose son hold
  // au montage et n'a volontairement PAS de cleanup (voir son commentaire) — en React StrictMode
  // (dev) le montage est doublé, et un cleanup ici annulerait le hold en vol dès le premier
  // démontage fictif, orphelinant le second. La sortie volontaire passe par `checkout.handleExit`
  // (flèche retour / « Abandonner ») ; une navigation involontaire (retour navigateur, fermeture
  // d'onglet…) est couverte par le TTL du verrou Redis + le job de nettoyage backend, et un hold
  // qui redémarre reprend l'existant (route /hold idempotente côté backend).
  const checkout = useBookingCheckout({
    slot, resourceId: resource, price, duration, token,
    timezone: club.timezone, slug, maxPlayers: playerCount(format), sportKey: sport, format, resourceName: name,
    packages, subscriptions, quotaStatus,
    clubId: club.id, requireOnlinePayment: club.requireOnlinePayment, requireCardFingerprint: club.requireCardFingerprint,
    hasCardOnFile, stripeActive: club.stripeAccountStatus === 'ACTIVE',
    cancellationCutoffHours: club.cancellationCutoffHours, refundOnCancelWithinCutoff: club.refundOnCancelWithinCutoff,
    onConfirmed: () => router.push('/reserver?confirmed=1'),
    onExit: () => router.push('/reserver'),
  });

  const footerDisabled = checkout.payMode === 'online' && checkout.onlineRequiredButUnavailable && !checkout.paySource;

  const hero = (
    <CheckoutHero
      phase={checkout.phase} mm={checkout.mm} ss={checkout.ss} urgent={checkout.urgent}
      secondsLeft={checkout.secondsLeft} holdSeconds={HOLD_SECONDS}
      totalPrice={checkout.totalPrice} perPerson={checkout.perPerson} capacity={checkout.capacity} durLabel={checkout.durLabel}
      slot={slot} timezone={club.timezone} resourceName={name} format={format} sportKey={sport}
    />
  );

  const holdingNotice = (
    <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>
      Blocage du créneau…
    </div>
  );

  const players = (
    <CheckoutPlayers
      showPartners={checkout.showPartners} isPadel={checkout.isPadel} me={checkout.me}
      partners={checkout.partners} buildPlayers={checkout.buildPlayers} capacity={checkout.capacity}
      atCap={checkout.atCap} addTarget={checkout.addTarget} setAddTarget={checkout.setAddTarget}
      addPartnerTo={checkout.addPartnerTo} removePartner={checkout.removePartner} addPartner={checkout.addPartner}
      setTeamsDraft={checkout.setTeamsDraft} setSlotsDraft={checkout.setSlotsDraft}
      nbPlayers={checkout.nbPlayers} perPlayer={checkout.perPlayer} cap={checkout.cap}
      slug={checkout.slug} token={checkout.token}
    />
  );

  const matchOptions = (
    <CheckoutMatchOptions
      isPadel={checkout.isPadel} visibility={checkout.visibility} setVisibility={checkout.setVisibility}
      spotsLeft={checkout.spotsLeft} levelForSport={checkout.levelForSport} levelLimited={checkout.levelLimited}
      setLevelLimited={checkout.setLevelLimited} levelMin={checkout.levelMin} levelMax={checkout.levelMax}
      setLevel={checkout.setLevel}
    />
  );

  const quota = checkout.quotaStatus && (
    <div style={{ marginTop: 16 }}><QuotaStatus status={checkout.quotaStatus} compact /></div>
  );

  const payment = (
    <CheckoutPayment
      cover={checkout.cover} useSub={checkout.useSub} setUseSub={checkout.setUseSub}
      payMode={checkout.payMode} setPayMode={checkout.setPayMode} paySource={checkout.paySource} setPaySource={checkout.setPaySource}
      packages={checkout.packages} requireOnlinePayment={checkout.requireOnlinePayment} requireCardFingerprint={checkout.requireCardFingerprint}
      onlineAvailable={checkout.onlineAvailable} onlineRequiredButUnavailable={checkout.onlineRequiredButUnavailable} onlineShare={checkout.onlineShare}
      perPerson={checkout.perPerson} totalPrice={checkout.totalPrice} capacity={checkout.capacity} totalEuros={checkout.totalEuros}
      cardPath={checkout.cardPath} cgvAccepted={checkout.cgvAccepted} setCgvAccepted={checkout.setCgvAccepted} cgvStatus={checkout.cgvStatus}
      slug={checkout.slug} reservation={checkout.reservation} token={checkout.token}
      createStripeIntent={checkout.createStripeIntent} stripeType={checkout.stripeType} stripeAmountLabel={checkout.stripeAmountLabel}
      persistHoldSetup={checkout.persistHoldSetup} handleStripeSuccess={checkout.handleStripeSuccess} onExit={checkout.handleExit}
      errorMsg={checkout.errorMsg}
    />
  );

  const cancellation = <CancellationNotice text={checkout.cancellationText} />;

  const footer = !checkout.cardPath && (
    <CheckoutFooter
      confirmLabel={checkout.confirmLabel} busy={checkout.busy} phase={checkout.phase}
      disabled={footerDisabled} onConfirm={checkout.handleConfirm} onExit={checkout.handleExit}
    />
  );

  return (
    <Screen style={isDesktop ? { maxWidth: 960 } : undefined}>
      <div style={{ paddingBottom: 24 }}>
        <TopBar title="Confirmer ma réservation" onBack={checkout.handleExit} />

        {checkout.phase === 'error' ? (
          <div style={{ padding: '0 20px' }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.onAccent, background: th.accent, padding: '12px 14px', borderRadius: 12, fontWeight: 600 }}>
              {checkout.errorMsg}
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn full variant="surface" onClick={() => router.push('/reserver')}>Retour à la grille</Btn>
            </div>
          </div>
        ) : isDesktop ? (
          <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 24, alignItems: 'flex-start' }}>
            <div>
              {checkout.phase === 'holding' && holdingNotice}
              {checkout.phase === 'held' && (
                <>
                  {players}
                  {matchOptions}
                  {quota}
                  {cancellation}
                </>
              )}
            </div>
            <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {hero}
              {checkout.phase === 'held' && (
                <>
                  {payment}
                  {footer}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: '0 20px' }}>
              {hero}
              {checkout.phase === 'holding' && holdingNotice}
              {checkout.phase === 'held' && (
                <>
                  {players}
                  {matchOptions}
                  {quota}
                  {payment}
                  {cancellation}
                </>
              )}
            </div>
            {checkout.phase === 'held' && footer && (
              <div style={{ position: 'sticky', bottom: 0, zIndex: 5, background: th.bg, padding: '0 20px calc(12px + env(safe-area-inset-bottom))' }}>
                {footer}
              </div>
            )}
          </>
        )}
      </div>
    </Screen>
  );
}
