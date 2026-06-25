'use client';
import { useState, useEffect, useRef, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { api, TimeSlot, Reservation, MemberPackage, ClubMemberSearchResult, MyQuotaStatus, Subscription } from '@/lib/api';
import { packageLabel, canCover } from '@/lib/packages';
import { coveringSubscription, coverageLabel } from '@/lib/subscriptions';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, Theme } from '@/lib/theme';
import { durationLabel } from '@/lib/duration';
import { Btn, Segmented } from '@/components/ui/atoms';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { LevelChip } from '@/components/player/LevelChip';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { QuotaStatus } from '@/components/quota/QuotaStatus';
import { loadLevelPref, saveLevelPref } from '@/lib/levelPrefs';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { capacityFor, courtFormat } from '@/lib/courtType';
import { cancellationPolicyLabel } from '@/lib/reservations';
import { Icon, IconName } from '@/components/ui/Icon';

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
  onConfirmed: (reservation: Reservation) => void;
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
        <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
          <span style={{ width: 44, height: 44, flex: '0 0 auto', borderRadius: 13, background: `${th.accent}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ball" size={24} color={th.accent} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: th.fontDisplay, fontSize: 21, fontWeight: 700, letterSpacing: -0.4, color: th.text }}>{resourceName ?? 'Court'}</span>
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: th.textMute, border: `1px solid ${th.lineStrong}`, background: th.bgElev, borderRadius: 999, padding: '2px 9px' }}>{courtFormat(format) ?? 'Double'}</span>
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, marginTop: 8, textTransform: 'capitalize' }}>{dateLabel}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Icon name="clock" size={13} color={th.textFaint} />
              {formatHour(slot.startTime, timezone)} → {formatHour(slot.endTime, timezone)} · {durLabel}
              {slot.offPeak && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fde9c8', borderRadius: 6, padding: '2px 7px' }}>
                  <Icon name="moon" size={10} color="#b45309" />heures creuses
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontFamily: th.fontDisplay, fontSize: 34, fontWeight: 800, letterSpacing: -1.3, color: th.text, lineHeight: 0.95 }}>{totalPrice}€</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 5 }}>≈ {perPerson} € / pers · {capacity} j.</div>
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
  const levelEnabled = useLevelSystemEnabled();

  const [phase, setPhase]             = useState<'holding' | 'held' | 'error'>('holding');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [errorMsg, setErrorMsg]       = useState('');
  const [busy, setBusy]               = useState(false); // confirm/applyHoldSetup en vol
  const didHold                       = useRef(false);   // garde anti double-hold (StrictMode)
  const settled                       = useRef(false);   // résa réglée (confirmée OU annulée par l'utilisateur) → ne pas (ré)annuler
  const reservationRef                = useRef<Reservation | null>(null); // dernière résa connue (même avant le setState)
  const closedRef                     = useRef(false);   // l'utilisateur a fermé (handleClose) — distinct du faux démontage StrictMode

  const [paySource, setPaySource]     = useState<string | null>(null); // id du package choisi, null = pas de carnet
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
  const [partners, setPartners]       = useState<ClubMemberSearchResult[]>([]);
  const [visibility, setVisibility]   = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  // Fourchette de niveau d'une partie ouverte : interrupteur + curseur double, mémorisés.
  // Limite ACTIVE par défaut (sauf si un choix mémorisé dit le contraire).
  const [levelLimited, setLevelLimited] = useState(true);
  const [levelMin, setLevelMin] = useState(3);
  const [levelMax, setLevelMax] = useState(5);

  // Multi-joueurs : ajout de partenaires + partie publique/privée.
  const cap = maxPlayers ?? 1;
  const showPartners = !!slug && cap > 1;
  // Parties ouvertes = padel uniquement → l'option « Partie ouverte » n'est offerte que sur un court padel.
  const isPadel = sportKey === 'padel';
  const nbPlayers = 1 + partners.length;
  const atCap = nbPlayers >= cap;
  const spotsLeft = Math.max(0, cap - nbPlayers);
  const euros = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ','));

  // Prix du créneau calculé par le backend (slot.price : tarif creux ssi
  // entièrement en heures creuses) ; repli sur le prix du terrain.
  const totalCents = Math.round(Number(slot.price ?? price) * 100);
  const totalEuros = totalCents / 100;
  const totalPrice = totalCents % 100 === 0 ? String(totalCents / 100) : (totalCents / 100).toFixed(2).replace('.', ',');
  const perPlayer = euros(Math.floor(totalCents / nbPlayers));
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
  // En ligne : toujours la part par personne (sauf si trop faible → total).
  const onlineShare = !shareTooSmall;
  const onlineAmountLabel = onlineShare ? `${perPerson}€` : `${totalPrice}€`;

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

  // Pré-remplissage de la fourchette de niveau : dernier choix mémorisé, sinon
  // défaut centré sur mon niveau ±1 (borné 1–8), interrupteur OFF (ouvert à tous).
  useEffect(() => {
    if (!showPartners || !levelEnabled) return;
    const clamp = (v: number) => Math.max(1, Math.min(8, Math.round(v * 10) / 10));
    const pref = loadLevelPref();
    if (pref) { setLevelLimited(pref.enabled); setLevelMin(pref.min); setLevelMax(pref.max); }
    if (!token) return;
    if (pref) return; // choix mémorisé prioritaire : pas besoin du niveau pour le défaut
    api.getMyRating(token, sportKey).then((r) => {
      const lvl = r?.level ?? null;
      if (lvl != null) { setLevelMin(clamp(lvl - 1)); setLevelMax(clamp(lvl + 1)); }
    }).catch(() => {});
  }, [showPartners, token, levelEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abonnement couvrant : sélectionné par défaut dès qu'il existe (le joueur peut le désélectionner
  // en choisissant un autre mode de paiement). Réinitialise quand l'abo couvrant change.
  useEffect(() => {
    setUseSub(!!cover);
  }, [cover?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Persiste partenaires / visibilité / niveau sur la réservation PENDING (terrain multi-joueurs),
  // avant la confirmation — directe (club/abo/carnet) OU Stripe (via beforeSubmit) — pour que les
  // joueurs soient enregistrés quel que soit le confirmeur (client OU webhook), sans course.
  const persistHoldSetup = async () => {
    if (!showPartners || !reservation) return;
    const limiting = visibility === 'PUBLIC' && levelEnabled && levelLimited;
    await api.applyHoldSetup(reservation.id, token, {
      partnerUserIds: partners.map((p) => p.id),
      visibility,
      ...(visibility === 'PUBLIC' && levelEnabled
        ? { targetLevelMin: limiting ? levelMin : null, targetLevelMax: limiting ? levelMax : null }
        : {}),
    });
    saveLevelPref({ enabled: levelLimited, min: levelMin, max: levelMax });
  };

  const handleConfirm = async () => {
    if (!reservation || busy) return;
    setBusy(true);
    setErrorMsg('');
    try {
      await persistHoldSetup();
      // Source de paiement : abonnement couvrant prioritaire, sinon carnet, sinon rien (régler au club).
      const paymentSource = useSub && cover ? { subscriptionId: cover.id }
        : paySource ? { packageId: paySource } : undefined;
      const confirmed = await api.confirmReservation(
        reservation.id, token, paymentSource ? { paymentSource } : undefined,
      );
      settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
      onConfirmed(confirmed);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'INSUFFICIENT_BALANCE') { setPaySource(null); setErrorMsg('Solde insuffisant — réglez au club.'); return; }
      if (msg === 'CARD_FINGERPRINT_REQUIRED') { setFingerprintForced(true); setPaySource(null); setErrorMsg(BOOKING_ERRORS.CARD_FINGERPRINT_REQUIRED); return; }
      if (BOOKING_ERRORS[msg] && msg !== 'SLOT_NO_LONGER_AVAILABLE') { setErrorMsg(BOOKING_ERRORS[msg]); return; }
      setPhase('error');
      setErrorMsg(msg === 'SLOT_NO_LONGER_AVAILABLE' ? 'Ce créneau a été pris entre-temps. Veuillez recommencer.' : (BOOKING_ERRORS[msg] ?? msg));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    // closedRef signale aux effets que l'utilisateur a fermé (≠ faux démontage StrictMode).
    // Si le hold est déjà posé, on l'annule ici ; s'il arrive APRÈS (fermeture pendant le
    // blocage), l'effet de montage le libère via closedRef.
    closedRef.current = true;
    const r = reservation ?? reservationRef.current;
    if (r && !settled.current) {
      settled.current = true;
      try { await api.cancelReservation(r.id, token); } catch { /* cleanup job récupèrera */ }
    }
    onClose();
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
      <div onClick={handleClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '100dvh', overflowY: 'auto', background: th.bgElev, borderRadius: '0 0 28px 28px', boxShadow: '0 14px 50px rgba(0,0,0,0.34)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        {/* Barre de timer fine (cachée en phase error) */}
        {phase !== 'error' && (
          <div style={{ height: 4, background: th.surface2 }}>
            <div style={{ height: '100%', width: `${(secondsLeft / HOLD_SECONDS) * 100}%`, background: urgent ? ACCENTS.coral : th.accent, transition: 'width 1s linear' }} />
          </div>
        )}
        <div style={{ padding: '16px 20px 30px' }}>

          {phase === 'error' ? (
            <>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.onAccent, background: th.accent, padding: '12px 14px', borderRadius: 12, fontWeight: 600 }}>{errorMsg}</div>
              <div style={{ marginTop: 14 }}><Btn full variant="surface" onClick={onClose}>Fermer</Btn></div>
            </>
          ) : (
            <>
              {/* En-tête : pill « créneau bloqué » + chip timer */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
                  color: phase === 'held' ? '#15803d' : th.textMute, background: phase === 'held' ? 'rgba(34,197,94,0.13)' : th.surface2, borderRadius: 999, padding: '5px 12px 5px 10px' }}>
                  {phase === 'held'
                    ? <><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px #22c55e2e' }} />Créneau bloqué pour vous</>
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
              {/* Joueurs / visibilité / niveau — terrain multi-joueurs */}
              {showPartners && (
                <div style={{ marginTop: 20 }}>
                  {sectionLabel('users', <>Partenaires <span style={{ color: th.textFaint, fontWeight: 600 }}>· membres du club</span></>)}
                  {partners.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {partners.map((p) => {
                        const c = colorForSeed(p.id);
                        return (
                        <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: `${c}22`, border: `1px solid ${c}`, borderRadius: 999, padding: '4px 10px 4px 4px' }}>
                          <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={24} color={c} />
                          <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text }}>{p.firstName} {p.lastName}</span>
                          <LevelChip level={p.level} size="xs" />
                          <button type="button" onClick={() => setPartners((xs) => xs.filter((x) => x.id !== p.id))} aria-label={`Retirer ${p.firstName} ${p.lastName}`}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 17, lineHeight: 1, padding: 0 }}>×</button>
                        </span>
                        );
                      })}
                    </div>
                  )}
                  {atCap ? (
                    <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Terrain complet ({cap} joueurs).</div>
                  ) : (
                    <PartnerSearch slug={slug!} token={token} selected={null}
                      excludeIds={partners.map((p) => p.id)} keepOpenOnSelect
                      onSelect={(m) => setPartners((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]))}
                      onClear={() => {}} />
                  )}

                  {isPadel && (
                  <div style={{ marginTop: 14 }}>
                    <Segmented<'PRIVATE' | 'PUBLIC'> value={visibility} onChange={setVisibility}
                      options={[{ value: 'PRIVATE', label: 'Partie privée' }, { value: 'PUBLIC', label: 'Partie ouverte' }]} />
                    <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>
                      {visibility === 'PUBLIC'
                        ? `Visible par les membres du club, qui peuvent rejoindre (${spotsLeft} place${spotsLeft > 1 ? 's' : ''} restante${spotsLeft > 1 ? 's' : ''}).`
                        : 'Visible uniquement par vous et vos partenaires.'}
                    </div>

                    {visibility === 'PUBLIC' && levelEnabled && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, fontWeight: 600 }}>Limiter le niveau des joueurs</span>
                          <button type="button" role="switch" aria-checked={levelLimited} aria-label="Limiter le niveau"
                            onClick={() => setLevelLimited((v) => !v)}
                            style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 0, position: 'relative', background: levelLimited ? th.accent : th.lineStrong, transition: 'background .15s' }}>
                            <span style={{ position: 'absolute', top: 3, left: levelLimited ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                          </button>
                        </div>
                        {levelLimited && (
                          <div style={{ marginTop: 14 }}>
                            <LevelRangeSlider min={levelMin} max={levelMax}
                              onChange={(lo, hi) => { setLevelMin(lo); setLevelMax(hi); }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {nbPlayers > 1 && (
                    <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '7px 11px' }}>
                      <Icon name="users" size={14} color={th.textMute} />≈ {perPlayer} € par joueur ({nbPlayers} joueurs)
                    </div>
                  )}
                </div>
              )}

              {/* Quota (compteur du joueur) */}
              {quotaStatus && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                  <QuotaStatus status={quotaStatus} />
                </div>
              )}

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
                  {packages.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {packages.map((p) => {
                        const ok = canCover(p, totalEuros);
                        const sel = paySource === p.id;
                        return (
                          <button key={p.id} type="button" disabled={!ok} onClick={() => { setUseSub(false); setPaySource(p.id); setPayMode('club'); }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1.5px solid ${sel ? th.accent : th.lineStrong}`, background: sel ? `${th.accent}14` : th.surface, borderRadius: 12, padding: '9px 12px', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                            <Icon name="ticket" size={15} color={sel ? th.accent : th.textMute} />
                            {packageLabel(p)}
                            {sel && <Icon name="check" size={13} color={th.accent} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Conditions d'annulation — toujours affiché */}
              <CancellationNotice text={cancellationPolicyLabel(cancellationCutoffHours, refundOnCancelWithinCutoff ?? false)} th={th} />

              {errorMsg && (
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.onAccent, background: th.accent, padding: '8px 12px', borderRadius: 10, fontWeight: 600, marginTop: 14 }}>{errorMsg}</div>
              )}

              {/* Pied d'action : chemin Stripe → CGV puis formulaire Stripe DIRECT (ses propres
                  boutons « Annuler / Payer ») ; sinon rangée « Abandonner / Confirmer ». */}
              {cardPath ? (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
                  {/* CGV — requise avant tout intent CB ; cocher révèle le formulaire Stripe. */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={cgvAccepted} onChange={(e) => setCgvAccepted(e.target.checked)}
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
                        type={(payMode === 'online' && onlineAvailable) ? 'payment' : 'setup'}
                        amountLabel={(payMode === 'online' && onlineAvailable) ? onlineAmountLabel : `${totalPrice}€`}
                        cgvAccepted={cgvAccepted} beforeSubmit={persistHoldSetup}
                        createIntent={async () => {
                          const intentType = (payMode === 'online' && onlineAvailable) ? 'payment' : 'setup';
                          const r = await api.createStripeIntent(
                            slug ?? '',
                            { reservationId: reservation.id, type: intentType, payShare: intentType === 'payment' ? onlineShare : undefined },
                            token,
                          );
                          return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null };
                        }}
                        confirm={async (ids) => { await api.confirmReservation(reservation.id, token, { ...ids, cgvAccepted }); }}
                        onSuccess={() => { settled.current = true; onConfirmed(reservation); }}
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
                <div style={{ display: 'flex', gap: 11, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
                  <Btn variant="surface" onClick={handleClose} disabled={busy} style={{ flex: '0 0 38%' }}>Abandonner</Btn>
                  <Btn icon="arrowR" onClick={handleConfirm}
                    disabled={phase !== 'held' || busy || (payMode === 'online' && onlineRequiredButUnavailable && !paySource)}
                    style={{ flex: 1 }}>
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
