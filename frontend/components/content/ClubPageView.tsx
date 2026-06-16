'use client';

import { useEffect, useState } from 'react';
import { api, ClubPageKind } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Markdown } from '@/components/ui/Markdown';
import { UpdatedAt } from './ContentShell';

type State =
  | { kind: 'loading' }
  | { kind: 'club'; body: string; updatedAt: string }
  | { kind: 'platform'; body: string }
  | { kind: 'empty' };

/**
 * Page de contenu (CGV, mentions, confidentialité, offres) :
 * - sur un sous-domaine club → contenu publié du club (sinon état « à venir ») ;
 * - sur la plateforme → contenu statique Palova fourni en repli.
 */
export function ClubPageView({ pageKind, platformBody }: { pageKind: ClubPageKind; platformBody: string }) {
  const { slug } = useClub();
  const { th } = useTheme();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!slug) { setState({ kind: 'platform', body: platformBody }); return; }
    let cancelled = false;
    setState({ kind: 'loading' });
    api.getClubPage(slug, pageKind)
      .then((p) => { if (!cancelled) setState({ kind: 'club', body: p.bodyMarkdown, updatedAt: p.updatedAt }); })
      .catch(() => { if (!cancelled) setState({ kind: 'empty' }); });
    return () => { cancelled = true; };
  }, [slug, pageKind, platformBody]);

  if (state.kind === 'loading') {
    return <p style={{ color: th.textFaint }}>Chargement…</p>;
  }
  if (state.kind === 'empty') {
    return (
      <div style={{ background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16, padding: 24 }}>
        <p style={{ color: th.textMute, margin: 0 }}>Cette page n'est pas encore disponible. Revenez bientôt !</p>
      </div>
    );
  }
  return (
    <>
      {state.kind === 'club' && <UpdatedAt iso={state.updatedAt} />}
      <Markdown>{state.body}</Markdown>
    </>
  );
}
