'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from '@/components/ui/Icon';
import { useTheme } from '@/lib/ThemeProvider';

export type ProfileNavItem = { id: string; icon: IconName; label: string };

const GAP = 8; // marge entre la barre collante et le titre de section ancré

// Menu de navigation intra-page du profil. Une seule ligne (icône au-dessus, libellé
// court en dessous), items en flex:1 → jamais de scroll horizontal ; sous 360px le
// libellé s'efface, l'icône reste. Collant sous le header (topOffset = hauteur du
// ClubNav collant, 0 sur l'hôte plateforme). Surligne la section visible et défile
// en douceur au clic. Expose --profile-anchor (offset des ancres) pour scroll-margin-top.
export function ProfileSectionNav({ items, topOffset = 0 }: { items: ProfileNavItem[]; topOffset?: number }) {
  const { th } = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const ids = items.map((it) => it.id).join(',');

  // Variable CSS pour le scroll-margin-top des sections (= header + barre + marge).
  // La hauteur du menu est constante après montage ; on resynchronise --profile-anchor
  // seulement quand topOffset ou le set d'items change.
  useEffect(() => {
    const h = navRef.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--profile-anchor', `${topOffset + h + GAP}px`);
  }, [topOffset, ids]);

  // Scroll-spy : la section la plus haute sous la ligne des barres collantes gagne.
  useEffect(() => {
    const offset = topOffset + (navRef.current?.offsetHeight ?? 0) + GAP;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        setActive((top.target as HTMLElement).id);
      },
      { rootMargin: `-${offset}px 0px -55% 0px`, threshold: 0 },
    );
    ids.split(',').forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids, topOffset]);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav
      ref={navRef}
      className="psn"
      aria-label="Sections du profil"
      style={{
        position: 'sticky', top: topOffset, zIndex: 40, display: 'flex', gap: 4,
        background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
        padding: 6, margin: '14px 20px 0', boxShadow: th.shadowSoft,
      }}
    >
      <style>{`@media (max-width:360px){ .psn .psn-lbl { display:none; } }`}</style>
      {items.map((it) => {
        const on = active === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => go(it.id)}
            aria-current={on ? 'location' : undefined}
            style={{
              flex: '1 1 0', minWidth: 0, cursor: 'pointer', border: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              borderRadius: 11, padding: '6px 2px',
              background: on ? th.accent : 'transparent', color: on ? th.onAccent : th.textMute,
              fontFamily: th.fontUI, transition: 'background .15s, color .15s',
            }}
          >
            <Icon name={it.icon} size={16} color={on ? th.onAccent : th.textMute} />
            <span
              className="psn-lbl"
              style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
