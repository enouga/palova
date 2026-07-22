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
  // Grappe d'avatars chevauchés, même langage que TeamCard (grille « Inscrits »).
  const ring = { borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}` } as const;

  return (
    <div style={{ ...cardStyle(th), overflow: 'hidden', borderLeft: `4px solid ${teamColor}` }}>
      {/* Bandeau de statut compact (une ligne) : lavis de la teinte d'état. */}
      <div style={{ padding: '8px 16px', background: th.mode === 'floodlit' ? `${tint}1f` : `${tint}12` }}>
        <RegistrationStatus confirmed={confirmed} waitlistPos={waitlistPos} compact />
      </div>

      {/* Binôme (même anatomie que sa carte dans la grille « Inscrits ») + actions
          à droite sur la même rangée — elles passent dessous sur écran étroit. */}
      <div style={{ padding: '10px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {rows.map(({ p, avatarUrl }, i) => (
              <div key={p.id} style={{ ...ring, marginLeft: i > 0 ? -11 : 0 }}>
                <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={avatarUrl} color={teamColor} />
              </div>
            ))}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, lineHeight: 1.35 }}>
              {rows.map(({ p, level }, i) => (
                <span key={p.id}>
                  {i > 0 && <span style={{ color: th.textFaint, fontWeight: 400 }}> &amp; </span>}
                  {p.firstName} {p.lastName}
                  <LevelChip level={level} size="xs" />
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 1, marginTop: 2, fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint }}>
              {rows.map(({ p, lic, role }) => (
                <span key={p.id} style={{ whiteSpace: 'nowrap' }}>
                  {role} · Lic. <span style={{ fontFamily: th.fontMono, color: th.textMute }}>{lic ?? '—'}</span>
                  {p.id === profileId && p.phone ? <> · <span style={{ fontFamily: th.fontMono, color: th.textMute }}>{p.phone}</span></> : null}
                </span>
              ))}
            </div>
          </div>
        </div>

        {!closed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <PartnerField slug={slug} token={token} selected={partner} onSelect={onSelectPartner} onClear={onClearPartner} disabled={busy}
              excludeIds={[myReg.captain.id, myReg.partner.id]} triggerLabel="Changer de coéquipier" sheetTitle="Changer de coéquipier" />
            <LeaveButton onClick={onCancel} disabled={busy} full={false} small />
          </div>
        )}
      </div>

      {!closed && partner && (
        <div style={{ padding: '0 16px 12px' }}>
          <button onClick={onChangePartner} disabled={changeDisabled} style={{ ...primaryBtn, height: 40 }}>Confirmer le changement</button>
        </div>
      )}

      {closed && (
        <div style={{ padding: '9px 16px 12px', borderTop: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, lineHeight: 1.5 }}>
          Inscriptions closes : modification et annulation ne sont plus possibles.
          {contactInfo && <div style={{ marginTop: 6, color: th.textMute, whiteSpace: 'pre-wrap' }}>{contactInfo}</div>}
        </div>
      )}
    </div>
  );
}
