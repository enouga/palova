'use client';

import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { CardStripe, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { CalendarEntry, ClubMarker, agendaKindMeta, agendaItemClub, clubMarker, STATUS_LABEL, REG_LABEL, GENDER_LABEL } from '@/lib/calendar';
import { MyReservation } from '@/lib/api';
import { isCancellationOpen } from '@/lib/reservations';
import { clubUrl } from '@/lib/clubUrl';
import { KIND_LABEL } from '@/lib/events';
import { PlayerPills } from '@/components/player/PlayerPills';
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';
import { MatchTeams } from '@/components/match/MatchTeams';
import { ReservationAgendaCard } from '@/components/reservations/ReservationAgendaCard';
import { useIsDesktop } from '@/lib/useIsDesktop';

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}
function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}
/** Titre du panneau à partir de la clé jour (déjà exprimée dans le bon fuseau). */
function dayTitle(dayKey: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${dayKey}T00:00:00Z`));
}

export function DayPanel({
  dayKey, entries, localSlug, token, now, onCancel, onPlayersChanged, onOpenChat, onReserve, reserveLabel,
  onRecordResult, canRecord, showSport, matchStatusFor,
}: {
  dayKey: string;
  entries: CalendarEntry[];
  localSlug: string | null;
  token: string | null;
  now: number;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
  onOpenChat: (r: MyReservation) => void;
  onReserve: () => void;
  reserveLabel: string;
  onRecordResult?: (r: MyReservation) => void;
  canRecord?: (r: MyReservation) => boolean;
  showSport?: boolean; // vue cross-club couvrant plusieurs sports → préfixe le sport au sous-titre
  matchStatusFor?: (reservationId: string) => 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED' | undefined;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop(700);
  const linkStyle = { marginLeft: 'auto', textDecoration: 'none', borderRadius: 9, padding: '6px 12px', background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' } as const;

  // Même chrome que les cartes de Parties (OpenMatchCard) : pas de barre de couleur latérale
  // (sauf le liseré du marqueur « autre club »), carte pleine (inset 1px de contour).
  const card = (children: React.ReactNode, key: string, past: boolean, marker?: ClubMarker | null) => (
    <div key={key} style={{
      background: th.surface, borderRadius: 16, padding: '13px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`,
      opacity: past ? 0.6 : 1,
      ...(marker ? { position: 'relative' as const, overflow: 'hidden' as const } : null),
    }}>
      {marker && <CardStripe color={marker.accent} />}
      {children}
    </div>
  );

  // Sous-titres : texte simple (entrée du club courant) ou rangée flex avec la chip club (marqueur).
  const subtitlePlain = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 } as const;
  const subtitleRow = { ...subtitlePlain, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 } as const;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: th.textMute }}>
        {dayTitle(dayKey)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start', marginTop: 10 }}>
        {entries.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '18px 0', textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
            Rien ce jour-là.
            <div style={{ marginTop: 10 }}>
              <button onClick={onReserve}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 12, padding: '10px 16px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
                {reserveLabel}
              </button>
            </div>
          </div>
        ) : (
          entries.map((e) => {
            // Marqueur « autre club » : liseré + chip à l'accentColor du club de l'entrée
            // (toutes les entrées sur la plateforme, seules les étrangères sur un hôte club).
            const marker = clubMarker(agendaItemClub(e), localSlug);
            const clubChip = marker ? <Chip color={marker.accent}>{marker.name}</Chip> : null;
            if (e.kind === 'reservation') {
              const r = e.r;
              const tz = r.resource.club.timezone;
              const isForeign = localSlug != null && r.resource.club.slug !== localSlug;
              const isPadel = r.resource.sport?.key === 'padel';
              if (!isForeign && isPadel) {
                return card(
                  <ReservationAgendaCard
                    reservation={r} past={e.past} showSport={showSport} token={token} now={now}
                    onCancel={onCancel} onPlayersChanged={onPlayersChanged} onOpenChat={onOpenChat}
                    onRecordResult={onRecordResult} canRecord={canRecord}
                    existingMatchStatus={matchStatusFor?.(r.id)}
                    clubMarker={marker}
                  />,
                  `res-${r.id}`, e.past, marker,
                );
              }
              return card(
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15.5, color: th.text }}>{r.resource.name}</span>
                    <Chip tone={r.status === 'CONFIRMED' ? 'accent' : 'line'}>{STATUS_LABEL[r.status]}</Chip>
                  </div>
                  {marker
                    ? <div style={subtitleRow}>{showSport && r.resource.sport && <span>{r.resource.sport.name} ·</span>}{clubChip}</div>
                    : <div style={subtitlePlain}>{showSport && r.resource.sport ? `${r.resource.sport.name} · ` : ''}{r.resource.club.name}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="clock" size={14} color={th.textMute} />{fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}
                    </span>
                    <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
                    {isForeign ? (
                      <a href={clubUrl(r.resource.club.slug, '/me/reservations')} style={linkStyle}>Voir</a>
                    ) : (!e.past && (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => onCancel(r)} disabled={!isCancellationOpen(r, now)}
                          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: isCancellationOpen(r, now) ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: isCancellationOpen(r, now) ? ACCENTS.coral : th.textFaint }}>
                          Annuler
                        </button>
                      </span>
                    ))}
                  </div>
                  {!isForeign && !e.past && token ? (
                    <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
                  ) : (r.participants?.length ?? 0) > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      {r.resource.sport?.key === 'padel' ? (
                        <MatchTeams
                          players={(r.participants ?? []).map((p) => ({
                            userId: p.userId, firstName: p.firstName, lastName: p.lastName,
                            avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
                            team: (p.team ?? 1) as 1 | 2,
                            slot: p.slot,
                          }))}
                          capacity={r.capacity ?? 4}
                          size="sm"
                        />
                      ) : (
                        <PlayerPills
                          players={r.participants ?? []}
                          spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
                          size="sm"
                        />
                      )}
                    </div>
                  ) : null}
                  {e.past && !isForeign && canRecord?.(r) && onRecordResult && (
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => onRecordResult(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Saisir le résultat</button>
                    </div>
                  )}
                </>,
                `res-${r.id}`, e.past, marker,
              );
            }

            if (e.kind === 'tournament') {
              const t = e.reg.tournament;
              const tz = t.club.timezone;
              const team = `${e.reg.captain.firstName} ${e.reg.captain.lastName} & ${e.reg.partner.firstName} ${e.reg.partner.lastName}`;
              return card(
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15.5, color: th.text }}>{t.name}</span>
                    <Chip color={agendaKindMeta('tournament').color}>{REG_LABEL[e.reg.status] ?? e.reg.status}</Chip>
                  </div>
                  {marker ? (
                    <div style={subtitleRow}>
                      <span>{showSport && t.sport ? `${t.sport.name} · ` : ''}{t.category} · {GENDER_LABEL[t.gender] ?? t.gender}</span>
                      {clubChip}
                    </div>
                  ) : (
                    <div style={subtitlePlain}>
                      {showSport && t.sport ? `${t.sport.name} · ` : ''}{t.category} · {GENDER_LABEL[t.gender] ?? t.gender} · {t.club.name}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="calendar" size={14} color={th.textMute} />
                      {fmtDate(t.startTime, tz)}{t.endTime && ` – ${fmtDate(t.endTime, tz)}`} · {fmtHour(t.startTime, tz)}
                    </span>
                    <a href={clubUrl(t.club.slug, `/tournois/${t.id}`)} style={linkStyle}>Gérer</a>
                  </div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 6 }}>
                    Équipe : {team}
                  </div>
                </>,
                `reg-${e.reg.id}`, e.past, marker,
              );
            }

            if (e.kind === 'lesson') {
              const lesson = e.enrollment.lesson;
              const res = lesson.reservation;
              const startTime = res.startTime;
              const endTime = res.endTime;
              const lessonTz = lesson.club.timezone;
              return card(
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15.5, color: th.text }}>
                      Cours · {lesson.coach.name} · {res.resource.name}
                    </span>
                    <Chip color={agendaKindMeta('lesson').color}>{e.enrollment.status === 'CONFIRMED' ? 'Inscrit' : e.enrollment.status}</Chip>
                  </div>
                  {marker && <div style={subtitleRow}>{clubChip}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="clock" size={14} color={th.textMute} />{fmtHour(startTime, lessonTz)}–{fmtHour(endTime, lessonTz)}
                    </span>
                    <a href={`/cours/${lesson.id}`} style={linkStyle}>Voir</a>
                  </div>
                </>,
                `lesson-${e.enrollment.enrollmentId}`, e.past, marker,
              );
            }

            const ev = e.ev.event;
            const tz = ev.club.timezone;
            return card(
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15.5, color: th.text }}>{ev.name}</span>
                  <Chip color={agendaKindMeta('event').color}>{REG_LABEL[e.ev.status] ?? e.ev.status}</Chip>
                </div>
                {marker ? (
                  <div style={subtitleRow}>
                    <span>{showSport && ev.sport ? `${ev.sport.name} · ` : ''}{KIND_LABEL[ev.kind]}</span>
                    {clubChip}
                  </div>
                ) : (
                  <div style={subtitlePlain}>
                    {showSport && ev.sport ? `${ev.sport.name} · ` : ''}{KIND_LABEL[ev.kind]} · {ev.club.name}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Icon name="calendar" size={14} color={th.textMute} />
                    {fmtDate(ev.startTime, tz)}{ev.endTime && ` – ${fmtDate(ev.endTime, tz)}`} · {fmtHour(ev.startTime, tz)}
                  </span>
                  <a href={clubUrl(ev.club.slug, `/events/${ev.id}`)} style={linkStyle}>Voir</a>
                </div>
              </>,
              `evt-${e.ev.id}`, e.past, marker,
            );
          })
        )}
      </div>
    </div>
  );
}
