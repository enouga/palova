'use client';
import { useState } from 'react';

export function EmailPreview({ html }: { html: string }) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['desktop', 'mobile'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #d5d5d5', background: mode === m ? '#e3edf9' : '#fff', color: '#2c4668', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
            {m === 'desktop' ? 'Desktop' : 'Mobile'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', border: '1px solid #e5e5e5', borderRadius: 12, background: '#f4f5f7', padding: mode === 'mobile' ? '12px 0' : 0 }}>
        <iframe
          title="Aperçu de l'email"
          srcDoc={html}
          style={{ width: mode === 'mobile' ? 380 : '100%', maxWidth: '100%', height: 560, border: 'none', borderRadius: 12, background: '#fff' }}
          sandbox=""
        />
      </div>
    </div>
  );
}
