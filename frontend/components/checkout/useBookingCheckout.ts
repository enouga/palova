'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { TimeSlot, Reservation, MemberPackage, ClubMemberSearchResult, MyQuotaStatus, Subscription } from '@/lib/api';
import type { MatchPlayerData } from '@/components/match/MatchTeams';
import type { PickedMember } from '@/components/match/AddPlayerSheet';
import { HOLD_SECONDS, BOOKING_ERRORS } from '@/lib/bookingErrors';
import { paidWithLabel } from '@/lib/packages';
import { coveringSubscription } from '@/lib/subscriptions';
import { durationLabel } from '@/lib/duration';
import { capacityFor } from '@/lib/courtType';
import { cancellationPolicyLabel } from '@/lib/reservations';
import { hasAcceptedCgv, rememberCgvAccepted } from '@/lib/cgv';
import { loadLevelPref, saveLevelPref } from '@/lib/levelPrefs';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { sportHasLevels } from '@/lib/level';

export interface BookingCheckoutInput {
  slot: TimeSlot; resourceId: string; price: string; duration: number; token: string;
  timezone?: string; slug?: string; maxPlayers?: number; sportKey?: string; format?: string; resourceName?: string;
  packages?: MemberPackage[]; subscriptions?: Subscription[]; quotaStatus?: MyQuotaStatus | null;
  clubId?: string; requireOnlinePayment?: boolean; requireCardFingerprint?: boolean; hasCardOnFile?: boolean;
  stripeActive?: boolean; cancellationCutoffHours?: number; refundOnCancelWithinCutoff?: boolean;
  onConfirmed: (reservation: Reservation, paid?: { label: string }) => void;
  onExit: () => void;
}

export interface BookingCheckout {
  phase: 'holding' | 'held' | 'error';
  secondsLeft: number; mm: string; ss: string; urgent: boolean;
  reservation: Reservation | null; errorMsg: string; busy: boolean;
  totalPrice: string; totalEuros: number; perPerson: string; perPlayer: string;
  capacity: number; durLabel: string; onlineAmountLabel: string;
  showPartners: boolean; isPadel: boolean; me: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  partners: ClubMemberSearchResult[]; addPartner: (m: ClubMemberSearchResult) => void; removePartner: (id: string) => void;
  addPartnerTo: (m: PickedMember, team: 1 | 2, slot?: number) => void; buildPlayers: () => MatchPlayerData[];
  teamsDraft: Record<string, 1 | 2>; slotsDraft: Record<string, number>;
  setTeamsDraft: (t: Record<string, 1 | 2>) => void; setSlotsDraft: (s: Record<string, number>) => void;
  addTarget: { team: 1 | 2; slot?: number } | null; setAddTarget: (t: { team: 1 | 2; slot?: number } | null) => void;
  atCap: boolean; spotsLeft: number; cap: number; nbPlayers: number;
  visibility: 'PRIVATE' | 'PUBLIC'; setVisibility: (v: 'PRIVATE' | 'PUBLIC') => void; levelForSport: boolean;
  levelLimited: boolean; setLevelLimited: (v: boolean) => void; levelMin: number; levelMax: number; setLevel: (lo: number, hi: number) => void;
  cover: ReturnType<typeof import('@/lib/subscriptions').coveringSubscription>;
  useSub: boolean; setUseSub: (v: boolean) => void; payMode: 'club' | 'online'; setPayMode: (m: 'club' | 'online') => void;
  paySource: string | null; setPaySource: (id: string | null) => void; packages: MemberPackage[];
  onlineAvailable: boolean; onlineRequiredButUnavailable: boolean; onlineShare: boolean; requireOnlinePayment: boolean; requireCardFingerprint: boolean;
  cardPath: boolean; cgvAccepted: boolean; setCgvAccepted: (v: boolean) => void; cgvStatus: 'published' | 'fallback' | null;
  createStripeIntent: () => Promise<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null }>;
  stripeType: 'payment' | 'setup'; stripeAmountLabel: string;
  persistHoldSetup: () => Promise<void>; handleConfirm: () => Promise<void>; handleExit: () => Promise<void>;
  confirmLabel: string; quotaStatus?: MyQuotaStatus | null; cancellationText: string;
  slot: TimeSlot; timezone?: string; resourceName?: string; format?: string; slug?: string; token: string;
}

