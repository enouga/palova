'use client';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  dirty: boolean;
  saving: boolean;
  /** Erreur d'ENREGISTREMENT uniquement (les erreurs de chargement/upload vivent dans le bandeau haut). */
  error: string | null;
  /** Flash « Enregistré ✓ » après une sauvegarde réussie. */
  saved?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/** Barre sticky d'enregistrement global. Rendue si dirty, erreur d'enregistrement, ou flash de succès. */
export function SaveBar({ dirty, saving, error, saved, onSave, onCancel }: Props) {
  const { th } = useTheme();
  if (!dirty && !error && !saved) return null;
  // Boutons seulement quand il y a quelque chose à enregistrer / réessayer (pas sur le simple flash).
  const showActions = dirty || !!error;
  return (
    <div style={{
      position: 'sticky', bottom: 0, zIndex: 20, marginTop: 20,
      background: th.mode === 'floodlit' ? th.surface2 : '#1d2433',
      color: '#fff', borderRadius: 14, padding: '12px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      boxShadow: '0 -6px 24px rgba(0,0,0,.28)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        {error ? (
          <span role="alert" style={{ fontFamily: th.fontUI, fontSize: 13, color: '#ffd1c9', fontWeight: 600 }}>{error}</span>
        ) : dirty ? (
          <>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#fff' }}>Modifications non enregistrées</span>
          </>
        ) : (
          <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#7ee0a8', fontWeight: 600 }}>Enregistré ✓</span>
        )}
      </div>
      {showActions && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ padding: '9px 15px', borderRadius: 10, border: 'none', background: 'transparent', color: '#cdd6e6', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
            Annuler
          </button>
          <button type="button" onClick={onSave} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}
