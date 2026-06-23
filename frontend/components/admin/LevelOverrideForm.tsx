'use client';
import { useState, CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

// Mappe les codes d'erreur backend en messages français pour l'override de niveau.
const ERROR_LABEL: Record<string, string> = {
  VALIDATION_ERROR: 'Niveau invalide (doit être entre 0 et 8).',
  FORBIDDEN: 'Réservé aux administrateurs du club.',
  LEVEL_SYSTEM_DISABLED: 'Système de niveau désactivé.',
  MEMBER_NOT_FOUND: "Ce joueur n'est pas membre du club.",
};

type SportOption = { key: string; name: string };

// Formulaire de correction manuelle du niveau (réservé ADMIN). Échelle 0–8.
// Sur succès → appelle onSaved() pour recharger la fiche.
export function LevelOverrideForm({
  clubId, userId, token, sports, onSaved,
}: {
  clubId: string;
  userId: string;
  token: string;
  sports: SportOption[];
  onSaved: () => void | Promise<void>;
}) {
  const { th } = useTheme();
  const [sportKey, setSportKey] = useState(sports[0]?.key ?? '');
  const [level, setLevel] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px', fontFamily: th.fontUI, fontSize: 13.5 };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 5 };

  const submit = async () => {
    if (!sportKey) return;
    const num = Number(level);
    if (level.trim() === '' || !Number.isFinite(num) || num < 0 || num > 8) {
      setError('Niveau invalide (doit être entre 0 et 8).');
      return;
    }
    setSaving(true);
    try {
      setError(null);
      await api.adminSetMemberLevel(clubId, userId, { sportKey, level: num, reason: reason.trim() || undefined }, token);
      setLevel('');
      setReason('');
      await onSaved();
    } catch (e) {
      const code = (e as Error).message;
      setError(ERROR_LABEL[code] ?? code);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 4px', color: th.text }}>Corriger le niveau</h2>
      <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '0 0 14px' }}>
        Pose une note fiable (0–8). La correction est globale et tracée dans l'historique.
      </p>

      {error && (
        <div style={{ marginBottom: 14, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        {sports.length > 1 && (
          <label style={label}>Sport
            <select value={sportKey} onChange={(e) => setSportKey(e.target.value)} style={{ ...input, height: 40, width: 150 }}>
              {sports.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label style={label}>Niveau (0–8)
          <input
            type="number" min={0} max={8} step={0.1}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            style={{ ...input, height: 40, width: 100 }}
          />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 200 }}>Motif (facultatif)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. décision du comité, niveau manifestement faux…"
            style={{ ...input, height: 40 }}
          />
        </label>
        <Btn onClick={submit} icon="check" disabled={saving || level.trim() === ''}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Btn>
      </div>
    </div>
  );
}
