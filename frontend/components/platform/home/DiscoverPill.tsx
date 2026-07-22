'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';

// Porte vers /decouvrir (pré-rempli ?q= / géoloc ?pres=1) — pas une recherche embarquée.
export function DiscoverPill() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const goSearch = () => router.push(`/decouvrir${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  return (
    <LocationSearchPill value={q} onChange={setQ} onSubmit={goSearch}
      onNearMe={() => router.push('/decouvrir?pres=1')} nearActive={false} locating={false} />
  );
}
