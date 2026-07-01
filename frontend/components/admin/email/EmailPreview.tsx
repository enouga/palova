'use client';
export function EmailPreview({ html }: { html: string }) {
  return (
    <iframe
      title="Aperçu de l'email"
      srcDoc={html}
      style={{ width: '100%', height: 520, border: '1px solid #e5e5e5', borderRadius: 12, background: '#fff' }}
      sandbox=""
    />
  );
}
