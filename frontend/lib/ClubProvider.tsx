'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ClubDetail } from '@/lib/api';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ThemeMode } from '@/lib/theme';

interface ClubContextValue { slug: string | null; club: ClubDetail | null; loading: boolean; refresh: () => void; }
const ClubContext = createContext<ClubContextValue>({ slug: null, club: null, loading: false, refresh: () => {} });

/** Reçoit le slug (lu par le layout serveur depuis l'en-tête x-club-slug),
 *  fetch le club et brande tout le sous-arbre. Slug null = plateforme. */
export function ClubProvider({ slug, children }: { slug: string | null; children: React.ReactNode }) {
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(!!slug);

  // Recharge le club depuis l'API. Exposé via le contexte (refresh) pour que les
  // changements de réglages du back-office (paiement en ligne, tarifs, fenêtres…) se
  // reflètent dans le reste de l'app sans rechargement de page — le provider étant monté
  // à la racine, son effet de montage ne re-fetch jamais autrement (deps [slug] stable).
  // En cas d'échec transitoire d'un refresh manuel on garde le club courant (pas de blanc).
  const refresh = useCallback(async () => {
    if (!slug) return;
    try { setClub(await api.getClub(slug)); } catch { /* on garde le club courant */ }
  }, [slug]);

  useEffect(() => {
    if (!slug) { setClub(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.getClub(slug)
      .then((c) => { if (!cancelled) setClub(c); })
      .catch(() => { if (!cancelled) setClub(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <ClubContext.Provider value={{ slug, club, loading, refresh }}>
      <ThemeProvider accent={club?.accentColor} defaultMode={club?.defaultThemeMode as ThemeMode | undefined}>
        {children}
      </ThemeProvider>
    </ClubContext.Provider>
  );
}

export function useClub(): ClubContextValue { return useContext(ClubContext); }
