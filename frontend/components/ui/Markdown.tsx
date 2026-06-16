'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * Rendu thémé du markdown des pages de contenu (CGV, mentions, offres…) et des
 * réponses de FAQ. Pas de HTML brut : react-markdown n'interprète que le markdown,
 * donc pas d'injection possible depuis le contenu saisi par les clubs.
 */
export function Markdown({ children }: { children: string }) {
  const { th } = useTheme();

  const components: Components = {
    h1: ({ children }) => <h1 style={{ fontFamily: th.fontUI, fontSize: 26, fontWeight: 800, color: th.text, margin: '0 0 14px', letterSpacing: -0.4 }}>{children}</h1>,
    h2: ({ children }) => <h2 style={{ fontFamily: th.fontUI, fontSize: 18.5, fontWeight: 700, color: th.text, margin: '28px 0 10px' }}>{children}</h2>,
    h3: ({ children }) => <h3 style={{ fontFamily: th.fontUI, fontSize: 15.5, fontWeight: 700, color: th.text, margin: '20px 0 8px' }}>{children}</h3>,
    p: ({ children }) => <p style={{ margin: '0 0 12px', color: th.text, lineHeight: 1.7 }}>{children}</p>,
    ul: ({ children }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.7 }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.7 }}>{children}</ol>,
    li: ({ children }) => <li style={{ margin: '0 0 4px', color: th.text }}>{children}</li>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: th.accent, textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</a>,
    strong: ({ children }) => <strong style={{ fontWeight: 700, color: th.text }}>{children}</strong>,
    em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
    hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${th.line}`, margin: '20px 0' }} />,
    blockquote: ({ children }) => <blockquote style={{ margin: '0 0 12px', padding: '4px 0 4px 14px', borderLeft: `3px solid ${th.line}`, color: th.textMute }}>{children}</blockquote>,
    code: ({ children }) => <code style={{ fontFamily: th.fontMono, fontSize: 13, background: th.surface2, padding: '1px 5px', borderRadius: 6 }}>{children}</code>,
  };

  return (
    <div style={{ fontFamily: th.fontUI, fontSize: 15.5, color: th.text }}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
