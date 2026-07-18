'use client';
import { useState, useEffect, useRef, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { api, TimeSlot, Reservation, MemberPackage, MyQuotaStatus, Subscription } from '@/lib/api';
import { packageLabel, canCover, remainingAfterLabel, paidWithLabel, pickPackageFor } from '@/lib/packages';
import { coveringSubscription, coverageLabel } from '@/lib/subscriptions';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, Theme, gaugeTrack, dangerBanner } from '@/lib/theme';
import { durationLabel } from '@/lib/duration';
import { Btn } from '@/components/ui/atoms';
import { QuotaStatus } from '@/components/quota/QuotaStatus';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { capacityFor, courtFormat } from '@/lib/courtType';
import { cancellationPolicyLabel, quotaBites } from '@/lib/reservations';
import { hasAcceptedCgv, rememberCgvAccepted } from '@/lib/cgv';
import { Icon, IconName } from '@/components/ui/Icon';
import { BookingSuccess } from '@/components/booking/BookingSuccess';

const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });

interface BookingModalProps {
  slot: TimeSlot;
  resourceId: string;
  price: string;
  duration: number;
  token: string;
  timezone?: string;
  /** Slug du club — active l'ajout de partenaires (annuaire des membres). */
  slug?: string;
  /** Nombre max de joueurs du terrain (single = 2, double = 4) — plafonne les partenaires. */
  maxPlayers?: number;
  /** Clé du sport (padel, tennis…) — capacité nominale du terrain. */
  sportKey?: string;
  /** Format du terrain (single/double) — badge au récap. */
  format?: string;
  /** Nom du terrain (ex. « Court 1 ») — affiché au récap. */
  resourceName?: string;
  /** Soldes prépayés utilisables du joueur sur ce club (option « payer avec mon carnet »). */
  packages?: MemberPackage[];
  /** Abonnements actifs du joueur sur ce club (couverture du créneau au booking). */
  subscriptions?: Subscription[];
  /** État des quotas du joueur (compteur affiché à la confirmation) — null si pas de quota. */
  quotaStatus?: MyQuotaStatus | null;
  onClose: () => void;
  /** `paid` (optionnel) résume un règlement par solde prépayé (moyen + restant). */
  onConfirmed: (reservation: Reservation, paid?: { label: string }) => void;
  /** ID du club (pour les appels Stripe). */
  clubId?: string;
  /** Exige un paiement CB en ligne. */
  requireOnlinePayment?: boolean;
  /** Exige une empreinte bancaire (anti-no-show). */
  requireCardFingerprint?: boolean;
  /** Le club a déjà une carte enregistrée pour le joueur → pas de réenregistrement d'empreinte. */
  hasCardOnFile?: boolean;
  /** Le compte Stripe Connect du club est ACTIF — le paiement en ligne facultatif est proposable. */
  stripeActive?: boolean;
  /** Délai d'annulation gratuite du club (heures avant le début) — affichage récap. */
  cancellationCutoffHours?: number;
  /** Remboursement en cas d'annulation dans les délais — affichage récap. */
  refundOnCancelWithinCutoff?: boolean;
}

const HOLD_SECONDS = 300; // miroir de HOLD_TTL_SECONDS (backend)

