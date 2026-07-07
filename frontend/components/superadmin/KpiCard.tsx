'use client';
import Link from 'next/link';
import { useTheme } from '@/lib/ThemeProvider';

/** Carte KPI du superadmin (label / valeur / sous-titre), cliquable si `href`. */
export function KpiCard({ label, value, sub, href }: {
  label: string; value: number | string; sub?: string; href?: string;
}) {
  const { th } = useTheme();
  const inner = (
    <>
      <div style={{ fontSize: 12.5, color: th.textMute, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: th.text, fontFamily: th.fontMono, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: th.textFaint, marginTop: 4 }}>{sub}</div>}
    </>
  );
  const base: React.CSSProperties = {
    display: 'block', background: th.bgElev, border: `1px solid ${th.line}`,
    borderRadius: 14, padding: '18px 20px', textDecoration: 'none', color: 'inherit',
  };
  if (href) {
    return <Link href={href} className="pl-lift" style={base}>{inner}</Link>;
  }
  return <div style={base}>{inner}</div>;
}
