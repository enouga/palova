'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Markdown } from '@/components/ui/Markdown';
import { PLATFORM_FAQ } from '@/lib/platformContent';

interface Entry { id: string; category: string; question: string; answer: string }

function AccordionItem({ entry }: { entry: Entry }) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: th.surface, border: `1px solid ${th.line}`, borderRadius: 14, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          fontFamily: th.fontUI, fontSize: 15.5, fontWeight: 600, color: th.text,
        }}
      >
        <span style={{ flex: 1 }}>{entry.question}</span>
        <span style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
          <Icon name="chevR" size={18} color={th.textMute} />
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 16px' }}>
          <Markdown>{entry.answer}</Markdown>
        </div>
      )}
    </div>
  );
}

/** FAQ publique : club (socle interpolé + items du club) ou plateforme (statique). */
export function FaqView() {
  const { slug } = useClub();
  const { th } = useTheme();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!slug) {
      setEntries(PLATFORM_FAQ.map((e, i) => ({ id: `p${i}`, ...e })));
      return;
    }
    let cancelled = false;
    setEntries(null); setFailed(false);
    api.getClubFaq(slug)
      .then((res) => {
        if (cancelled) return;
        const merged: Entry[] = [
          ...res.socle.map((s) => ({ id: s.id, category: s.category, question: s.question, answer: s.answer })),
          ...res.custom.map((c) => ({ id: c.id, category: c.category || 'Le club', question: c.question, answer: c.answer })),
        ];
        setEntries(merged);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [slug]);

  // Regroupe par rubrique, dans l'ordre de première apparition.
  const groups = useMemo(() => {
    if (!entries) return [];
    const order: string[] = [];
    const byCat = new Map<string, Entry[]>();
    for (const e of entries) {
      if (!byCat.has(e.category)) { byCat.set(e.category, []); order.push(e.category); }
      byCat.get(e.category)!.push(e);
    }
    return order.map((cat) => ({ cat, items: byCat.get(cat)! }));
  }, [entries]);

  if (failed) return <p style={{ color: th.textFaint }}>La FAQ est momentanément indisponible.</p>;
  if (!entries) return <p style={{ color: th.textFaint }}>Chargement…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <h1 style={{ fontFamily: th.fontUI, fontSize: 28, fontWeight: 800, letterSpacing: -0.4, color: th.text, margin: '0 0 -4px' }}>Questions fréquentes</h1>
      {groups.map((g) => (
        <section key={g.cat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, margin: '0 0 2px' }}>{g.cat}</h2>
          {g.items.map((e) => <AccordionItem key={e.id} entry={e} />)}
        </section>
      ))}
    </div>
  );
}
