'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ManagedClub } from '@/lib/api';
import { goToClubAdmin } from '@/lib/postAuth';
import { Icon } from '@/components/ui/Icon';

// Carte Gestion (remplace l'ancien ManagerView) : un bouton par club géré, au-dessus du
// hero. Sobre — le Lot 2 l'enrichira en panneau pouls/KPIs. Absente pour le joueur pur.
export function ManagedClubsCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [clubs, setClubs] = useState<ManagedClub[] | null>(null);
  useEffect(() => {
    api.getMyClubs(token).then(setClubs).catch(() => setClubs([]));
  }, [token]);
  if (!clubs || clubs.length === 0) return null;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute, marginBottom: 8 }}>Gestion</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {clubs.map((c) => (
          <button key={c.clubId} onClick={() => goToClubAdmin(c.slug, token, c.clubId)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer', borderRadius: 11, padding: '10px 13px', background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, textAlign: 'left' }}>
            <Icon name="arrowR" size={15} color="currentColor" />Gérer {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
