'use client';
import { MyTournamentRegistration, TournamentParticipant } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { RegistrationStatus, LeaveButton } from '@/components/agenda/RegistrationUI';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { LevelChip } from '@/components/player/LevelChip';
import { PartnerField } from './PartnerField';

// Carte « mon inscription », en trois zones : bandeau de statut en lavis teinté
// (accent confirmé / apricot liste d'attente), binôme en lignes avatar + licence
// (avatars à la couleur d'équipe — la même que la carte du binôme dans la grille
// « Inscrits »), puis actions (changement de coéquipier, désinscription) tant que
// les inscriptions sont ouvertes. `myTeam` (additif) apporte photos et niveaux.
export function MyRegistrationCard({ myReg, myTeam, profileId, closed, busy, contactInfo, waitlistPos, slug, token, partner, onSelectPartner, onClearPartner, onChangePartner, onCancel }: {
  myReg: MyTournamentRegistration;
  myTeam?: TournamentParticipant | null;
  profileId: string | undefined;
  closed: boolean;
  busy: boolean;
  contactInfo?: string | null;
  waitlistPos: number | null;
  slug: string;
  token: string;
  partner: { id: string; firstName: string; lastName: string } | null;
  onSelectPartner: (m: { id: string; firstName: string; lastName: string }) => void;
  onClearPartner: () => void;
  onChangePartner: () => void;
  onCancel: () => void;
}) {
  const { th } = useTheme();
  const confirmed = myReg.status === 'CONFIRMED';
  const tint = confirmed ? th.accent : ACCENTS.apricot;
  // Même teinte que la carte de ce binôme dans la grille « Inscrits » (seed = id d'inscription).
  const teamColor = colorForSeed(myReg.id);
  const kicker: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint };
  const changeDisabled = busy || !partner;
  const primaryBtn: React.CSSProperties = {
    width: '100%', height: 46, border: 'none', cursor: changeDisabled ? 'default' : 'pointer',
    background: th.accent, color: th.onAccent, borderRadius: 12,
    fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, opacity: changeDisabled ? 0.55 : 1,
  };

  const rows = [
    { p: myReg.captain, lic: myReg.captainLicense, role: 'Capitaine', avatarUrl: myTeam?.captain.avatarUrl ?? null, level: myTeam?.captainLevel },
    { p: myReg.partner, lic: myReg.partnerLicense, role: 'Coéquipier', avatarUrl: myTeam?.partner.avatarUrl ?? null, level: myTeam?.partnerLevel },
  ];

  return (
    <div style={{ ...cardStyle(th), overflow: 'hidden' }}>
      {/* Bandeau de statut : lavis de la teinte d'état. */}
      <div style={{ padding: '12px 18px 11px', background: th.mode === 'floodlit' ? `${tint}1f` : `${tint}12` }}>
        <RegistrationStatus confirmed={confirmed} waitlistPos={waitlistPos} />
      </div>

      {/* Binôme : une ligne par joueur, rôle en petit kicker à droite. */}
      <div style={{ padding: '2px 18px 0' }}>
        {rows.map(({ p, lic, role, avatarUrl, level }, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `1px solid ${th.line}` : 'none' }}>
            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={avatarUrl} size={36} color={teamColor} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName} {p.lastName}</span>
                <LevelChip level={level} size="xs" />
              </div>
              <div style={{ fontSize: 12, marginTop: 1 }}>
                <span style={{ fontFamily: th.fontUI, color: th.textFaint }}>Licence </span>
                <span style={{ fontFamily: th.fontMono, color: th.textMute }}>{lic ?? '—'}</span>
                {p.id === profileId && p.phone && (
                  <>
                    <span style={{ fontFamily: th.fontUI, color: th.textFaint }}> · </span>
                    <span style={{ fontFamily: th.fontMono, color: th.textMute }}>{p.phone}</span>
                  </>
                )}
              </div>
            </div>
            <span style={{ ...kicker, flexShrink: 0 }}>{role}</span>
          </div>
        ))}
      </div>

      {!closed ? (
        <div style={{ padding: '10px 18px 14px', borderTop: `1px solid ${th.line}` }}>
          <PartnerField slug={slug} token={token} selected={partner} onSelect={onSelectPartner} onClear={onClearPartner} disabled={busy}
            excludeIds={[myReg.captain.id, myReg.partner.id]} triggerLabel="Changer de coéquipier" sheetTitle="Changer de coéquipier" />
          {partner && (
            <button onClick={onChangePartner} disabled={changeDisabled} style={{ ...primaryBtn, height: 40, marginTop: 8 }}>Confirmer le changement</button>
          )}
          <div style={{ height: 1, background: th.line, margin: '12px 0 10px' }} />
          <LeaveButton onClick={onCancel} disabled={busy} />
        </div>
      ) : (
        <div style={{ padding: '10px 18px 14px', borderTop: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, lineHeight: 1.5 }}>
          Inscriptions closes : modification et annulation ne sont plus possibles.
          {contactInfo && <div style={{ marginTop: 6, color: th.textMute, whiteSpace: 'pre-wrap' }}>{contactInfo}</div>}
        </div>
      )}
    </div>
  );
}
