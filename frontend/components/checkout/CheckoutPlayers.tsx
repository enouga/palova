'use client';
import { ReactNode } from 'react';
import { ClubMemberSearchResult } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon, IconName } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';
import { AddPlayerSheet, PickedMember } from '@/components/match/AddPlayerSheet';
import { LevelChip } from '@/components/player/LevelChip';

export interface CheckoutPlayersProps {
  showPartners: boolean;
  isPadel: boolean;
  me: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  partners: ClubMemberSearchResult[];
  buildPlayers: () => MatchPlayerData[];
  capacity: number;
  atCap: boolean;
  addTarget: { team: 1 | 2; slot?: number } | null;
  setAddTarget: (t: { team: 1 | 2; slot?: number } | null) => void;
  addPartnerTo: (m: PickedMember, team: 1 | 2, slot?: number) => void;
  removePartner: (id: string) => void;
  addPartner: (m: ClubMemberSearchResult) => void;
  /**
   * Non listés dans le brief mais indispensables au fonctionnement de `MatchTeams`
   * (tap-pour-permuter) — miroir de `checkout.setTeamsDraft`/`setSlotsDraft` du hook.
   */
  setTeamsDraft: (t: Record<string, 1 | 2>) => void;
  setSlotsDraft: (s: Record<string, number>) => void;
  spotsLeft: number;
  nbPlayers: number;
  perPlayer: string;
  cap: number;
  slug?: string;
  token: string;
}

/**
 * Bloc « Joueurs / Partenaires » — terrain multi-joueurs. Port fidèle de BookingModal
 * (lignes 524-567 et 600-605) : aperçu d'équipes padel (`MatchTeams`) OU pastilles
 * partenaires classiques, recherche de membres, et chip « ≈ X € par joueur ».
 * Ne rend rien si `showPartners` est faux.
 */
export function CheckoutPlayers({
  showPartners, isPadel, me, partners, buildPlayers, capacity, atCap,
  addTarget, setAddTarget, addPartnerTo, removePartner, addPartner,
  setTeamsDraft, setSlotsDraft,
  spotsLeft, nbPlayers, perPlayer, cap, slug, token,
}: CheckoutPlayersProps) {
  const { th } = useTheme();

  // Intitulé de section : micro-icône + label majuscule discret (copie du helper BookingModal).
  const sectionLabel = (icon: IconName, label: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
      <Icon name={icon} size={13} color={th.textMute} />
      <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>{label}</span>
    </div>
  );

  if (!showPartners) return null;

  return (
    <div style={{ marginTop: 20 }}>
      {sectionLabel('users', isPadel && me
        ? <>Joueurs <span style={{ color: th.textFaint, fontWeight: 600 }}>· composez les équipes</span></>
        : <>Partenaires <span style={{ color: th.textFaint, fontWeight: 600 }}>· membres du club</span></>)}
      {isPadel && me ? (
        <div style={{ marginBottom: 8 }}>
          <MatchTeams size="sm" editable capacity={capacity} players={buildPlayers()}
            onSetTeams={(teams, slots) => { setTeamsDraft(teams); setSlotsDraft(slots); }}
            onRemove={(pl) => removePartner(pl.userId)} canRemove={(pl) => !pl.isOrganizer}
            onAddToTeam={atCap ? undefined : (team, slot) => setAddTarget({ team, slot })}
            activeTarget={addTarget} />
        </div>
      ) : null}
      {addTarget && slug && me && (
        <AddPlayerSheet slug={slug} token={token} team={addTarget.team} slot={addTarget.slot}
          excludeIds={[me.id, ...partners.map((p) => p.id)]}
          onPick={(m) => { addPartnerTo(m, addTarget.team, addTarget.slot); setAddTarget(null); }}
          onClose={() => setAddTarget(null)} />
      )}
      {!(isPadel && me) && partners.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {partners.map((p) => {
            const c = colorForSeed(p.id);
            return (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: `${c}22`, border: `1px solid ${c}`, borderRadius: 999, padding: '4px 10px 4px 4px' }}>
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={24} color={c} />
              <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text }}>{p.firstName} {p.lastName}</span>
              <LevelChip level={p.level} size="xs" />
              <button type="button" onClick={() => removePartner(p.id)} aria-label={`Retirer ${p.firstName} ${p.lastName}`}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 17, lineHeight: 1, padding: 0 }}>×</button>
            </span>
            );
          })}
        </div>
      )}
      {atCap ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Terrain complet ({cap} joueurs).</div>
      ) : !(isPadel && me) && (
        <PartnerSearch slug={slug!} token={token} selected={null}
          excludeIds={partners.map((p) => p.id)} keepOpenOnSelect
          onSelect={addPartner}
          onClear={() => {}} />
      )}

      {nbPlayers > 1 && (
        <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '7px 11px' }}>
          <Icon name="users" size={14} color={th.textMute} />≈ {perPlayer} € par joueur ({nbPlayers} joueurs)
        </div>
      )}
    </div>
  );
}
