'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export type SportOption = { id: string; name: string; icon?: string | null };

// Résumé de la sélection : "Padel", "Padel, Tennis", "Padel +2" (1er nom + reste).
function summarize(sports: SportOption[], selectedIds: string[]): string {
  const names = sports.filter((s) => selectedIds.includes(s.id)).map((s) => s.name);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}

// Sélecteur de sport discret : lien « <résumé> · changer » qui ouvre un panneau de cases
// à cocher. Au moins un sport reste toujours coché. Ferme au clic extérieur. Cocher conserve
// l'ordre fourni (ordre du club).
export function SportPicker({ sports, selectedIds, onChange }: {
  sports: SportOption[]; selectedIds: string[]; onChange: (ids: string[]) => void;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length === 1) return; // garde : au moins un sport affiché
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      // ajout en conservant l'ordre du club
      onChange(sports.filter((s) => selectedIds.includes(s.id) || s.id === id).map((s) => s.id));
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
        <span style={{ color: th.text, fontWeight: 600 }}>{summarize(sports, selectedIds)}</span>
        <span>· changer</span>
      </button>
      {open && (
        <div role="group" aria-label="Choisir les sports affichés"
          style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 20, minWidth: 200, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 13, boxShadow: th.shadow, padding: 6 }}>
          {sports.map((s) => {
            const on = selectedIds.includes(s.id);
            return (
              <button key={s.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: '9px 10px', borderRadius: 9, fontFamily: th.fontUI, fontSize: 14, color: th.text, textAlign: 'left' }}>
                <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.6px solid ${on ? th.accent : th.line}`, background: on ? th.accent : 'transparent', color: th.onAccent, fontSize: 12 }}>{on ? '✓' : ''}</span>
                {s.icon ? `${s.icon} ` : ''}{s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
