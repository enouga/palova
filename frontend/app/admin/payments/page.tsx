'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { isClubOwner, useAdminRole } from '@/lib/adminRole';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StripeSetupGuide } from '@/components/admin/StripeSetupGuide';

const STATUS_META: Record<string, { dot: string; label: string }> = {
  NONE:       { dot: '#9ca3af', label: 'Non connecté' },
  PENDING:    { dot: '#f59e0b', label: 'Onboarding en cours' },
  RESTRICTED: { dot: '#f59e0b', label: 'Compte restreint' },
  ACTIVE:     { dot: '#22c55e', label: 'Compte actif' },
};

export default function AdminPaymentsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub } = useClub();
  const clubId = hostClub?.id;
  const role = useAdminRole();
  const owner = isClubOwner(role);

  const [club, setClub]       = useState<ClubAdminDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [saved, setSaved]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const card: CSSProperties = {
    background: th.surface, border: `1px solid ${th.line}`,
    borderRadius: 18, padding: 24, marginBottom: 20,
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setClub(await api.adminGetClub(clubId, token)); setDirty(false); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId && owner) load(); }, [ready, token, clubId, owner, load]);

  // Retour d'onboarding Stripe (?stripe=return|refresh) → resync du statut.
  useEffect(() => {
    if (!ready || !token || !clubId || !owner) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'return' || params.get('stripe') === 'refresh') {
      api.getStripeStatus(clubId, token).then(() => {
        window.history.replaceState({}, '', window.location.pathname);
        load();
      }).catch(() => {});
    }
  }, [ready, token, clubId, owner, load]);

  const handleConnect = async () => {
    if (!token || !clubId) return;
    setConnecting(true);
    try {
      const base = window.location.href.split('?')[0];
      const { url } = await api.initiateStripeConnect(
        clubId, { refreshUrl: `${base}?stripe=refresh`, returnUrl: `${base}?stripe=return` }, token,
      );
      window.location.href = url;
    } catch { setConnecting(false); }
  };

  const handleLoginLink = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!token || !clubId) return;
    try { const { url } = await api.getStripeLoginLink(clubId, token); window.open(url, '_blank'); }
    catch { /* ignore */ }
  };

  const handleRefresh = async () => {
    if (!token || !clubId) return;
    try { await api.getStripeStatus(clubId, token); await load(); } catch { /* ignore */ }
  };

  const setFlag = (key: 'requireOnlinePayment' | 'requireCardFingerprint', value: boolean) => {
    if (!club) return;
    setClub({ ...club, [key]: value });
    setDirty(true);
    setSaved(false);
  };

  const savePaymentSettings = async () => {
    if (!token || !clubId || !club) return;
    setSaving(true);
    try {
      await api.adminUpdateClub(clubId, {
        requireOnlinePayment: club.requireOnlinePayment,
        requireCardFingerprint: club.requireCardFingerprint,
      }, token);
      setDirty(false);
      setSaved(true);
    } catch { load(); } // revert depuis la source en cas d'échec
    finally { setSaving(false); }
  };

  const handleDisconnect = async () => {
    if (!token || !clubId) return;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await api.disconnectStripe(clubId, token);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      const err = e as Error & { count?: number };
      if (err.message === 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS') {
        setDisconnectError(
          `${err.count ?? 0} paiement(s) CB sur des réservations à venir — remboursez-les ou attendez qu'elles soient passées avant de changer de compte.`,
        );
      } else {
        setDisconnectError('Le changement a échoué. Réessayez.');
      }
    } finally {
      setDisconnecting(false);
    }
  };

  // Réservé au gérant : le compte Stripe/bancaire du club n'est géré que par le OWNER
  // (les routes /stripe/* répondent 403 aux autres — défense en profondeur).
  if (!owner) return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée au gérant du club.</div>;
  if (loading) return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div>;
  if (error || !club) return <div style={{ padding: 24, fontFamily: th.fontUI, color: '#ef4444' }}>{error ?? 'Erreur de chargement'}</div>;

  const status = club.stripeAccountStatus;
  const meta = STATUS_META[status] ?? STATUS_META.NONE;
  const linked = status !== 'NONE';

  return (
    <div style={{ maxWidth: 720, padding: 24 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 28, margin: '0 0 4px', color: th.text }}>Paiement en ligne</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 24px' }}>
        Acceptez les paiements CB en ligne et les empreintes bancaires via Stripe.
      </p>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.dot, display: 'inline-block' }} />
          <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 600, color: th.text }}>{meta.label}</span>
          {linked && (
            <button onClick={handleRefresh} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${th.line}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
              Rafraîchir le statut
            </button>
          )}
        </div>

        {status === 'NONE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>
              Connectez votre compte Stripe pour accepter les paiements CB en ligne et enregistrer des empreintes bancaires.
            </p>
            <div>
              <button onClick={handleConnect} disabled={connecting} style={{ background: '#635bff', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', cursor: connecting ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, opacity: connecting ? 0.7 : 1 }}>
                {connecting ? 'Redirection…' : 'Connecter mon compte Stripe'}
              </button>
            </div>
          </div>
        )}

        {status === 'PENDING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Terminez votre inscription Stripe pour activer les paiements.</span>
            <div>
              <button onClick={handleConnect} disabled={connecting} style={{ background: th.surface2, color: th.text, border: `1px solid ${th.line}`, borderRadius: 9, padding: '8px 16px', cursor: connecting ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 14 }}>
                {connecting ? 'Redirection…' : "Reprendre l'onboarding"}
              </button>
            </div>
          </div>
        )}

        {status === 'RESTRICTED' && (
          <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Compte restreint — vérifiez votre tableau de bord Stripe pour lever les restrictions.</span>
        )}

        {status === 'ACTIVE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <a href="#" onClick={handleLoginLink} style={{ fontFamily: th.fontUI, fontSize: 14, color: th.accent }}>Tableau de bord Stripe ↗</a>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: th.fontUI, fontSize: 15, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={club.requireOnlinePayment} onChange={(e) => setFlag('requireOnlinePayment', e.target.checked)} style={{ width: 16, height: 16, accentColor: th.accent }} />
                Exiger le paiement CB à la réservation
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: th.fontUI, fontSize: 15, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={club.requireCardFingerprint} onChange={(e) => setFlag('requireCardFingerprint', e.target.checked)} style={{ width: 16, height: 16, accentColor: th.accent }} />
                Enregistrer une empreinte bancaire (protection no-show)
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
              <Btn onClick={savePaymentSettings} icon="check" disabled={saving || !dirty}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </Btn>
              {saved && !dirty && <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.accent, fontWeight: 600 }}>Enregistré ✓</span>}
            </div>
          </div>
        )}
      </div>

      <StripeSetupGuide status={status} />

      {linked && (
        <div style={card}>
          <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 8px', color: th.text }}>Changer de compte Stripe</h2>
          <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 14px', lineHeight: 1.5 }}>
            Délier le compte actuel pour en connecter un autre. Les empreintes bancaires enregistrées seront supprimées.
          </p>
          <Btn variant="danger" onClick={() => { setDisconnectError(null); setConfirmOpen(true); }}>Changer de compte Stripe</Btn>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Changer de compte Stripe"
          message={
            <span>
              Conséquences :
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>les empreintes bancaires enregistrées seront supprimées — les clients devront re-saisir leur carte ;</li>
                <li>le paiement CB sera désactivé jusqu’au nouvel onboarding ;</li>
                <li>les remboursements des paiements CB déjà encaissés sur l’ancien compte ne seront plus possibles.</li>
              </ul>
              {disconnectError && (
                <span style={{ display: 'block', marginTop: 12, color: '#ef4444', fontWeight: 600 }}>{disconnectError}</span>
              )}
            </span>
          }
          confirmLabel="Changer de compte"
          busy={disconnecting}
          onConfirm={handleDisconnect}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
