'use client';
import type { Sex, Sport } from '@/lib/api';
import { DateField } from '@/components/ui/DateField';
import { CardKicker } from '@/components/profile/CardKicker';
import { FieldShell, PillChoice, ProfileInput } from '@/components/profile/ProfileFields';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

interface Props extends ProfileTabProps {
  sports: Sport[];
  /** Licence : seconde ressource, rendue seulement si membre d'un club. */
  licence: string | null;
  clubName: string | null;
  onLicence: (v: string) => void;
}

const NO_SPORT = '__none__';

export function ProfileIdentity({ profile, set, sports, licence, clubName, onLicence }: Props) {
  const { th, card } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  return (
    <>
      {/* Pas d'aria-label sur cette section : il collisionnerait avec l'aria-label="Pseudo"
          de l'input lui-même (getByLabelText matche aussi les aria-label génériques). */}
      <section style={card}>
        <CardKicker>Pseudo</CardKicker>
        <ProfileInput label="Pseudo" value={profile.pseudo ?? ''} onChange={(v) => set('pseudo', v)} placeholder="SmashMaster" />
        <span style={hint}>Affiché à la place de votre prénom/nom dans les parties ouvertes, quand il est renseigné.</span>
      </section>

      {sports.length > 0 && (
        <section style={card} aria-label="Sport préféré">
          <CardKicker>Sport préféré</CardKicker>
          <PillChoice
            label="Sport préféré"
            hideLabel
            value={profile.preferredSport?.id ?? NO_SPORT}
            onChange={(id) => set('preferredSport', id === NO_SPORT ? null : (sports.find((s) => s.id === id) ?? null))}
            options={[...sports.map((s) => ({ value: s.id, label: s.name })), { value: NO_SPORT, label: 'Aucun' }]}
          />
          <span style={hint}>Met en avant ce sport dans l&apos;app.</span>
        </section>
      )}

      <section style={card} aria-label="Informations">
        <CardKicker>Informations</CardKicker>
        <ProfileInput label="Téléphone" value={profile.phone ?? ''} onChange={(v) => set('phone', v)} placeholder="06 09 03 26 35" />
        <ProfileInput label="Adresse" value={profile.address ?? ''} onChange={(v) => set('address', v)} placeholder="12 rue des Sports" />
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: '0 0 34%', minWidth: 0 }}>
            <ProfileInput label="Code postal" value={profile.postalCode ?? ''} onChange={(v) => set('postalCode', v)} placeholder="31000" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProfileInput label="Ville" value={profile.city ?? ''} onChange={(v) => set('city', v)} placeholder="Toulouse" />
          </div>
        </div>
        <FieldShell label="Date de naissance">
          <DateField
            value={profile.birthDate ? profile.birthDate.slice(0, 10) : ''}
            onChange={(d) => set('birthDate', d || null)}
            width="100%" ariaLabel="Date de naissance"
          />
        </FieldShell>
        <PillChoice<Sex>
          label="Sexe" value={profile.sex} onChange={(v) => set('sex', v)}
          options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]}
        />
      </section>

      {licence !== null && (
        <section style={card} aria-label="Licence">
          <CardKicker>Licence{clubName ? ` · ${clubName}` : ''}</CardKicker>
          <ProfileInput label="N° de licence / adhérent" value={licence} onChange={onLicence} placeholder="Ex. 7512345" />
        </section>
      )}
    </>
  );
}
