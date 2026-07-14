'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// La fiche membre vit désormais dans le maître-détail : /admin/members?m=<userId>.
// Cette route ne subsiste que pour les liens/bookmarks historiques.
export default function MemberRedirect() {
  const params = useParams();
  const router = useRouter();
  const userId = Array.isArray(params.userId) ? params.userId[0] : (params.userId as string);
  useEffect(() => { if (userId) router.replace(`/admin/members?m=${userId}`); }, [router, userId]);
  return null;
}
