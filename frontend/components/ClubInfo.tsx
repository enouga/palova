'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ClubDetail, Announcement, Sponsor, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// Contenu « Infos club » : annonces, prochaines réservations (avec annulation), partenaires.
// L'en-tête/identité et la navigation sont fournis par ClubNav (page /infos).
export function ClubInfo({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [spons, setSpons] = useState<Sponsor[]>([]);
  const [next, setNext] = useState<MyReservation[]>([]);
  const [confirmCancel, setConfirmCancel] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const loadNext = useCallback(async () => {
    if (!token) return;
    try {
      const rs = await api.getMyReservations(token);
      setNext(rs.filter((r) => r.resource.club.slug === club.slug && r.status !== 'CANCELLED' && new Date(r.startTime) > new Date()).slice(0, 3));
    } catch { /* silencieux */ }
  }, [token, club.slug]);

  useEffect(() => { api.getClubAnnouncements(club.slug).then(setAnn).catch(() => setAnn([])); }, [club.slug]);
  useEffect(() => { api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([])); }, [club.slug]);
  useEffect(() => { if (ready && token) loadNext(); }, [ready, token, loadNext]);

  const cancel = async (r: MyReservation) => {
    if (!token) return;
    setCancelling(true);
    try { await api.cancelReservation(r.id, token); setConfirmCancel(null); await loadNext(); }
    catch { /* l'erreur reste affichée dans le dialog via busy off */ }
    finally { setCancelling(false); }
  };

  const sectionTitle = (t: string) => (
    <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>{t}</div>
  );

  const empty = ann.length === 0 && spons.length === 0 && next.length === 0;

  return (
    <>
      {/* Prochaines réservations (joueur connecté) */}
      {next.length > 0 && (
        <div style={{ padding: '22px 20px 0' }}>
          {sectionTitle('Vos prochaines réservations')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {next.map((r) => (
              <button key={r.id} onClick={() => setConfirmCancel(r)} style={{ border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', background: th.surface, borderRadius: 14, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="ticket" size={18} color={th.accent} />
                <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{r.resource.name} · {formatDateTime(r.startTime, r.resource.club.timezone)}</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>Gérer</span>
                <Icon name="arrowR" size={15} color={th.textMute} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Annonces */}
      {ann.length > 0 && (
        <div style={{ padding: '26px 20px 0' }}>
          {sectionTitle('Annonces')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ann.map((a) => (
              <div key={a.id} style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.pinned && <Chip tone="accent">Épinglé</Chip>}
                  <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{a.title}</span>
                </div>
                <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.body}</p>
                {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noreferrer" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.accent }}>En savoir plus →</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Partenaires */}
      {spons.length > 0 && (
        <div style={{ padding: '26px 20px 0' }}>
          {sectionTitle('Partenaires')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {spons.map((s) => (
              <a key={s.id} href={s.linkUrl ?? '#'} target={s.linkUrl ? '_blank' : undefined} rel="noreferrer" title={s.name} style={{ display: 'block' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.logoUrl} alt={s.name} style={{ height: 44, width: 'auto', borderRadius: 8, background: th.surface, padding: 6, objectFit: 'contain' }} />
              </a>
            ))}
          </div>
        </div>
      )}

      {empty && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
          Pas d&apos;informations pour le moment.
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Annuler la réservation ?"
          detail={<>{confirmCancel.resource.name} · {formatDateTime(confirmCancel.startTime, confirmCancel.resource.club.timezone)}</>}
          message="Cette action est définitive : le créneau sera remis à disposition des autres joueurs."
          confirmLabel="Annuler la réservation"
          cancelLabel="Retour"
          busy={cancelling}
          onConfirm={() => cancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </>
  );
}