function formatHour(iso: string, tz = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

const BOOKING_ERRORS: Record<string, string> = {
  SLOT_NOT_AVAILABLE:     "Ce créneau vient d'être pris. Choisissez-en un autre.",
  SLOT_ALREADY_HELD:      "Ce créneau vient d'être pris. Choisissez-en un autre.",
  QUOTA_PEAK_REACHED:     'Vous avez atteint votre nombre maximum de réservations en heures pleines.',
  QUOTA_OFFPEAK_REACHED:  'Vous avez atteint votre nombre maximum de réservations en heures creuses.',
  TOO_MANY_PLAYERS:       'Trop de joueurs pour ce terrain.',
  PARTNER_NOT_MEMBER:     "Un partenaire n'est pas membre du club.",
  PARTNER_DUPLICATE:      'Un partenaire figure en double.',
  RESERVATION_NOT_PENDING: 'La pré-réservation a expiré. Veuillez recommencer.',
  // Pré-conditions de paiement (gardes serveur) — jamais affichées en code brut.
  ONLINE_PAYMENT_REQUIRED: 'Ce club exige le paiement en ligne pour réserver.',
  CARD_FINGERPRINT_REQUIRED: "Ce club demande d'enregistrer une carte bancaire (protection no-show). Acceptez les conditions, puis enregistrez votre carte.",
  CGV_NOT_ACCEPTED:        'Veuillez accepter les conditions générales de vente.',
  PAYMENT_NOT_SUCCEEDED:   "Le paiement n'a pas abouti. Veuillez réessayer.",
  SETUP_NOT_SUCCEEDED:     "L'enregistrement de la carte n'a pas abouti. Veuillez réessayer.",
};

/** Carte d'en-tête « hero » : glyphe sport + court + format + date + horaire + prix focal. */
function BookingHeaderCard({ slot, timezone, resourceName, format, totalPrice, perPerson, capacity, durLabel, th }: {
  slot: TimeSlot; timezone?: string; resourceName?: string; format?: string;
  totalPrice: string; perPerson: string; capacity: number; durLabel: string; th: Theme;
}) {
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(new Date(slot.startTime));
  return (
    <div style={{ position: 'relative', overflow: 'hidden', marginTop: 14, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 20, padding: '16px 18px' }}>
      {/* Lavis diagonal à l'accent du club (purement décoratif). */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${th.accent}24 0%, transparent 58%)`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ width: 44, height: 44, flex: '0 0 auto', borderRadius: 13, background: `${th.accent}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ball" size={24} color={th.accent} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: th.fontDisplay, fontSize: 21, fontWeight: 700, letterSpacing: -0.4, color: th.text }}>{resourceName ?? 'Court'}</span>
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: th.textMute, border: `1px solid ${th.lineStrong}`, background: th.bgElev, borderRadius: 999, padding: '2px 9px' }}>{courtFormat(format) ?? 'Double'}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontFamily: th.fontDisplay, fontSize: 34, fontWeight: 800, letterSpacing: -1.3, color: th.text, lineHeight: 0.95 }}>{totalPrice}€</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 5 }}>≈ {perPerson} € / pers · {capacity} j.</div>
        </div>
      </div>
      {/* Date + horaire en pleine largeur (ré-indentées sous le nom) : hors de la colonne
          écrasée par la colonne prix, donc « Samedi 11 Juillet » et « 08h00 → 09h30 · 1 h 30 »
          ne se coupent jamais, quelle que soit la largeur de l'écran. */}
      <div style={{ position: 'relative', paddingLeft: 56, marginTop: 8 }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, textTransform: 'capitalize' }}>{dateLabel}</div>
        <div style={{ marginTop: 4, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <Icon name="clock" size={13} color={th.textFaint} />
            {formatHour(slot.startTime, timezone)} → {formatHour(slot.endTime, timezone)}
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>· {durLabel}</span>
          {slot.offPeak && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fde9c8', borderRadius: 6, padding: '2px 7px' }}>
              <Icon name="moon" size={10} color="#b45309" />heures creuses
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Bloc d'info « Conditions d'annulation » — PURE information (lecture seule),
 * volontairement distinct des cartes de choix au-dessus : pas de bordure « carte »,
 * fond plat discret et titre en petit capitale → ne se lit pas comme une option à cocher.
 */
function CancellationNotice({ text, th }: { text: string; th: Theme }) {
  return (
    <div style={{ marginTop: 16, background: th.surface2, borderRadius: 12, padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ width: 26, height: 26, flex: '0 0 auto', borderRadius: 8, background: '#fff1e9', color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>↺</span>
      <div>
        <div style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, marginBottom: 2 }}>Conditions d&apos;annulation</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.45 }}>{text}</div>
      </div>
    </div>
  );
}

export default function BookingModal({
  slot, resourceId, price, duration, token, timezone, slug, maxPlayers, sportKey, format, resourceName, packages = [], subscriptions = [], quotaStatus, onClose, onConfirmed,
  clubId, requireOnlinePayment, requireCardFingerprint, hasCardOnFile, stripeActive, cancellationCutoffHours, refundOnCancelWithinCutoff,
}: BookingModalProps) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();

  const [phase, setPhase]             = useState<'holding' | 'held' | 'error' | 'confirmed'>('holding');
  // Résa confirmée + résumé du paiement (affichage succès) + note pour onConfirmed.
  const [confirmedInfo, setConfirmedInfo] = useState<{ reservation: Reservation; summary: string; paid?: { label: string } } | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [errorMsg, setErrorMsg]       = useState('');
  const [busy, setBusy]               = useState(false); // confirm/applyHoldSetup en vol
  const didHold                       = useRef(false);   // garde anti double-hold (StrictMode)
  const settled                       = useRef(false);   // résa réglée (confirmée OU annulée par l'utilisateur) → ne pas (ré)annuler
  const reservationRef                = useRef<Reservation | null>(null); // dernière résa connue (même avant le setState)
  const closedRef                     = useRef(false);   // l'utilisateur a fermé (handleClose) — distinct du faux démontage StrictMode

  // Soldes prépayés valables pour le sport du terrain réservé : un carnet/porte-monnaie
  // limité à certains sports (`template.sportKeys`) n'apparaît que si ce sport correspond ;
  // `sportKeys` vide = tous sports. Sans sportKey connu, on n'exclut rien (pas de régression).
  const sportPackages = sportKey
    ? packages.filter((p) => {
        const keys = p.template?.sportKeys ?? [];
        return keys.length === 0 || keys.includes(sportKey);
      })
    : packages;

  // Défaut intelligent : abonnement couvrant (via l'effet useSub) > premier solde prépayé
  // capable de couvrir > régler au club. Jamais de carnet pré-choisi si le club impose
  // le paiement en ligne (l'avenue carnet reste disponible derrière « changer »).
  const [paySource, setPaySource]     = useState<string | null>(() => {
    if (requireOnlinePayment) return null;
    if (coveringSubscription(subscriptions, { sportKey: sportKey ?? '', isOffPeak: slot.offPeak ?? false })) return null;
    return pickPackageFor(sportPackages, Math.round(Number(slot.price ?? price) * 100))?.id ?? null;
  });
  // Ligne de paiement repliée par défaut (« … · changer ») → dépliée révèle les avenues.
  const [payExpanded, setPayExpanded] = useState(false);
  const [useSub, setUseSub]           = useState(false); // utiliser l'abonnement couvrant (défaut true s'il existe)
  // Acceptation CGV — requise dès qu'on passe par une empreinte/paiement CB Stripe.
  const [cgvAccepted, setCgvAccepted] = useState(false);
  // Le club a-t-il publié ses CGV ? ('published' → lien /cgv ; 'fallback' → CGV plateforme).
  const [cgvStatus, setCgvStatus]     = useState<'published' | 'fallback' | null>(null);
  // Empreinte forcée : le backend a renvoyé CARD_FINGERPRINT_REQUIRED alors que la prop
  // requireCardFingerprint était périmée (toggle activé après le chargement de la page).
  const [fingerprintForced, setFingerprintForced] = useState(false);
  // Avenue de paiement (mutuellement exclusive avec un carnet) : régler au club ou en ligne.
  const [payMode, setPayMode]         = useState<'club' | 'online'>(requireOnlinePayment ? 'online' : 'club');
  // Paiement en ligne : régler sa PART (défaut) ou TOUTE la partie (payer pour le court entier).
  const [payWholeMatch, setPayWholeMatch] = useState(false);
  // Multi-joueurs : bloc « Organisez votre partie » (joueurs + ouverture aux membres, cette
  // dernière restreinte au padel) affiché sur l'écran de succès dès qu'un court a plusieurs
  // places et un club connu.
  const cap = maxPlayers ?? 1;
  const showPartners = !!slug && cap > 1;
  const euros = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ','));

  // Prix du créneau calculé par le backend (slot.price : tarif creux ssi
  // entièrement en heures creuses) ; repli sur le prix du terrain.
  const totalCents = Math.round(Number(slot.price ?? price) * 100);
  const totalEuros = totalCents / 100;
  const totalPrice = totalCents % 100 === 0 ? String(totalCents / 100) : (totalCents / 100).toFixed(2).replace('.', ',');
  const durLabel = durationLabel(duration);

  // Couverture par abonnement : le créneau est creux ssi slot.offPeak (calculé par le backend,
  // = entièrement en heures creuses). On cherche le 1er abo qui couvre ce sport/ce créneau.
  const isOffPeak = slot.offPeak ?? false;
  const cover = coveringSubscription(subscriptions, { sportKey: sportKey ?? '', isOffPeak });

  // Récap : capacité nominale du terrain (sport + format) → prix par personne (toujours affiché).
  const capacity = capacityFor(sportKey, format);
  const shareCents = Math.round(totalCents / capacity);
  const perPerson = euros(shareCents);

  const shareTooSmall = shareCents < 50; // minimum Stripe (0,50 €) → le backend refuse (AMOUNT_TOO_SMALL)

  // Le paiement en ligne est-il disponible ? (compte Stripe actif, ou imposé par le club)
  const onlineAvailable = !!stripeActive || !!requireOnlinePayment;
  // Cas défensif : le club EXIGE le paiement en ligne mais son compte Stripe n'est pas actif.
  const onlineRequiredButUnavailable = !!requireOnlinePayment && !stripeActive;
  // En ligne : la part par personne par défaut ; l'utilisateur peut choisir de régler
  // toute la partie (payWholeMatch). Part trop faible (< 0,50 €) → total forcé.
  const onlineShare = !shareTooSmall && !payWholeMatch;
  const onlineAmountLabel = onlineShare ? `${perPerson}€` : `${totalPrice}€`;

  // Y a-t-il autre chose à choisir que le défaut ? (sinon, pas de bouton « changer »)
  const avenueCount = (cover ? 1 : 0) + sportPackages.length + (onlineAvailable ? 1 : 0) + (requireOnlinePayment ? 0 : 1);
  const hasAlternatives = avenueCount > 1;
  // Quand le paiement en ligne est possible et qu'il existe plusieurs avenues, on affiche
  // directement les possibilités (au lieu de la ligne repliée « … · changer » qui cacherait
  // l'option « Payer en ligne »). Le repli reste pour les cas sans paiement en ligne.
  const showAvenues = payExpanded || (onlineAvailable && hasAlternatives);

  // La confirmation va-t-elle passer par un intent CB Stripe (paiement OU empreinte) ?
  // Miroir exact de la condition de bascule dans handleConfirm. Dans ce cas seulement,
  // on exige l'acceptation des CGV (le backend l'impose aussi côté serveur).
  // L'empreinte n'est exigée que si le club n'a pas déjà la carte du joueur.
  const needsFingerprint = (!!requireCardFingerprint || fingerprintForced) && !hasCardOnFile;
  const cardIntentPath = !useSub && !paySource && ((payMode === 'online' && onlineAvailable) || needsFingerprint);
  // Chemin Stripe réellement jouable (paiement en ligne ou empreinte) : le formulaire Stripe
  // s'affiche en place des boutons « Abandonner / Valider ». Exclut le cas défensif « en ligne
  // imposé mais Stripe inactif » (qui garde une rangée d'action avec bouton désactivé).
  const cardPath = cardIntentPath && !onlineRequiredButUnavailable;

  // Hold au montage : pose le blocage Redis (organisateur seul, sans partenaires/visibilité).
  // Les joueurs/visibilité choisis ensuite sont appliqués via applyHoldSetup avant la confirmation.
  // Le hold est posé UNE seule fois (garde didHold). Pas de cleanup ici : en dev,
  // React StrictMode monte le composant 2× et un cleanup poserait alive=false sur le
  // hold en vol → à sa résolution il s'annulerait au lieu de passer en 'held' (créneau
  // bloqué « pour toujours »). La libération en cas de fermeture passe par closedRef
  // (posé par handleClose), jamais par le faux démontage de StrictMode.
  useEffect(() => {
    if (didHold.current) return;
    didHold.current = true;
    (async () => {
      try {
        const res = await api.holdSlot(
          { resourceId, startTime: slot.startTime, endTime: slot.endTime }, token,
        );
        reservationRef.current = res;
        // Fermé avant l'arrivée du blocage : le serveur a réservé mais plus personne ne
        // confirmera → on libère (sinon lock Redis orphelin 5 min).
        if (closedRef.current) {
          if (!settled.current) { settled.current = true; api.cancelReservation(res.id, token).catch(() => {}); }
          return;
        }
        setReservation(res);
        setSecondsLeft(HOLD_SECONDS);
        setPhase('held');
      } catch (err) {
        if (closedRef.current) return;
        setErrorMsg(BOOKING_ERRORS[(err as Error).message] ?? (err as Error).message);
        setPhase('error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Abonnement couvrant : sélectionné par défaut dès qu'il existe (le joueur peut le désélectionner
  // en choisissant un autre mode de paiement). Réinitialise quand l'abo couvrant change.
  useEffect(() => {
    setUseSub(!!cover);
  }, [cover?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-coche la case CGV si le joueur a déjà accepté les conditions de CE club
  // (mémoire locale). Lu en effet — jamais au render — car le deep-link
  // `?resource=&start=` peut pré-ouvrir la modale (hydration-safe). La trace légale
  // reste envoyée par transaction au confirmReservation ; ceci ne fait que pré-cocher.
  useEffect(() => {
    if (hasAcceptedCgv(slug)) setCgvAccepted(true);
  }, [slug]);

  // Au moment où le chemin CB Stripe devient actif, on vérifie (une seule fois) si le
  // club a publié ses CGV. Publié → lien vers /cgv ; sinon (PAGE_NOT_FOUND ou erreur) →
  // repli sur les conditions générales de la plateforme.
  useEffect(() => {
    if (!cardIntentPath || cgvStatus !== null) return;
    if (!slug) { setCgvStatus('fallback'); return; }
    let cancelled = false;
    api.getClubPage(slug, 'CGV')
      .then(() => { if (!cancelled) setCgvStatus('published'); })
      .catch(() => { if (!cancelled) setCgvStatus('fallback'); });
    return () => { cancelled = true; };
  }, [cardIntentPath, slug, cgvStatus]);

  // Timer : tourne en phase held ; à 0 → écran d'erreur.
  useEffect(() => {
    if (phase !== 'held') return;
    if (secondsLeft <= 0) {
      setPhase('error');
      setErrorMsg('La pré-réservation a expiré. Veuillez recommencer.');
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);
  const urgent = secondsLeft <= 60;

  const handleConfirm = async () => {
    if (!reservation || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      // Source de paiement : abonnement couvrant prioritaire, sinon carnet, sinon rien (régler au club).
      const paymentSource = useSub && cover ? { subscriptionId: cover.id }
        : paySource ? { packageId: paySource } : undefined;
      const usedPkg = paySource ? sportPackages.find((p) => p.id === paySource) ?? null : null;
      const confirmed = await api.confirmReservation(
        reservation.id, token, paymentSource ? { paymentSource } : undefined,
      );
      settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
      setConfirmedInfo({
        reservation: confirmed,
        summary: useSub && cover ? 'Votre part couverte par votre abonnement'
          : usedPkg ? paidWithLabel(usedPkg, totalEuros)
          : 'À régler au club',
        paid: usedPkg ? { label: paidWithLabel(usedPkg, totalEuros) } : undefined,
      });
      setPhase('confirmed');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'INSUFFICIENT_BALANCE') { setPaySource(null); setPayExpanded(true); setErrorMsg('Solde insuffisant — réglez au club.'); return; }
      if (msg === 'CARD_FINGERPRINT_REQUIRED') { setFingerprintForced(true); setPaySource(null); setErrorMsg(BOOKING_ERRORS.CARD_FINGERPRINT_REQUIRED); return; }
      if (BOOKING_ERRORS[msg] && msg !== 'SLOT_NO_LONGER_AVAILABLE') { setErrorMsg(BOOKING_ERRORS[msg]); return; }
      setPhase('error');
      setErrorMsg(msg === 'SLOT_NO_LONGER_AVAILABLE' ? 'Ce créneau a été pris entre-temps. Veuillez recommencer.' : (BOOKING_ERRORS[msg] ?? msg));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    // closedRef signale aux effets que l'utilisateur a fermé (≠ faux démontage StrictMode).
    // Si le hold est déjà posé, on le LIBÈRE ICI, immédiatement — sans bloquer la fermeture
    // sur la réponse réseau (fire-and-forget) : le créneau se libère dès le clic « Abandonner »
    // / clic sur le fond, et la modale se ferme dans la foulée. Si le hold arrive APRÈS
    // (fermeture pendant le blocage), l'effet de montage le libère via closedRef.
    closedRef.current = true;
    const r = reservation ?? reservationRef.current;
    if (r && !settled.current) {
      settled.current = true;
      api.cancelReservation(r.id, token).catch(() => { /* cleanup job récupèrera */ });
    }
    onClose();
  };

  // Fermeture de l'écran de succès (« Terminé » ou backdrop) : c'est ICI que la page
  // est prévenue — même contrat onConfirmed qu'avant, décalé à la fin de l'organisation.
  const handleDone = () => {
    if (!confirmedInfo) return;
    onConfirmed(confirmedInfo.reservation, confirmedInfo.paid);
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  // ── Briques de présentation (closure sur le thème) ──────────────────────────
  // Intitulé de section : micro-icône + label majuscule discret, rythme constant.
  const sectionLabel = (icon: IconName, label: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
      <Icon name={icon} size={13} color={th.textMute} />
      <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>{label}</span>
    </div>
  );
  // Carte d'avenue de paiement (sélectionnable) : anneau + lavis accent quand choisie.
  const payCard = (selected: boolean): React.CSSProperties => ({
    border: `1.5px solid ${selected ? th.accent : th.lineStrong}`,
    background: selected ? `${th.accent}14` : th.surface,
    borderRadius: 14,
    transition: 'border-color .15s, background .15s',
  });
  // Tuile-icône de l'avenue (pleine quand choisie).
  const payTile = (selected: boolean): React.CSSProperties => ({
    width: 36, height: 36, flex: '0 0 auto', borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: selected ? th.accent : `${th.accent}14`,
  });
  const payTitle: React.CSSProperties = { flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text };
  const payDesc: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, lineHeight: 1.4, marginTop: 8, paddingLeft: 48 };
  // Pastille de validation (✓) sur la carte choisie.
  const checkBadge = (
    <span style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: '50%', background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="check" size={13} color={th.onAccent} />
    </span>
  );
  // Bouton radio des avenues de paiement : cercle vide quand non choisi, rempli (✓) quand choisi.
  // Le cercle TOUJOURS visible (même vide) signale clairement « choix unique entre ces options ».
  const radioDot = (selected: boolean) => (
    <span style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: '50%',
      border: `2px solid ${selected ? th.accent : th.lineStrong}`, background: selected ? th.accent : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color .15s, background .15s' }}>
      {selected && <Icon name="check" size={12} color={th.onAccent} />}
    </span>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={phase === 'confirmed' ? handleDone : handleClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '100dvh', overflowY: 'auto', background: th.bgElev, borderRadius: '0 0 28px 28px', boxShadow: '0 14px 50px rgba(0,0,0,0.34)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        {/* Barre de timer fine (cachée en phase error / confirmed) */}
        {phase !== 'error' && phase !== 'confirmed' && (
          <div style={gaugeTrack(th, 4, 0)}>
            <div style={{ height: '100%', width: `${(secondsLeft / HOLD_SECONDS) * 100}%`, background: urgent ? ACCENTS.coral : th.accent, transition: 'width 1s linear' }} />
          </div>
        )}
        <div style={{ padding: '16px 20px 30px' }}>

          {phase === 'error' ? (
            <>
              <div style={dangerBanner(th)}>{errorMsg}</div>
              <div style={{ marginTop: 14 }}><Btn full variant="surface" onClick={onClose}>Fermer</Btn></div>
            </>
          ) : phase === 'confirmed' && confirmedInfo ? (
            <BookingSuccess
              reservationId={confirmedInfo.reservation.id}
              token={token} summary={confirmedInfo.summary}
              slot={slot} timezone={timezone} resourceName={resourceName} duration={duration}
              showPartners={showPartners}
              onDone={handleDone}
            />
          ) : (
            <>
              {/* En-tête : pill « créneau bloqué » + chip timer */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
                  color: phase === 'held' ? '#15803d' : th.textMute, background: phase === 'held' ? 'rgba(34,197,94,0.13)' : th.surface2, borderRadius: 999, padding: '5px 12px 5px 10px' }}>
                  {phase === 'held'
                    ? <><span style={{ width: 7, height: 7, borderRadius: '50%', background: th.success, boxShadow: `0 0 0 4px ${th.success}2e` }} />Créneau bloqué pour vous</>
                    : <><span style={{ width: 7, height: 7, borderRadius: '50%', background: th.textFaint }} />Blocage du créneau…</>}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontMono, fontWeight: 700, fontSize: 13,
                  color: urgent ? ACCENTS.coral : th.textMute, background: urgent ? `${ACCENTS.coral}1f` : th.surface2, borderRadius: 999, padding: '4px 11px' }}>
                  <Icon name="clock" size={12} color={urgent ? ACCENTS.coral : th.textMute} />{mm}:{ss}
                </span>
              </div>

              {/* Header carte hero */}
              <BookingHeaderCard slot={slot} timezone={timezone} resourceName={resourceName}
                format={format} totalPrice={totalPrice} perPerson={perPerson} capacity={capacity} durLabel={durLabel} th={th} />

              {/* Contenu interactif : visible une fois le créneau sécurisé (phase held). */}
              {phase === 'held' && (
              <>
              {/* Quota : affiché seulement s'il mord (≤ 1 résa possible pour la classe du créneau). */}
              {quotaStatus && quotaBites(quotaStatus, isOffPeak) && (
                <div style={{ marginTop: 16 }}>
                  <QuotaStatus status={quotaStatus} compact />
                </div>
              )}

              {/* Choix du mode de paiement — avenues mutuellement exclusives. */}
              <div style={{ marginTop: 20 }}>
                {sectionLabel('card', 'Mode de paiement')}
                {!showAvenues ? (() => {
                  // Ligne repliée : le moyen pré-choisi + sa conséquence, bouton « changer » si alternatives.
                  const selPkg = paySource ? sportPackages.find((p) => p.id === paySource) ?? null : null;
                  const online = !useSub && !selPkg && payMode === 'online' && onlineAvailable;
                  const icon: IconName = useSub ? 'bolt' : selPkg ? (selPkg.kind === 'ENTRIES' ? 'ticket' : 'wallet') : online ? 'card' : 'home';
                  const title = useSub ? 'Couvert par votre abonnement' : selPkg ? packageLabel(selPkg) : online ? 'Payer en ligne' : 'Régler au club';
                  const desc = useSub && cover ? `Votre part : ${perPerson}€ · ${coverageLabel(cover)}`
                    : selPkg ? `Après paiement : ${remainingAfterLabel(selPkg, totalEuros)}`
                    : online ? (onlineRequiredButUnavailable ? 'Paiement en ligne momentanément indisponible — contactez le club.'
                        : onlineShare ? `Votre part : ${perPerson}€ · ${totalPrice}€ ÷ ${capacity} joueurs` : `Montant : ${totalPrice}€`)
                    : requireCardFingerprint ? 'Empreinte de carte (protection no-show) · règlement sur place'
                    : 'Aucune carte enregistrée · vous réglez sur place';
                  return (
                    <div style={{ ...payCard(true), display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px' }}>
                      <span style={payTile(true)}><Icon name={icon} size={18} color={th.onAccent} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text }}>{title}</span>
                        <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 2 }}>{desc}</span>
                      </span>
                      {hasAlternatives && (
                        <button type="button" onClick={() => setPayExpanded(true)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, padding: 0, flex: '0 0 auto' }}>
                          changer
                        </button>
                      )}
                    </div>
                  );
                })() : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {/* Avenue 0 — couverture par abonnement (sélectionnée par défaut si le créneau est couvert). */}
                  {cover && (
                    <button type="button" onClick={() => { setUseSub(true); setPaySource(null); setPayMode('club'); }}
                      style={{ ...payCard(useSub), display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer', padding: '11px 13px' }}>
                      <span style={payTile(useSub)}><Icon name="bolt" size={18} color={useSub ? th.onAccent : th.accent} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text }}>Couvert par votre abonnement</span>
                        <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 2 }}>Votre part : {perPerson}€ · {coverageLabel(cover)}</span>
                      </span>
                      {useSub && checkBadge}
                    </button>
                  )}

                  {/* Avenue 1 — régler au club (caché si paiement en ligne imposé). Toute la carte est cliquable (pas seulement le titre). */}
                  {!requireOnlinePayment && (() => {
                    const sel = !useSub && payMode === 'club' && !paySource;
                    return (
                    <button type="button" onClick={() => { setUseSub(false); setPayMode('club'); setPaySource(null); }}
                      style={{ ...payCard(sel), display: 'flex', flexDirection: 'column', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '11px 13px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={payTile(sel)}><Icon name="home" size={18} color={sel ? th.onAccent : th.accent} /></span>
                        <span style={payTitle}>Régler au club</span>
                        {sel && checkBadge}
                      </span>
                      <span style={{ ...payDesc, display: 'block' }}>
                        {requireCardFingerprint
                          ? <>Le club enregistre une <b style={{ color: th.textMute }}>empreinte de votre carte</b> (protection no-show) ; le règlement se fait sur place.</>
                          : <>Vous réglez directement au club — <b style={{ color: th.textMute }}>aucune carte enregistrée</b>.</>}
                      </span>
                    </button>
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
                  {sportPackages.length > 0 && (() => {
                    const selPkg = paySource ? sportPackages.find((p) => p.id === paySource) ?? null : null;
                    return (
                    <div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {sportPackages.map((p) => {
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
                </div>) }
              </div>

              {/* Paiement en ligne : régler sa part ou toute la partie (courts multi-places).
                  Un abonnement, lui, ne couvre jamais que la part — pas de choix ici. */}
              {!useSub && !paySource && payMode === 'online' && onlineAvailable && !onlineRequiredButUnavailable && !shareTooSmall && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, marginBottom: 8 }}>Montant à régler en ligne</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([
                      { whole: false, label: 'Ma part', amt: `${perPerson}€`, sub: `${totalPrice}€ ÷ ${capacity} joueurs` },
                      { whole: true,  label: 'Toute la partie', amt: `${totalPrice}€`, sub: `pour ${capacity} joueurs` },
                    ] as const).map((opt) => {
                      const active = payWholeMatch === opt.whole;
                      return (
                        <button key={String(opt.whole)} type="button" aria-pressed={active}
                          onClick={() => setPayWholeMatch(opt.whole)}
                          style={{ flex: 1, textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '10px 12px',
                            border: `1.5px solid ${active ? th.accent : th.lineStrong}`, background: active ? `${th.accent}14` : th.surface,
                            transition: 'border-color .15s, background .15s' }}>
                          <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>{opt.label}</span>
                          <span style={{ display: 'block', fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: active ? th.accent : th.text, marginTop: 1 }}>{opt.amt}</span>
                          <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 1 }}>{opt.sub}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Conditions d'annulation — toujours affiché */}
              <CancellationNotice text={cancellationPolicyLabel(cancellationCutoffHours, refundOnCancelWithinCutoff ?? false)} th={th} />

              {errorMsg && (
                <div style={{ ...dangerBanner(th), marginTop: 14 }}>{errorMsg}</div>
              )}

              {/* Pied d'action : chemin Stripe → CGV puis formulaire Stripe DIRECT (ses propres
                  boutons « Annuler / Payer ») ; sinon rangée « Abandonner / Confirmer ». */}
              {cardPath ? (
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
                        // Remonte (donc recrée l'intent) si le type OU le montant part/total change,
                        // même après affichage du formulaire — l'intent est figé à sa création.
                        key={(payMode === 'online' && onlineAvailable) ? (onlineShare ? 'pay-share' : 'pay-full') : 'setup'}
                        type={(payMode === 'online' && onlineAvailable) ? 'payment' : 'setup'}
                        amountLabel={(payMode === 'online' && onlineAvailable) ? onlineAmountLabel : `${totalPrice}€`}
                        cgvAccepted={cgvAccepted}
                        createIntent={async () => {
                          const intentType = (payMode === 'online' && onlineAvailable) ? 'payment' : 'setup';
                          const r = await api.createStripeIntent(
                            slug ?? '',
                            { reservationId: reservation.id, type: intentType, payShare: intentType === 'payment' ? onlineShare : undefined },
                            token,
                          );
                          return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
                        }}
                        confirm={async (ids) => { await api.confirmReservation(reservation.id, token, { ...ids, cgvAccepted }); }}
                        onSuccess={() => {
                          settled.current = true;
                          setConfirmedInfo({
                            reservation,
                            summary: (payMode === 'online' && onlineAvailable) ? `Payée en ligne · ${onlineAmountLabel}` : 'À régler au club',
                          });
                          setPhase('confirmed');
                        }}
                        onCancel={handleClose} />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Acceptez les conditions pour continuer.</span>
                      <Btn variant="surface" onClick={handleClose} disabled={busy}>Abandonner</Btn>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', gap: 11, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
                  {/* Mobile : boutons empilés pleine largeur (le libellé du bouton principal
                      tient sur une ligne) ; desktop : rangée Abandonner / Confirmer. */}
                  <Btn variant="surface" onClick={handleClose} disabled={busy} style={isDesktop ? { flex: '0 0 38%' } : { width: '100%' }}>Abandonner</Btn>
                  <Btn icon="arrowR" onClick={handleConfirm}
                    disabled={phase !== 'held' || busy || (payMode === 'online' && onlineRequiredButUnavailable && !paySource)}
                    style={isDesktop ? { flex: 1 } : { width: '100%' }}>
                    {useSub ? 'Confirmer avec mon abonnement'
                      : paySource ? 'Confirmer avec mon solde'
                      : (payMode === 'online' && onlineAvailable) ? `Valider le paiement · ${onlineAmountLabel}`
                      : 'Confirmer la réservation'}
                  </Btn>
                </div>
              )}
              </>
              )}
            </>
          )}

          <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
        </div>
      </div>
    </div>
  );
}