export function useBookingCheckout(input: BookingCheckoutInput): BookingCheckout {
  const {
    slot, resourceId, price, duration, token, timezone, slug, maxPlayers, sportKey, format, resourceName,
    packages = [], subscriptions = [], quotaStatus, onConfirmed, onExit,
    clubId, requireOnlinePayment, requireCardFingerprint, hasCardOnFile, stripeActive,
    cancellationCutoffHours, refundOnCancelWithinCutoff,
  } = input;

  const levelEnabled = useLevelSystemEnabled();
  // Le système de niveau (grille Padel Magazine) ne vaut que pour le padel.
  const levelForSport = levelEnabled && sportHasLevels(sportKey);

  const [phase, setPhase]             = useState<'holding' | 'held' | 'error'>('holding');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [errorMsg, setErrorMsg]       = useState('');
  const [busy, setBusy]               = useState(false); // confirm/applyHoldSetup en vol
  const didHold                       = useRef(false);   // garde anti double-hold (StrictMode)
  const settled                       = useRef(false);   // résa réglée (confirmée OU annulée par l'utilisateur) → ne pas (ré)annuler
  const reservationRef                = useRef<Reservation | null>(null); // dernière résa connue (même avant le setState)
  const closedRef                     = useRef(false);   // l'utilisateur a fermé (handleExit) — distinct du faux démontage StrictMode

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
  // Répartition d'équipes + places G/D (padel) proposée à la création : indice d'affichage
  // envoyé en best-effort via applyHoldSetup.teams/slots. `me` = organisateur (identité du préview).
  const [me, setMe] = useState<{ id: string; firstName: string; lastName: string; avatarUrl: string | null } | null>(null);
  const [teamsDraft, setTeamsDraft] = useState<Record<string, 1 | 2>>({});
  const [slotsDraft, setSlotsDraft] = useState<Record<string, number>>({});
  // Ajout ciblé depuis le terrain (padel) : place visée par la feuille d'ajout.
  const [addTarget, setAddTarget] = useState<{ team: 1 | 2; slot?: number } | null>(null);

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

  // ── Équipes (padel) ─────────────────────────────────────────────────────────
  // Côté le moins rempli : Équipe 1 tant qu'il reste de la place (capacity/2), sinon Équipe 2.
  const nextSide = (draft: Record<string, 1 | 2>): 1 | 2 => {
    const half = Math.max(1, Math.floor(capacity / 2));
    const c1 = Object.values(draft).filter((t) => t === 1).length;
    return c1 < half ? 1 : 2;
  };
  const addPartner = (m: ClubMemberSearchResult) => {
    setPartners((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
    setTeamsDraft((d) => (d[m.id] ? d : { ...d, [m.id]: nextSide(d) }));
  };
  // Ajout depuis la feuille : la place tapée impose l'équipe ET l'emplacement (pas de nextSide).
  const addPartnerTo = (m: PickedMember, team: 1 | 2, slot?: number) => {
    setPartners((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
    setTeamsDraft((d) => ({ ...d, [m.id]: team }));
    if (slot != null) setSlotsDraft((d) => ({ ...d, [m.id]: slot }));
  };
  const removePartner = (id: string) => {
    setPartners((xs) => xs.filter((x) => x.id !== id));
    setTeamsDraft((d) => { const n = { ...d }; delete n[id]; return n; });
    setSlotsDraft((d) => { const n = { ...d }; delete n[id]; return n; });
  };
  // [organisateur, …partenaires] pour l'aperçu d'équipes (padel). Vide tant que `me` inconnu.
  const buildPlayers = (): MatchPlayerData[] => {
    if (!me) return [];
    return [
      { userId: me.id, firstName: me.firstName, lastName: me.lastName, avatarUrl: me.avatarUrl, isOrganizer: true, team: (teamsDraft[me.id] ?? 1) as 1 | 2, slot: slotsDraft[me.id] },
      ...partners.map((p) => ({ userId: p.id, firstName: p.firstName, lastName: p.lastName, level: p.level, team: (teamsDraft[p.id] ?? 1) as 1 | 2, slot: slotsDraft[p.id] })),
    ];
  };
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
  // (posé par handleExit), jamais par le faux démontage de StrictMode.
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
        // Timer résumé depuis createdAt (pas remis à HOLD_SECONDS) : une page rafraîchie
        // reprend où elle en était plutôt que de relancer le compte à rebours complet.
        const elapsed = Math.min(HOLD_SECONDS, Math.max(0, Math.floor((Date.now() - Date.parse(res.createdAt)) / 1000)));
        setSecondsLeft(HOLD_SECONDS - elapsed);
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
    if (!showPartners || !levelForSport) return;
    const clamp = (v: number) => Math.max(1, Math.min(8, Math.round(v * 10) / 10));
    const pref = loadLevelPref();
    if (pref) { setLevelLimited(pref.enabled); setLevelMin(pref.min); setLevelMax(pref.max); }
    if (!token) return;
    if (pref) return; // choix mémorisé prioritaire : pas besoin du niveau pour le défaut
    api.getMyRating(token, sportKey).then((r) => {
      const lvl = r?.level ?? null;
      if (lvl != null) { setLevelMin(clamp(lvl - 1)); setLevelMax(clamp(lvl + 1)); }
    }).catch(() => {});
  }, [showPartners, token, levelForSport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Identité de l'organisateur (padel multi-joueurs) : sert d'ancre à l'aperçu d'équipes.
  // Best-effort — un échec laisse l'affichage sur les pastilles partenaires classiques.
  useEffect(() => {
    if (!showPartners || !isPadel || !token) return;
    let alive = true;
    api.getMyProfile(token)
      .then((p) => { if (alive) setMe({ id: p.id, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [showPartners, isPadel, token]);

  // L'organisateur occupe l'Équipe 1, place G, par défaut dès que son identité est connue.
  useEffect(() => {
    if (!me) return;
    setTeamsDraft((d) => (d[me.id] ? d : { ...d, [me.id]: 1 }));
    setSlotsDraft((d) => (d[me.id] != null ? d : { ...d, [me.id]: 0 }));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Persiste partenaires / visibilité / niveau sur la réservation PENDING (terrain multi-joueurs),
  // avant la confirmation — directe (club/abo/carnet) OU Stripe (via beforeSubmit) — pour que les
  // joueurs soient enregistrés quel que soit le confirmeur (client OU webhook), sans course.
  const persistHoldSetup = async () => {
    if (!showPartners || !reservation) return;
    const limiting = visibility === 'PUBLIC' && levelForSport && levelLimited;
    await api.applyHoldSetup(reservation.id, token, {
      partnerUserIds: partners.map((p) => p.id),
      visibility,
      ...(visibility === 'PUBLIC' && levelForSport
        ? { targetLevelMin: limiting ? levelMin : null, targetLevelMax: limiting ? levelMax : null }
        : {}),
      // Padel : indice de composition d'équipes + places G/D (best-effort côté serveur).
      ...(isPadel ? { teams: teamsDraft, slots: slotsDraft } : {}),
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
      const usedPkg = paySource ? packages.find((p) => p.id === paySource) ?? null : null;
      const confirmed = await api.confirmReservation(
        reservation.id, token, paymentSource ? { paymentSource } : undefined,
      );
      settled.current = true; // réservation confirmée → le cleanup ne doit pas l'annuler
      onConfirmed(confirmed, usedPkg ? { label: paidWithLabel(usedPkg, totalEuros) } : undefined);
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

  const handleExit = async () => {
    // closedRef signale aux effets que l'utilisateur a fermé (≠ faux démontage StrictMode).
    // Si le hold est déjà posé, on l'annule ici ; s'il arrive APRÈS (fermeture pendant le
    // blocage), l'effet de montage le libère via closedRef.
    closedRef.current = true;
    const r = reservation ?? reservationRef.current;
    if (r && !settled.current) {
      settled.current = true;
      try { await api.cancelReservation(r.id, token); } catch { /* cleanup job récupèrera */ }
    }
    onExit();
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  // Type/montant de l'intent Stripe (miroir de la bascule inline dans <StripePaymentStep>).
  const stripeType: 'payment' | 'setup' = (payMode === 'online' && onlineAvailable) ? 'payment' : 'setup';
  const stripeAmountLabel = stripeType === 'payment' ? onlineAmountLabel : `${totalPrice}€`;

  const createStripeIntent = async () => {
    const intentType = stripeType;
    const r = await api.createStripeIntent(
      slug ?? '',
      { reservationId: reservation!.id, type: intentType, payShare: intentType === 'payment' ? onlineShare : undefined },
      token,
    );
    return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
  };

  const setLevel = (lo: number, hi: number) => { setLevelMin(lo); setLevelMax(hi); };

  const cancellationText = cancellationPolicyLabel(cancellationCutoffHours, refundOnCancelWithinCutoff ?? false);

  const confirmLabel = useSub ? 'Confirmer avec mon abonnement'
    : paySource ? 'Confirmer avec mon solde'
    : (payMode === 'online' && onlineAvailable) ? `Valider le paiement · ${onlineAmountLabel}`
    : 'Confirmer la réservation';

  return {
    phase, secondsLeft, mm, ss, urgent,
    reservation, errorMsg, busy,
    totalPrice, totalEuros, perPerson, perPlayer,
    capacity, durLabel, onlineAmountLabel,
    showPartners, isPadel, me,
    partners, addPartner, removePartner,
    addPartnerTo, buildPlayers,
    teamsDraft, slotsDraft, setTeamsDraft, setSlotsDraft,
    addTarget, setAddTarget,
    atCap, spotsLeft, cap, nbPlayers,
    visibility, setVisibility, levelForSport,
    levelLimited, setLevelLimited, levelMin, levelMax, setLevel,
    cover,
    useSub, setUseSub, payMode, setPayMode,
    paySource, setPaySource, packages,
    onlineAvailable, onlineRequiredButUnavailable, onlineShare,
    requireOnlinePayment: !!requireOnlinePayment, requireCardFingerprint: !!requireCardFingerprint,
    cardPath, cgvAccepted, setCgvAccepted, cgvStatus,
    createStripeIntent, stripeType, stripeAmountLabel,
    persistHoldSetup, handleConfirm, handleExit,
    confirmLabel, quotaStatus, cancellationText,
    slot, timezone, resourceName, format, slug, token,
  };
}
