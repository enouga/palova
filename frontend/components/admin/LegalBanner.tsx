'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubAdminDetail } from '@/lib/api';

/** Un club encaisse en ligne (Stripe ACTIVE) sans coordonnées légales complètes : ses pages
 *  légales (repli compris) affichent des « [à compléter] ». Invitation, jamais un verrou. */
export function LegalBanner({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const router = useRouter();
  const [club, setClub] = useState<ClubAdminDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adminGetClub(clubId, token)
      .then((c) => { if (!cancelled) setClub(c); })
      .catch(() => { if (!cancelled) setClub(null); });
    return () => { cancelled = true; };
  }, [clubId, token]);

  if (!club || club.stripeAccountStatus !== 'ACTIVE') return null;
  const complete = [club.legalEntityName, club.siret, club.legalEmail, club.mediatorName]
    .every((v) => (v ?? '').trim().length > 0);
  if (complete) return null;

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: 'rgba(56,102,176,0.10)', border: '1px solid rgba(56,102,176,0.45)',
      borderRadius: 12, padding: '12px 16px', margin: '0 0 18px',
    }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, flex: 1, minWidth: 220 }}>
        Vous encaissez en ligne : complétez vos informations légales (raison sociale, SIRET,
        contact, médiateur de la consommation) — elles apparaissent sur vos mentions légales et vos CGV.
      </span>
      <button onClick={() => router.push('/admin/pages')} style={{
        padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
        fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, background: th.accent, color: th.onAccent,
      }}>Compléter</button>
    </div>
  );
}
