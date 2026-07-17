'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { formatDateShortTimeRange } from '@/lib/tournament';
import type { RefereeTournamentRow, RefereeRegistrationRow, RefereePlayerRow } from '@/lib/api';

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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: player.membershipNo ? th.textMute : th.textFaint }}>
            {player.membershipNo ? `Licence ${player.membershipNo}` : 'Licence manquante'}
          </span>
          {player.phone && (
            <a href={`tel:${player.phone}`} style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.accent, textDecoration: 'none' }}>{player.phone}</a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Carte d'un tournoi de l'espace J/A : en-tête toujours visible, roster replié.
 * Purement présentationnelle — le parent possède le chargement (roster à la demande) et les actions.
 */
export function RefereeTournamentCard({
  tournament, tz, editable, expanded, registrations, loadingRoster, onToggleRoster, onPromote, onRemove,
}: {
  tournament: RefereeTournamentRow;
  tz: string;
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
  return (
    <div style={{ background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* En-tête : nom, catégorie, dates, remplissage */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 16, color: th.text }}>{tournament.name}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, background: th.surface2, borderRadius: 999, padding: '2px 8px' }}>
          {tournament.category}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>
          {teamsLabel(tournament)}
        </span>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
        {formatDateShortTimeRange(tournament.startTime, tournament.endTime, tz)}
      </div>

      <button onClick={onToggleRoster} aria-expanded={expanded}
        style={{ alignSelf: 'flex-start', border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
        Inscrits {expanded ? '▴' : '▾'}
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {registrations === null ? (
            // Roster jamais reçu : « Chargement… » seulement si une requête est en vol — un échec
            // laisse la carte muette (la bannière d'erreur de la page explique), jamais un faux chargement.
            loadingRoster ? <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Chargement…</span> : null
          ) : registrations.length === 0 ? (
            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun binôme inscrit.</span>
          ) : (
            registrations.map((reg) => (
              <div key={reg.id} style={{ background: th.surface2, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {reg.waitlistPosition != null && (
                    <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute }}>
                      Liste d&apos;attente {reg.waitlistPosition}
                    </span>
                  )}
                  {editable && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {reg.status === 'WAITLISTED' && (
                        <button aria-label={`Promouvoir ${pairName(reg)}`} onClick={() => onPromote(reg.id)}
                          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 10px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                          Promouvoir
                        </button>
                      )}
                      <button aria-label={`Retirer ${pairName(reg)}`} onClick={() => onRemove(reg.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
                    </span>
                  )}
                </div>
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
