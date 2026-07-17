'use client';
import type { Sport } from '@/lib/api';
import { PillTabs } from '@/components/ui/atoms';
import { DateField } from '@/components/ui/DateField';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

interface Props extends ProfileTabProps {
  sports: Sport[];
  /** Licence : seconde ressource, rendue seulement si membre d'un club. */
  licence: string | null;
  clubName: string | null;
  onLicence: (v: string) => void;
}

export function ProfileIdentity({ profile, set, sports, licence, clubName, onLicence }: Props) {
  const { th, card, cardTitle, label, input } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  return (
    <>
      {sports.length > 0 && (
        <section style={card} aria-label="Sport préféré">
          <div style={cardTitle}>Sport préféré</div>
          <div role="group" aria-label="Sport préféré">
            <PillTabs
              options={[{ value: '', label: 'Aucun' }, ...sports.map((s) => ({ value: s.id, label: s.name }))]}
              value={profile.preferredSport?.id ?? ''}
              onChange={(id) => set('preferredSport', id ? (sports.find((s) => s.id === id) ?? null) : null)}
              size="sm"
            />
          </div>
          <span style={hint}>Met en avant ce sport dans l&apos;app.</span>
        </section>
      )}

      <section style={card} aria-label="Informations">
        <div style={cardTitle}>Informations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Téléphone</span>
          <input value={profile.phone ?? ''} onChange={(e) => set('phone', e.target.value)}
            placeholder="06 09 03 26 35" aria-label="Téléphone" style={input} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Date de naissance</span>
          <DateField value={profile.birthDate ? profile.birthDate.slice(0, 10) : ''}
            onChange={(d) => set('birthDate', d || null)} width="100%" ariaLabel="Date de naissance" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Sexe</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['MALE', 'FEMALE'] as const).map((s) => (
              <button key={s} onClick={() => set('sex', s)}
                style={{ flex: 1, cursor: 'pointer', borderRadius: 11, padding: '10px', fontFamily: th.fontUI, fontSize: 13.5, border: `1px solid ${profile.sex === s ? th.accent : th.line}`, background: profile.sex === s ? th.surface2 : 'transparent', color: th.text }}>
                {s === 'MALE' ? 'Homme' : 'Femme'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {licence !== null && (
        <section style={card} aria-label="Licence">
          <div style={cardTitle}>Licence{clubName ? ` · ${clubName}` : ''}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={label}>N° de licence / adhérent</span>
            <input value={licence} onChange={(e) => onLicence(e.target.value)}
              placeholder="N° de licence / adhérent" aria-label="N° de licence / adhérent" style={input} />
          </div>
        </section>
      )}
    </>
  );
}
