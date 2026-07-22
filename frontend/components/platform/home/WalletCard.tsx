'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyWalletEntry } from '@/lib/api';
import { Chip } from '@/components/ui/atoms';
import { packageLabel } from '@/lib/packages';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

// « Mon portefeuille » : abonnements + carnets tous clubs, chip accentColor par club
// (même langage que le marqueur d'agenda). Section absente si tout est vide.
export function WalletCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [entries, setEntries] = useState<MyWalletEntry[] | null>(null);
  useEffect(() => {
    api.getMyWallet(token).then(setEntries).catch(() => setEntries([]));
  }, [token]);
  if (!entries || entries.length === 0) return null;
  const line = { background: th.surface, borderRadius: 14, padding: '10px 13px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 };
  const label = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text } as const;
  const sub = { fontFamily: th.fontUI, fontSize: 12, color: th.textMute } as const;
  return (
    <section>
      <SectionHeader kicker="Mon portefeuille" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.flatMap((e) => [
          ...e.subscriptions.map((s) => (
            <div key={`s-${s.id}`} style={line}>
              <span style={label}>⚡ {s.plan.name}</span>
              <Chip color={e.club.accentColor}>{e.club.name}</Chip>
              <span style={sub}>jusqu&apos;au {fmtDay(s.expiresAt)}</span>
            </div>
          )),
          ...e.packages.map((p) => (
            <div key={`p-${p.id}`} style={line}>
              <span style={label}>🎟 {packageLabel(p)}</span>
              <Chip color={e.club.accentColor}>{e.club.name}</Chip>
              {p.expiresAt && <span style={sub}>jusqu&apos;au {fmtDay(p.expiresAt)}</span>}
            </div>
          )),
        ])}
      </div>
    </section>
  );
}
