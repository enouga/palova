'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ManagedClub } from '@/lib/api';
import { goToClubAdmin } from '@/lib/postAuth';
import { STAFF_LABEL } from '@/lib/members';
import { inkOn, ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { Chip, CardStripe } from '@/components/ui/atoms';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// Couleur SIGNATURE de « Gestion » (liseré/tuile/CTA/lavis) : apricot pastel FIXE, pas la
// marque du club — la marque de chaque club géré reste lisible plus bas dans « Mes clubs ».
// Un accent fixe évite deux écueils vécus en itération : (1) se fondre avec le bleu pâle du
// hero juste en dessous quand la marque du club est elle-même bleue, (2) un lavis qui change
// de teinte d'un club à l'autre pour un même bloc « accès admin ».
const GESTION_ACCENT = ACCENTS.apricot;

// Carte Gestion : une carte PAR club géré, teintée apricot pastel léger (liseré latéral +
// lavis dégradé, langage des cartes d'offres admin) — se distingue nettement d'une ligne de
// liste plate (MyClubsRow, HomeAgenda…), cohérent avec le statut d'accès privilégié que porte
// ce bloc. CTA « Gérer → » plein remplace le simple chevron. Absente pour le joueur pur.
export function ManagedClubsCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [clubs, setClubs] = useState<ManagedClub[] | null>(null);
  useEffect(() => {
    api.getMyClubs(token).then(setClubs).catch(() => setClubs([]));
  }, [token]);
  if (!clubs || clubs.length === 0) return null;
  // Lavis composé sur th.surface (pas directement sur le fond de page), pastel léger : l'apricot
  // n'a pas le problème de confusion du bleu (hue différent du hero), l'alpha peut rester doux.
  const washAlpha = th.mode === 'floodlit' ? ['2e', '08'] : ['3d', '0d'];
  return (
    <section>
      <SectionHeader kicker="Gestion" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {clubs.map((c) => (
          <button key={c.clubId} onClick={() => goToClubAdmin(c.slug, token, c.clubId)} className="pl-lift"
            style={{
              position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', border: 'none', cursor: 'pointer', borderRadius: 14, textAlign: 'left',
              padding: '13px 15px 13px 19px', boxShadow: th.shadow,
              background: `linear-gradient(120deg, ${GESTION_ACCENT}${washAlpha[0]}, ${GESTION_ACCENT}${washAlpha[1]}), ${th.surface}`,
            }}>
            <CardStripe color={GESTION_ACCENT} />
            <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: GESTION_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="grid" size={16} color={inkOn(GESTION_ACCENT)} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              <span style={{ display: 'block', marginTop: 4 }}><Chip color={GESTION_ACCENT}>{STAFF_LABEL[c.role]}</Chip></span>
            </span>
            <span style={{ flexShrink: 0, background: GESTION_ACCENT, color: inkOn(GESTION_ACCENT), fontFamily: th.fontUI, fontWeight: 700, fontSize: 12, borderRadius: 999, padding: '9px 15px', whiteSpace: 'nowrap' }}>
              Gérer →
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
