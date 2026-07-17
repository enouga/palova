'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { AgendaCardHeader } from '@/components/agenda/AgendaCardHeader';
import { colorForSeed } from '@/lib/playerColors';
import { formatDateShortTimeRange, heroPlacesLabel } from '@/lib/tournament';
import { GENDER_LABEL } from '@/lib/events';
import type { RefereeTournamentRow, RefereeRegistrationRow, RefereePlayerRow, TournamentGender } from '@/lib/api';

/** « 12 / 16 binômes · 2 en attente » — maxTeams est nullable (tournoi sans plafond). */
function teamsLabel(t: RefereeTournamentRow): string {
  const base = t.maxTeams != null ? `${t.confirmedCount} / ${t.maxTeams} binômes` : `${t.confirmedCount} binômes`;
  return t.waitlistCount > 0 ? `${base} · ${t.waitlistCount} en attente` : base;
}

/** Nom du binôme, aussi utilisé en aria-label des actions (un seul par carte → libellés uniques). */
function pairName(reg: RefereeRegistrationRow): string {
  return `${reg.captain.firstName} ${reg.captain.lastName} & ${reg.partner.firstName} ${reg.partner.lastName}`;
}

/**
 * Une ligne joueur de la table de marque : identité, licence, téléphone cliquable.
 * `RefereePlayerRow` n'expose pas d'userId (voulu côté serveur) → le seed de couleur vient
 * de l'inscription + du rôle dans le binôme.
 */
function PlayerLine({ player, seed }: { player: RefereePlayerRow; seed: string }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar firstName={player.firstName} lastName={player.lastName} avatarUrl={player.avatarUrl} size={30} color={colorForSeed(seed)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
          {player.firstName} {player.lastName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* La licence est LE contrôle de la table de marque : chip pleine quand elle est là,
              chip coral quand elle manque — le J/A doit la repérer sans lire. */}
          <span style={{
            fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
            borderRadius: 999, padding: '2px 8px',
            background: player.membershipNo
              ? th.surface
              : (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}40`),
            color: player.membershipNo ? th.textMute : (th.mode === 'floodlit' ? ACCENTS.coral : th.ink),
            boxShadow: player.membershipNo ? `inset 0 0 0 1px ${th.line}` : 'none',
          }}>
            {player.membershipNo ? `Licence ${player.membershipNo}` : 'Licence manquante'}
          </span>
          {player.phone && (
            <a href={`tel:${player.phone}`} style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent, textDecoration: 'none' }}>{player.phone}</a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Carte d'un tournoi de l'espace J/A : en-tête au langage AgendaCard (tuile trophée apricot,
 * catégorie · genre, compte à rebours avant clôture, jauge de remplissage), roster replié.
 * Purement présentationnelle — le parent possède le chargement (roster à la demande) et les actions.
 *
 * Pas un <button> comme AgendaCard : la carte contient elle-même des boutons et des liens `tel:`.
 */
export function RefereeTournamentCard({
  tournament, tz, now, editable, expanded, registrations, loadingRoster, onToggleRoster, onPromote, onRemove,
}: {
  tournament: RefereeTournamentRow;
  tz: string;
  /** Horloge posée au mount par la page. Absente/null → pas de compte à rebours (hydration-safe). */
  now?: Date | null;
  editable: boolean;
  expanded: boolean;
  /** null = roster jamais chargé (jamais déplié). */
  registrations: RefereeRegistrationRow[] | null;
  loadingRoster: boolean;
  onToggleRoster: () => void;
  onPromote: (regId: string) => void;
  onRemove: (regId: string) => void;
}) {
  const { th } = useTheme();
  // Même règle de rareté que /events : coral dès qu'il reste peu de places.
  const urgent = heroPlacesLabel(tournament.confirmedCount, tournament.maxTeams)?.urgent ?? false;
  const gender = GENDER_LABEL[tournament.gender as TournamentGender] ?? tournament.gender;

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <AgendaCardHeader
          icon="trophy"
          accent={ACCENTS.apricot}
          tag={`${tournament.category} · ${gender}`}
          title={tournament.name}
          dateLabel={formatDateShortTimeRange(tournament.startTime, tournament.endTime, tz)}
          deadline={tournament.registrationDeadline}
          now={now ?? null}
          ratio={tournament.maxTeams != null ? Math.min(1, tournament.confirmedCount / tournament.maxTeams) : null}
          // Le J/A veut le compte exact (9 / 12 · 2 en attente), pas « plus que 3 places ».
          places={{ text: teamsLabel(tournament), urgent }}
        />
      </div>

      {/* Bouton natif (pas <Btn>) : il porte aria-expanded, que l'atome n'expose pas.
          Skin identique à <Btn variant="surface">. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
        <button onClick={onToggleRoster} aria-expanded={expanded}
          style={{
            fontFamily: th.fontUI, fontWeight: 600, fontSize: 14, letterSpacing: 0.1,
            border: 'none', borderRadius: 14, padding: '0 16px', height: 42, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: th.surface2, color: th.text, WebkitTapHighlightColor: 'transparent',
          }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
            <Icon name="chevR" size={15} color={th.text} />
          </span>
          Inscrits
        </button>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {registrations === null ? (
            // Roster jamais reçu : « Chargement… » seulement si une requête est en vol — un échec
            // laisse la carte muette (la bannière d'erreur de la page explique), jamais un faux chargement.
            loadingRoster ? <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Chargement…</span> : null
          ) : registrations.length === 0 ? (
            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun binôme inscrit.</span>
          ) : (
            registrations.map((reg) => (
              <div key={reg.id} style={{ background: th.surface2, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(reg.waitlistPosition != null || editable) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {reg.waitlistPosition != null && (
                      <span style={{
                        fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                        borderRadius: 999, padding: '3px 9px',
                        background: th.mode === 'floodlit' ? `${ACCENTS.violet}26` : `${ACCENTS.violet}40`,
                        color: th.mode === 'floodlit' ? ACCENTS.violet : th.ink,
                      }}>
                        Liste d&apos;attente {reg.waitlistPosition}
                      </span>
                    )}
                    {editable && (
                      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {reg.status === 'WAITLISTED' && (
                          <Btn variant="surface" ariaLabel={`Promouvoir ${pairName(reg)}`} onClick={() => onPromote(reg.id)}
                            style={{
                              height: 34, fontSize: 12.5, padding: '0 12px', borderRadius: 999,
                              background: th.mode === 'floodlit' ? `${ACCENTS.emerald}1f` : `${ACCENTS.emerald}55`,
                              color: th.mode === 'floodlit' ? ACCENTS.emerald : th.ink,
                            }}>
                            Promouvoir
                          </Btn>
                        )}
                        <button aria-label={`Retirer ${pairName(reg)}`} onClick={() => onRemove(reg.id)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, display: 'inline-flex', alignItems: 'center', padding: 4 }}>
                          <Icon name="x" size={15} color={th.textMute} />
                        </button>
                      </span>
                    )}
                  </div>
                )}
                <PlayerLine player={reg.captain} seed={`${reg.id}-captain`} />
                <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textFaint, paddingLeft: 12 }}>&amp;</span>
                <PlayerLine player={reg.partner} seed={`${reg.id}-partner`} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
