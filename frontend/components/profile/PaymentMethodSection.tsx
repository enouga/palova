'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyPaymentMethod } from '@/lib/api';
import { cardLabel } from '@/lib/payments';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { AccountEmpty } from './AccountEmpty';

interface Props { slug: string; token: string; }

/** Carte enregistrée du club courant : affichage + retrait (ConfirmDialog). */
export function PaymentMethodSection({ slug, token }: Props) {
  const { th } = useTheme();
  const [card, setCard] = useState<MyPaymentMethod | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getMyPaymentMethod(slug, token).then((c) => { setCard(c); setLoaded(true); }).catch(() => setLoaded(true));
  }, [slug, token]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeMyPaymentMethod(slug, token);
      setCard(null);
      setConfirming(false);
    } finally { setBusy(false); }
  };

  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, lineHeight: 1.4, color: th.textFaint };

  if (!loaded) return <span style={faint}>Chargement…</span>;

  if (!card) {
    return <AccountEmpty icon="card" title="Aucune carte enregistrée"
      hint="Enregistrez une carte lors d’une prochaine réservation pour payer en un clic." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface2, borderRadius: 13, padding: '11px 13px' }}>
        <span aria-hidden="true" style={{
          width: 42, height: 30, flexShrink: 0, borderRadius: 7, background: th.surface,
          boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="card" size={18} color={th.textMute} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, flex: 1, minWidth: 0 }}>{cardLabel(card)}</span>
        <button onClick={() => setConfirming(true)}
          style={{ cursor: 'pointer', background: 'transparent', border: `1px solid ${th.line}`, borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, flexShrink: 0 }}>
          Retirer
        </button>
      </div>
      <span style={faint}>Cette carte sert d’empreinte (anti no-show) et aux débits liste d’attente. Le club pourra la redemander à votre prochaine réservation.</span>

      {confirming && (
        <ConfirmDialog
          title="Retirer ma carte ?"
          message="Votre carte enregistrée sera supprimée. Vous pourrez en enregistrer une nouvelle lors d’une prochaine réservation."
          confirmLabel="Retirer ma carte"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
