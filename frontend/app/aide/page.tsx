'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ClubPresentation } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ContentShell } from '@/components/content/ContentShell';
import { FaqView } from '@/components/content/FaqView';
import { Icon } from '@/components/ui/Icon';

/** Aide joueur : le club est l'interlocuteur de 1er niveau (modèle 2 étages, cf. spec support). */
export default function AidePage() {
  const { slug, club } = useClub();
  const router = useRouter();
  const { th } = useTheme();
  const [pres, setPres] = useState<ClubPresentation | null>(null);

  // Hôte plateforme : l'aide joueur n'a pas de club → la FAQ plateforme fait foi.
  useEffect(() => { if (slug === null) router.replace('/faq'); }, [slug, router]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    api.getClubPresentation(slug).then((p) => { if (!cancelled) setPres(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  if (slug === null) return null;

  const phone = pres?.contactPhone?.trim() || null;
  const email = pres?.contactEmail?.trim() || null;
  const hours = pres?.openingHoursText?.trim() || null;
  const card: React.CSSProperties = { background: th.surface, border: `1px solid ${th.line}`, borderRadius: 14, padding: '16px 18px' };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 14.5, color: th.text };

  return (
    <ContentShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h1 style={{ fontFamily: th.fontUI, fontSize: 28, fontWeight: 800, letterSpacing: -0.4, color: th.text, margin: 0 }}>Aide</h1>

        <section aria-label="Contacter le club" style={card}>
          <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 10px' }}>
            Contacter {club?.name ?? 'le club'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {club?.address && (
              <div style={row}><Icon name="pin" size={16} color={th.textMute} />{club.address}{club.city ? `, ${club.city}` : ''}</div>
            )}
            {phone && (
              <div style={row}>
                <Icon name="phone" size={16} color={th.textMute} />
                <a href={`tel:${phone.replace(/\s/g, '')}`} style={{ color: th.accent, fontWeight: 600 }}>{phone}</a>
              </div>
            )}
            {email && (
              <div style={row}>
                <Icon name="mail" size={16} color={th.textMute} />
                <a href={`mailto:${email}`} style={{ color: th.accent, fontWeight: 600 }}>{email}</a>
              </div>
            )}
            {hours && (
              <div style={row}><Icon name="clock" size={16} color={th.textMute} />{hours}</div>
            )}
            {!phone && !email && (
              <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
                Renseignez-vous directement à l'accueil du club.
              </p>
            )}
          </div>
        </section>

        <section aria-label="Compte Palova" style={{ ...card, background: th.surface2 }}>
          <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            Un problème avec votre <strong style={{ color: th.text }}>compte Palova</strong> (connexion, données personnelles) ?
            {' '}Écrivez-nous à <a href="mailto:contact@palova.fr" style={{ color: th.accent, fontWeight: 600 }}>contact@palova.fr</a>.
          </p>
        </section>

        <FaqView />
      </div>
    </ContentShell>
  );
}
