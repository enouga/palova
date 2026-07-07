'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubBilling } from '@/lib/api';
import { eurosFromCents } from '@/lib/payments';

/**
 * Bandeau « relance douce » du dashboard admin : le club dépasse le palier gratuit
 * sans abonnement, ou son paiement échoue. On ne bloque JAMAIS rien — c'est
 * une invitation, pas un verrou. Rien n'est rendu dans tous les autres états.
 */
export function BillingBanner({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const router = useRouter();
  const [billing, setBilling] = useState<ClubBilling | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adminGetBilling(clubId, token)
      .then((b) => { if (!cancelled) setBilling(b); })
      .catch(() => { if (!cancelled) setBilling(null); });
    return () => { cancelled = true; };
  }, [clubId, token]);

  if (!billing || (billing.state !== 'TO_REGULARIZE' && billing.state !== 'PAST_DUE')) return null;

  const pastDue = billing.state === 'PAST_DUE';
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: 'rgba(232,128,79,0.12)', border: '1px solid rgba(232,128,79,0.5)',
      borderRadius: 12, padding: '12px 16px', margin: '0 0 18px',
    }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, flex: 1, minWidth: 220 }}>
        {pastDue
          ? 'Le paiement de votre abonnement Palova a échoué — mettez votre carte à jour pour régulariser.'
          : <>Votre club dépasse le palier gratuit ({billing.activeMembers} membres actifs).
            Souscrivez pour {eurosFromCents(billing.monthlyPriceCents)} HT/mois — rien n&apos;est bloqué en attendant.</>}
      </span>
      <button onClick={() => router.push('/admin/billing')} style={{
        padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
        fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, background: '#e8804f', color: '#fff',
      }}>
        {pastDue ? 'Mettre à jour' : 'Voir l’offre'}
      </button>
    </div>
  );
}
