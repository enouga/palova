'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ClubDetail, ClubAvailability, TimeSlot, MemberPackage, MyQuotaStatus, Subscription } from '@/lib/api';
import { packageLabel } from '@/lib/packages';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { coverageType, courtFormat, SINGLE_COLOR, playerCount, LIGHTING_BADGE } from '@/lib/courtType';
import { effectiveDurations, defaultDuration, durationLabel } from '@/lib/duration';
import { Screen } from '@/components/ui/Screen';
import { Chip, Placeholder, PillTabs } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import BookingModal from '@/components/BookingModal';
import DateSelector from '@/components/DateSelector';
import { bookingWindow } from '@/lib/bookingWindow';
import { ClubNav } from '@/components/ClubNav';
import { QuotaStatus } from '@/components/quota/QuotaStatus';
import { SportPicker } from '@/components/reserve/SportPicker';

function todayISO(): string { return new Date().toISOString().slice(0, 10); }


function formatHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// Expérience de réservation du club — rendue sur /reserver (la racine du sous-domaine affiche le Club-house).
// Coiffée par la barre de nav club (ClubNav) ; onglet interne « réserver » / « terrains ».
export function ClubReserve({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready: authReady } = useAuth();
  const [tab, setTab]           = useState<'book' | 'courts'>('book');
  // Sélection multi-sports (ids de clubSport, ordre du club). null = pas encore résolue
  // (on évite d'afficher le mauvais sport le temps de lire le profil). Jamais vide une fois résolue.
  const SPORTS_KEY = `palova:reserve-sports:${club.id}`;
  // Club mono-sport : on résout tout de suite (pas de localStorage/profil à attendre,
  // pure dérivation des props → sûr pour l'hydratation). Multi-sport : null → résolu par l'effet.
  const [selectedSportIds, setSelectedSportIds] = useState<string[] | null>(
    () => (club.clubSports.length === 1 && club.clubSports[0]?.id ? [club.clubSports[0].id] : null),
  );
  // Persiste un changement manuel (l'utilisateur a coché/décoché) et le mémorise par club.
  const changeSports = (ids: string[]) => {
    setSelectedSportIds(ids);
    try { localStorage.setItem(SPORTS_KEY, JSON.stringify(ids)); } catch { /* localStorage indispo */ }
  };
  const [date, setDate]         = useState(todayISO());
  // Durée choisie PAR sport (clé = clubSport.id) : chaque sport propose ses propres durées.
  const [durationBySport, setDurationBySport] = useState<Record<string, number>>(
    () => Object.fromEntries(club.clubSports.map((cs) => [cs.id, defaultDuration(effectiveDurations(cs.durationsMin, cs.sport.defaultDurationsMin))])),
  );
  const [availBySport, setAvailBySport]     = useState<Record<string, ClubAvailability[]>>({});
  const [loadingBySport, setLoadingBySport] = useState<Record<string, boolean>>({});
  const [booking, setBooking]   = useState<{ resourceId: string; price: string; slot: TimeSlot; duration: number; format?: string; sportKey?: string; resourceName?: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isSub, setIsSub]       = useState(false);
  // Lien profond depuis le Club-house : ?resource=<id>&start=<ISO> pré-ouvre la confirmation.
  const [deepSlot, setDeepSlot] = useState<{ resourceId: string; start: string } | null>(null);
  // Soldes prépayés du joueur sur ce club (chips + option de paiement à la confirmation).
  const [myPackages, setMyPackages] = useState<MemberPackage[]>([]);
  // Le club a-t-il déjà la carte du joueur (empreinte no-show) → pas de réenregistrement.
  const [hasCardOnFile, setHasCardOnFile] = useState(false);
  // Abonnements actifs du joueur sur ce club (chip « Abonné » + couverture à la confirmation).
  const [mySubs, setMySubs] = useState<Subscription[]>([]);
  // État des quotas de réservation du joueur (compteur « 3/5 ») — null si pas de quota.
  const [quotaStatus, setQuotaStatus] = useState<MyQuotaStatus | null>(null);
  const refreshQuota = useCallback(() => {
    if (!token) { setQuotaStatus(null); return; }
    api.getMyQuotaStatus(club.slug, token).then(setQuotaStatus).catch(() => setQuotaStatus(null));
  }, [token, club.slug]);
  // Ref des durées courantes : l'effet [date] recharge chaque sport à SA durée sans relancer
  // tous les sports quand une seule durée change.
  const durationsRef = useRef(durationBySport);
  durationsRef.current = durationBySport;

  const windowDays  = isSub ? club.memberBookingDays : club.publicBookingDays;
  const releaseHour = isSub ? club.memberReleaseHour : club.publicReleaseHour;
  const win = bookingWindow(new Date(), club.timezone, windowDays, club.bookingReleaseMode, releaseHour);
  const nowMs = Date.now(); // masque les créneaux du jour déjà commencés

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('tab') === 'courts') setTab('courts');
    const resource = p.get('resource'); const start = p.get('start');
    if (resource && start && !isNaN(new Date(start).getTime())) {
      setDeepSlot({ resourceId: resource, start });
      setDate(start.slice(0, 10));
    }
  }, []);

  // Statut d'abonné en lecture seule : l'abonnement est attribué par le club
  // (back-office). Sert à connaître la fenêtre de réservation du joueur.
  useEffect(() => {
    if (!token) { setIsSub(false); return; }
    api.getMyMemberships(token).then((ms) => setIsSub(ms.some((m) => m.clubId === club.id && m.isSubscriber))).catch(() => {});
  }, [token, club.id]);

  useEffect(() => {
    if (!token) { setMyPackages([]); setHasCardOnFile(false); return; }
    api.getMyClubPackages(club.slug, token).then(setMyPackages).catch(() => setMyPackages([]));
    api.getMyCardStatus(club.slug, token).then((s) => setHasCardOnFile(s.hasCardOnFile)).catch(() => {});
  }, [token, club.slug]);

  useEffect(() => {
    if (!token) { setMySubs([]); return; }
    api.getMyClubSubscriptions(club.slug, token).then(setMySubs).catch(() => setMySubs([]));
  }, [token, club.slug]);

  useEffect(() => { refreshQuota(); }, [refreshQuota]);

  // Résolution de la sélection initiale, sans saut (client only → pas de mismatch d'hydratation) :
  // 1) localStorage (ids encore proposés) → 2) sport préféré si connecté → 3) clubSports[0].
  // On attend que authReady soit true pour connaître le token définitif avant de résoudre.
  useEffect(() => {
    if (selectedSportIds !== null) return; // déjà résolu
    if (!authReady) return; // attendre que le cookie ait été lu
    const valid = (ids: string[]) => ids.filter((id) => club.clubSports.some((cs) => cs.id === id));
    try {
      const raw = localStorage.getItem(SPORTS_KEY);
      if (raw) { const ids = valid(JSON.parse(raw)); if (ids.length) { setSelectedSportIds(ids); return; } }
    } catch { /* localStorage indispo */ }
    const fallback = club.clubSports[0]?.id ? [club.clubSports[0].id] : [];
    if (token) {
      api.getMyProfile(token).then((p) => {
        const match = club.clubSports.find((cs) => cs.sport.key === p.preferredSport?.key);
        setSelectedSportIds(match ? [match.id] : fallback);
      }).catch(() => setSelectedSportIds(fallback));
    } else {
      setSelectedSportIds(fallback);
    }
  }, [token, authReady, club.clubSports, SPORTS_KEY, selectedSportIds]);

  const loadSport = useCallback(async (clubSportId: string, dur: number, dateArg: string) => {
    setLoadingBySport((s) => ({ ...s, [clubSportId]: true }));
    try { const a = await api.getClubAvailability(club.slug, dateArg, dur, clubSportId); setAvailBySport((s) => ({ ...s, [clubSportId]: a })); }
    catch { setAvailBySport((s) => ({ ...s, [clubSportId]: [] })); }
    finally { setLoadingBySport((s) => ({ ...s, [clubSportId]: false })); }
  }, [club.slug]);

  const reloadAll = useCallback(() => {
    for (const cs of club.clubSports) loadSport(cs.id, durationsRef.current[cs.id], date);
  }, [club.clubSports, loadSport, date]);

  useEffect(() => { if (tab === 'book') reloadAll(); }, [tab, reloadAll]);

  const changeDuration = (clubSportId: string, dur: number) => {
    setDurationBySport((s) => ({ ...s, [clubSportId]: dur }));
    loadSport(clubSportId, dur, date);
  };

  // Consomme le lien profond dès que la section du sport du terrain est chargée : créneau
  // encore libre → pré-ouvre la confirmation (à la durée du sport) ; sinon page normale.
  useEffect(() => {
    if (!deepSlot || !token) return;
    for (const cs of club.clubSports) {
      const res = (availBySport[cs.id] ?? []).find((a) => a.resource.id === deepSlot.resourceId);
      const slot = res?.slots.find((s) => s.startTime === deepSlot.start && s.available);
      if (res && slot) {
        // ajoute le sport du créneau ciblé à la sélection courante (sans l'écraser) pour le rendre visible
        setSelectedSportIds((cur) => (cur && cur.includes(cs.id)) ? cur : [...(cur ?? []), cs.id]);
        setBooking({ resourceId: res.resource.id, price: slot.price, slot, duration: durationBySport[cs.id], format: typeof res.resource.attributes?.format === 'string' ? res.resource.attributes.format : undefined, sportKey: cs.sport.key, resourceName: res.resource.name });
        setDeepSlot(null);
        return;
      }
    }
  }, [deepSlot, availBySport, token, club.clubSports, durationBySport]);

  const onSlot = (resourceId: string, price: string, slot: TimeSlot, duration: number, format?: string, sportKey?: string, resourceName?: string) => {
    if (!token) { router.push('/login'); return; }
    setBooking({ resourceId, price, slot, duration, format, sportKey, resourceName });
  };

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        {club.description && (
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, lineHeight: 1.5, margin: '16px 20px 0' }}>{club.description}</p>
        )}

        {(myPackages.length > 0 || mySubs.length > 0) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 20px 0' }}>
            {myPackages.map((p) => (
              <Chip key={p.id}>{packageLabel(p)}</Chip>
            ))}
            {mySubs.map((s) => (
              <Chip key={s.id} tone="accent" icon="check">Abonné {s.sportKeys.join('/')}{s.offPeakOnly ? ' · heures creuses' : ''}</Chip>
            ))}
          </div>
        )}

        {quotaStatus && (
          <div style={{ margin: '14px 20px 0' }}>
            <QuotaStatus status={quotaStatus} />
          </div>
        )}

        {confirmed && (
          <div style={{ margin: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 10, background: th.accent, color: th.onAccent, borderRadius: 14, padding: '12px 14px' }}>
            <Icon name="check" size={18} color={th.onAccent} stroke={2.4} />
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Réservation confirmée !</span>
          </div>
        )}

        {tab === 'book' ? (
          <>
            {/* sélecteur de dates — bande défilante (cellules confortables, swipe horizontal) */}
            <div style={{ padding: '18px 20px 4px' }}>
              <DateSelector value={date} onChange={setDate} days={7} maxKey={win.maxDayKey} />
            </div>

            {/* sélecteur de sport discret — affiché seulement si le club propose plusieurs sports */}
            {club.clubSports.length > 1 && selectedSportIds !== null && (
              <div style={{ padding: '12px 20px 0' }}>
                <SportPicker
                  sports={club.clubSports.map((cs) => ({ id: cs.id, name: cs.sport.name, icon: cs.sport.icon }))}
                  selectedIds={selectedSportIds}
                  onChange={changeSports}
                />
              </div>
            )}
            {/* grille : une section par sport sélectionné — durée propre + terrains + créneaux libres */}
            <div style={{ padding: '8px 20px 0' }}>
              {selectedSportIds === null && (
                <div style={{ padding: '20px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
              )}
              {selectedSportIds !== null && club.clubSports.filter((cs) => selectedSportIds.includes(cs.id)).map((cs) => {
                const durations = effectiveDurations(cs.durationsMin, cs.sport.defaultDurationsMin);
                const selDur = durationBySport[cs.id];
                const items = availBySport[cs.id];
                const loading = loadingBySport[cs.id];
                return (
                  <div key={cs.id} style={{ marginTop: 14 }}>
                    {/* titre de section : si plusieurs sports affichés (pour les distinguer) ou club mono-sport (cosmétique) */}
                    {(selectedSportIds.length > 1 || club.clubSports.length === 1) && (
                      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10 }}>{cs.sport.icon ? `${cs.sport.icon} ` : ''}{cs.sport.name}</div>
                    )}
                    {durations.length > 1 && (
                      <div style={{ marginBottom: 12 }}>
                        <PillTabs<number> size="sm" activeBg={th.text} value={selDur} onChange={(d) => changeDuration(cs.id, d)} options={durations.map((d) => ({ value: d, label: durationLabel(d) }))} />
                      </div>
                    )}
                    {items === undefined ? (
                      <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
                    ) : items.length === 0 ? (
                      <div style={{ padding: '12px 0 4px', fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Aucun terrain.</div>
                    ) : (
                    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {items.map(({ resource, slots }) => {
                        const ct = coverageType(resource.attributes?.coverage);
                        return (
                          <div key={resource.id} style={{ background: th.surface, borderRadius: 16, padding: '13px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                              <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{resource.name}</span>
                              <Chip color={ct.color} icon={ct.icon}>{ct.label}</Chip>
                              {resource.attributes?.lighting === true && <Chip color={LIGHTING_BADGE.color} icon={LIGHTING_BADGE.icon}>{LIGHTING_BADGE.label}</Chip>}
                              {courtFormat(typeof resource.attributes?.format === 'string' ? resource.attributes.format : undefined) && <Chip color={SINGLE_COLOR}>Single</Chip>}
                              {typeof resource.attributes?.surface === 'string' && resource.attributes.surface && (
                                <span title="Surface" style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{resource.attributes.surface}</span>
                              )}
                              <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{Number(resource.price)}€<span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute, fontWeight: 500 }}> / créneau</span></span>
                                {resource.offPeakPrice && <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: th.accentWarm }}>{Number(resource.offPeakPrice)}€ en heures creuses</span>}
                              </span>
                            </div>
                            {slots.length === 0 ? (
                              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Aucun créneau ce jour.</div>
                            ) : (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                                {slots.map((s) => {
                                  // Créneaux du jour déjà commencés → affichés mais non réservables.
                                  const isPast = new Date(s.startTime).getTime() <= nowMs;
                                  return (s.available && !isPast && win.slotAllowed(s.startTime)) ? (
                                    <button key={s.startTime} onClick={() => onSlot(resource.id, s.price, s, selDur, typeof resource.attributes?.format === 'string' ? resource.attributes.format : undefined, cs.sport.key, resource.name)} title={s.offPeak ? 'Heures creuses' : undefined}
                                      style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '7px 11px', background: th.surface2, color: th.text, fontFamily: th.fontMono, fontSize: 13.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      {formatHour(s.startTime, club.timezone)}
                                      {s.offPeak && <span title="Heures creuses" style={{ width: 5, height: 5, borderRadius: '50%', background: th.accentWarm }} />}
                                    </button>
                                  ) : (
                                    <span key={s.startTime} title={isPast ? 'Passé' : 'Réservé'}
                                      style={{ borderRadius: 9, padding: '7px 11px', background: th.takenBg, color: th.takenText, fontFamily: th.fontMono, fontSize: 13.5, fontWeight: 500, textDecoration: `line-through ${th.takenText}`, cursor: 'not-allowed' }}>
                                      {formatHour(s.startTime, club.timezone)}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                  );
                })}
            </div>
          </>
        ) : (
          /* onglet Terrains : cartes vers la page détail */
          club.clubSports.map((cs) => (
            <div key={cs.id} style={{ padding: '18px 20px 0' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>{cs.sport.icon ? `${cs.sport.icon} ` : ''}{cs.sport.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                {cs.resources.map((r) => {
                  const ct = coverageType(r.attributes?.coverage);
                  return (
                    <Link key={r.id} href={`/courts/${r.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ background: th.surface, borderRadius: 18, overflow: 'hidden', boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}` }}>
                        <div style={{ position: 'relative' }}>
                          <Placeholder label={r.name} height={92} radius={0} />
                          <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
                            <Chip color={ct.color} icon={ct.icon}>{ct.label}</Chip>
                            {r.attributes?.lighting === true && <Chip color={LIGHTING_BADGE.color} icon={LIGHTING_BADGE.icon}>{LIGHTING_BADGE.label}</Chip>}
                            {courtFormat(typeof r.attributes?.format === 'string' ? r.attributes.format : undefined) && <Chip color={SINGLE_COLOR}>Single</Chip>}
                            {typeof r.attributes?.surface === 'string' && r.attributes.surface && (
                              <Chip>{r.attributes.surface}</Chip>
                            )}
                          </div>
                        </div>
                        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, color: th.text }}>{r.name}</span>
                          <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, color: th.text }}>{Number(r.price)}€<span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}> / créneau</span></span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {booking && (
        <BookingModal
          slot={booking.slot}
          resourceId={booking.resourceId}
          price={booking.price}
          duration={booking.duration}
          token={token ?? ''}
          timezone={club.timezone}
          slug={club.slug}
          maxPlayers={playerCount(booking.format)}
          sportKey={booking.sportKey}
          format={booking.format}
          resourceName={booking.resourceName}
          packages={myPackages}
          subscriptions={mySubs}
          quotaStatus={quotaStatus}
          clubId={club.id}
          requireOnlinePayment={club.requireOnlinePayment}
          requireCardFingerprint={club.requireCardFingerprint}
          hasCardOnFile={hasCardOnFile}
          stripeActive={club.stripeAccountStatus === 'ACTIVE'}
          cancellationCutoffHours={club.cancellationCutoffHours}
          refundOnCancelWithinCutoff={club.refundOnCancelWithinCutoff}
          onClose={() => setBooking(null)}
          onConfirmed={() => {
            setBooking(null);
            setConfirmed(true);
            if (token) { api.getMyClubPackages(club.slug, token).then(setMyPackages).catch(() => {}); }
            refreshQuota();
            reloadAll();
          }}
        />
      )}
    </Screen>
  );
}
