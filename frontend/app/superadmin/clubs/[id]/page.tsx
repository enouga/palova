'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { api, PlatformClubDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MemberGauge } from '@/components/billing/MemberGauge';
import { ChangeSlugDialog } from '@/components/superadmin/ChangeSlugDialog';
import { TierChangeDialog } from '@/components/superadmin/TierChangeDialog';
import { CountBarsChart } from '@/components/superadmin/CountBarsChart';
import { KpiCard } from '@/components/superadmin/KpiCard';
import { BILLING_STATE_LABEL, invoiceStatusLabel, intervalLabel, formatDate, formatPeriod } from '@/lib/platformBilling';
import { eurosFromCents } from '@/lib/payments';
import { tierLabel } from '@/lib/platformTiers';
import { CANONICAL_ROOT } from '@/lib/roots';

export default function SuperAdminClubDetail() {
  const { th } = useTheme();
  const { token } = useAuth();
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '';

  const [club, setClub] = useState<PlatformClubDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<'status' | 'slug' | 'tier' | 'cancel' | 'resume' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token || !id) return;
    api.platformClubDetail(id, token).then(setClub).catch(() => setNotFound(true));
  }, [token, id]);

  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, badMsg: string) {
    if (!token || busy) return;
    setBusy(true); setError(null);
    try { await fn(); setDialog(null); load(); }
    catch (err) {
      const m = (err as Error).message;
      setError(m === 'NO_SUBSCRIPTION' ? "Ce club n'a pas d'abonnement actif." : badMsg);
    } finally { setBusy(false); }
  }

  const card: React.CSSProperties = {
    background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '18px 20px', marginBottom: 16,
  };
  const actionBtn: React.CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text,
    borderRadius: 9, padding: '8px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
  };
  const sectionTitle: React.CSSProperties = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text, marginBottom: 12 };

  if (notFound) {
    return (
      <div>
        <Link href="/superadmin/clubs" style={{ color: th.textMute, fontSize: 13.5, textDecoration: 'none' }}>← Clubs</Link>
        <p style={{ color: th.textFaint, fontFamily: th.fontUI, marginTop: 20 }}>Ce club est introuvable.</p>
      </div>
    );
  }
  if (!club) return <div style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</div>;

  const sub = club.billing.subscription;
  const stateColor = club.billing.state === 'OK' ? th.accent
    : club.billing.state === 'PAST_DUE' ? th.danger
    : club.billing.state === 'TO_REGULARIZE' ? th.warning : th.textFaint;

  return (
    <div>
      <Link href="/superadmin/clubs" style={{ color: th.textMute, fontSize: 13.5, textDecoration: 'none' }}>← Clubs</Link>

      {/* Identité */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 6px', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontSize: 30, fontWeight: 700, color: th.text, margin: 0 }}>{club.name}</h1>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: club.status === 'ACTIVE' ? th.accent : th.textFaint }}>
          {club.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}
        </span>
      </div>
      <div style={{ fontFamily: th.fontMono, fontSize: 13, color: th.textMute }}>{club.slug}.{CANONICAL_ROOT}</div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 4 }}>
        {club.city ? `${club.city} · ` : ''}créé le {formatDate(club.createdAt)}
        {club.aliases.length > 0 && <> · alias : {club.aliases.join(', ')}</>}
      </div>
      {club.owners.length > 0 && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 3 }}>
          Gérant{club.owners.length > 1 ? 's' : ''} : {club.owners.map((o) => o.email).join(', ')}
        </div>
      )}
      {club.siret && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 }}>
          SIRET : {club.siret}{club.siretLegalName ? ` · ${club.siretLegalName}` : ''}
          {' · '}{club.siretVerifiedAt ? 'vérifié' : 'non vérifié'}
        </div>
      )}

      {/* Actions club */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0 22px' }}>
        <button style={actionBtn} onClick={() => setDialog('status')}>
          {club.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
        </button>
        <button style={actionBtn} onClick={() => run(
          () => api.platformSetBillingExempt(club.id, !club.billing.exempt, token!),
          "Échec de la mise à jour de l'exonération.",
        )}>
          {club.billing.exempt ? 'Rétablir la facturation' : 'Exonérer'}
        </button>
        <button style={actionBtn} onClick={() => setDialog('slug')}>Changer l&apos;alias</button>
      </div>

      {error && (
        <div style={{ fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600, marginBottom: 16 }}>{error}</div>
      )}

      {/* Billing */}
      <MemberGauge count={club.billing.activeMembers} countedAt={club.billing.countedAt} />

      <section style={card}>
        <div style={sectionTitle}>Facturation</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: stateColor, marginBottom: 6 }}>
          {BILLING_STATE_LABEL[club.billing.state]}
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Palier observé : <strong>T{club.billing.observedTier}</strong> — {tierLabel(club.billing.observedTier)}
        </div>
        {sub ? (
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 6 }}>
            Souscrit : <strong>T{sub.tier}</strong> · {intervalLabel(sub.interval)} · {eurosFromCents(sub.priceCents)} HT
            {sub.currentPeriodEnd && <> · prochaine échéance le {formatDate(sub.currentPeriodEnd)}</>}
            {sub.cancelAtPeriodEnd && <> · <strong>s&apos;arrête à échéance</strong></>}
          </div>
        ) : (
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, marginTop: 6 }}>
            Aucun abonnement actif.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <button style={{ ...actionBtn, opacity: sub ? 1 : 0.4, cursor: sub ? 'pointer' : 'not-allowed' }}
            disabled={!sub} onClick={() => sub && setDialog('tier')}>
            Changer le palier
          </button>
          {sub && !sub.cancelAtPeriodEnd && (
            <button style={actionBtn} onClick={() => setDialog('cancel')}>Annuler à échéance</button>
          )}
          {sub && sub.cancelAtPeriodEnd && (
            <button style={actionBtn} onClick={() => setDialog('resume')}>Réactiver l&apos;abonnement</button>
          )}
        </div>
      </section>

      {/* Historique membres actifs */}
      {club.billing.snapshots.length > 0 && (
        <section style={card}>
          <div style={sectionTitle}>Historique mensuel (membres actifs)</div>
          {club.billing.snapshots.map((s) => (
            <div key={s.month} style={{
              display: 'flex', justifyContent: 'space-between', padding: '7px 0',
              borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
            }}>
              <span style={{ fontFamily: th.fontMono }}>{s.month}</span>
              <span>{s.activeMembers} membres actifs</span>
              <span style={{ color: th.textMute }}>T{s.tier}</span>
            </div>
          ))}
        </section>
      )}

      {/* Factures */}
      <section style={card}>
        <div style={sectionTitle}>Factures</div>
        {club.billing.invoices.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucune facture enregistrée.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
              <thead><tr>
                {['Date', 'Période', 'Palier', 'Montant', 'Statut', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: i >= 3 && i <= 3 ? 'right' : 'left', padding: '6px 8px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${th.line}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {club.billing.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ padding: '8px', fontSize: 13, color: th.text, borderBottom: `1px solid ${th.line}` }}>{formatDate(inv.createdAt)}</td>
                    <td style={{ padding: '8px', fontSize: 12.5, color: th.textMute, borderBottom: `1px solid ${th.line}` }}>{formatPeriod(inv.periodStart, inv.periodEnd)}</td>
                    <td style={{ padding: '8px', fontSize: 13, color: th.textMute, borderBottom: `1px solid ${th.line}` }}>{inv.tier != null ? `T${inv.tier}` : '—'}</td>
                    <td style={{ padding: '8px', fontSize: 13, textAlign: 'right', fontFamily: th.fontMono, color: th.text, borderBottom: `1px solid ${th.line}` }}>{eurosFromCents(inv.amountCents)}</td>
                    <td style={{ padding: '8px', fontSize: 12.5, fontWeight: 700, color: inv.status === 'paid' ? th.accent : inv.status === 'failed' ? th.danger : th.textFaint, borderBottom: `1px solid ${th.line}` }}>{invoiceStatusLabel(inv.status)}</td>
                    <td style={{ padding: '8px', fontSize: 12.5, borderBottom: `1px solid ${th.line}` }}>
                      {inv.hostedInvoiceUrl && (
                        <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" style={{ color: th.accent, textDecoration: 'none' }}>Voir sur Stripe</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Activité */}
      <section style={card}>
        <div style={sectionTitle}>Activité — réservations confirmées / mois</div>
        <CountBarsChart series={club.activity.reservationsByMonth} unit="résas" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 16 }}>
          <KpiCard label="Résas 30 j" value={club.activity.reservations30d} />
          <KpiCard label="Adhérents" value={club.counts.adherents} />
          <KpiCard label="Terrains" value={club.counts.resources} />
          <KpiCard label="Tournois" value={club.counts.tournaments} />
          <KpiCard label="Events" value={club.counts.events} />
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, marginTop: 12 }}>
          Dernière réservation : {formatDate(club.activity.lastReservationAt)}
        </div>
      </section>

      {/* Dialogues */}
      {dialog === 'status' && (
        <ConfirmDialog
          title={club.status === 'ACTIVE' ? `Suspendre ${club.name} ?` : `Réactiver ${club.name} ?`}
          message={club.status === 'ACTIVE'
            ? "Le club disparaîtra de l'annuaire public et sa page ne sera plus accessible."
            : "Le club redeviendra visible dans l'annuaire et sa page sera de nouveau accessible."}
          confirmLabel={club.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
          busy={busy}
          onConfirm={() => run(
            () => api.platformSetClubStatus(club.id, club.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', token!),
            'Échec de la mise à jour du statut.',
          )}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'slug' && (
        <ChangeSlugDialog club={{ id: club.id, slug: club.slug, name: club.name }}
          onDone={() => { setDialog(null); load(); }} onCancel={() => setDialog(null)} />
      )}
      {dialog === 'tier' && sub && (
        <TierChangeDialog clubId={club.id} currentTier={sub.tier} currentInterval={sub.interval}
          onDone={() => { setDialog(null); load(); }} onCancel={() => setDialog(null)} />
      )}
      {dialog === 'cancel' && (
        <ConfirmDialog
          title="Annuler l'abonnement à échéance ?"
          message="L'abonnement restera actif jusqu'à la fin de la période en cours, puis s'arrêtera. Aucun remboursement."
          confirmLabel="Annuler à échéance"
          busy={busy}
          onConfirm={() => run(() => api.platformCancelSubscription(club.id, token!), "Échec de l'annulation.")}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'resume' && (
        <ConfirmDialog
          title="Réactiver l'abonnement ?"
          message="L'abonnement ne s'arrêtera plus à échéance et continuera normalement."
          confirmLabel="Réactiver"
          busy={busy}
          onConfirm={() => run(() => api.platformResumeSubscription(club.id, token!), 'Échec de la réactivation.')}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
