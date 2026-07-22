'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ManagedClub } from '@/lib/api';
import { goToClubAdmin } from '@/lib/postAuth';
import { STAFF_LABEL } from '@/lib/members';
import { inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { Chip, CardStripe } from '@/components/ui/atoms';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// Carte Gestion : une carte PAR club géré, teintée à la couleur du club (liseré latéral +
// lavis dégradé, langage des cartes d'offres admin) — se distingue nettement d'une ligne de
// liste plate (MyClubsRow, HomeAgenda…), cohérent avec le statut d'accès privilégié que porte
// ce bloc. CTA « Gérer → » plein (accent du club) remplace le simple chevron. Absente pour le
// joueur pur.
export function ManagedClubsCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [clubs, setClubs] = useState<ManagedClub[] | null>(null);
  useEffect(() => {
    api.getMyClubs(token).then(setClubs).catch(() => setClubs([]));
  }, [token]);
  if (!clubs || clubs.length === 0) return null;
  const washAlpha = th.mode === 'floodlit' ? ['26', '08'] : ['2e', '0a'];
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
              background: `linear-gradient(120deg, ${c.accentColor}${washAlpha[0]}, ${c.accentColor}${washAlpha[1]})`,
            }}>
            <CardStripe color={c.accentColor} />
            <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: c.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="grid" size={16} color={inkOn(c.accentColor)} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              <span style={{ display: 'block', marginTop: 4 }}><Chip color={c.accentColor}>{STAFF_LABEL[c.role]}</Chip></span>
            </span>
            <span style={{ flexShrink: 0, background: c.accentColor, color: inkOn(c.accentColor), fontFamily: th.fontUI, fontWeight: 700, fontSize: 12, borderRadius: 999, padding: '9px 15px', whiteSpace: 'nowrap' }}>
              Gérer →
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
