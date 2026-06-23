'use client';

// Jauge de fiabilité réutilisable (façon Pista) : un % + barre. Pur présentationnel.
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// Teinte : rouge/orange si faible, vert si élevée.
function tone(pct: number): string {
  if (pct >= 85) return '#1f9d55'; // fiabilisé
  if (pct >= 70) return '#c98a00';
  return '#d9822b';
}

export function ReliabilityMeter({
  pct, label = true, width = 80,
}: { pct: number; label?: boolean; width?: number }) {
  const v = Math.round(clamp(pct, 0, 100));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        role="meter"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fiabilité du niveau"
        title={`Fiabilité ${v} %`}
        style={{ position: 'relative', display: 'inline-block', width, height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.12)', overflow: 'hidden' }}
      >
        <span style={{ position: 'absolute', inset: 0, width: `${v}%`, background: tone(v), borderRadius: 999 }} />
      </span>
      {label && <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, whiteSpace: 'nowrap' }}>{v} %</span>}
    </span>
  );
}
