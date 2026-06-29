'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, AccountDeletionSummary } from '@/lib/api';
import { logout } from '@/lib/useAuth';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Props { token: string; }

const DELETE_ERR_FR: Record<string, string> = {
  INVALID_PASSWORD: 'Mot de passe incorrect.',
  OWNS_CLUB: 'Vous gérez encore un club : transférez la gestion avant de supprimer votre compte.',
};

/** Suppression (anonymisation) du compte — globale, avec avertissements + re-saisie du mot de passe. */
export function DeleteAccountSection({ token }: Props) {
  const { th } = useTheme();
  const [summary, setSummary] = useState<AccountDeletionSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.getAccountDeletionSummary(token).then(setSummary).catch(() => {}); }, [token]);

  const blocked = (summary?.blockingClubs.length ?? 0) > 0;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.deleteMyAccount(password, token);
      logout();
    } catch (e) {
      setError(DELETE_ERR_FR[(e as Error).message] ?? (e as Error).message);
    } finally { setBusy(false); }
  };

  const warnings: React.ReactNode = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocked ? (
        <span>Vous êtes l’unique gestionnaire de : <strong>{summary!.blockingClubs.join(', ')}</strong>. Transférez la gestion avant de supprimer votre compte.</span>
      ) : (
        <>
          {summary && summary.futureReservations > 0 && <span>{summary.futureReservations} réservation(s) à venir seront annulées.</span>}
          {summary && summary.activeSubscriptions > 0 && <span>Votre abonnement actif sera perdu (aucun remboursement).</span>}
          {summary && summary.balances.length > 0 && <span>Soldes perdus (aucun remboursement) : {summary.balances.join(', ')}.</span>}
          <span>Cette action est définitive. Saisissez votre mot de passe pour confirmer.</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            aria-label="Mot de passe" placeholder="Mot de passe"
            style={{ width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text }} />
          {error && <span style={{ color: th.accent, fontWeight: 600 }}>{error}</span>}
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>
        Supprime définitivement votre compte. Vos informations personnelles sont effacées ; l’historique comptable des clubs est conservé de façon anonyme.
      </span>
      <button onClick={() => { setOpen(true); setError(null); setPassword(''); }}
        style={{ alignSelf: 'flex-start', cursor: 'pointer', border: `1px solid ${th.line}`, background: 'transparent', color: th.accent, borderRadius: 11, padding: '10px 18px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5 }}>
        Supprimer mon compte
      </button>

      {open && (
        <ConfirmDialog
          title="Supprimer mon compte"
          message={warnings}
          confirmLabel="Supprimer définitivement"
          cancelLabel="Annuler"
          busy={busy}
          confirmDisabled={blocked || password.length === 0}
          onConfirm={submit}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}
