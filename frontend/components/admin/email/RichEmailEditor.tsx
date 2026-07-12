'use client';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExt from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { useTheme } from '@/lib/ThemeProvider';
import { EmailVarDef } from '@/lib/api';
import { storedToEditorHtml, editorHtmlToStored, plainToEditorHtml, editorHtmlToPlain } from '@/lib/emailTokens';

// Jeton de variable : nœud inline ATOMIQUE — insécable, supprimé d'un coup, jamais scindé.
const EmailVar = Node.create({
  name: 'emailVar',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { key: { default: '' }, label: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'span[data-var]',
      getAttrs: (el) => {
        const e = el as HTMLElement;
        return { key: e.getAttribute('data-var') || '', label: e.textContent || e.getAttribute('data-var') || '' };
      },
    }];
  },
  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-var': node.attrs.key, class: 'email-var' }), node.attrs.label || node.attrs.key];
  },
});

// Une seule ligne : Enter avalé (objet / titre / libellé de bouton).
const SingleLine = Extension.create({
  name: 'singleLine',
  addKeyboardShortcuts() {
    return { Enter: () => true };
  },
});

const TEXT_COLORS = ['#c2543c', '#3a7a3a', '#b8860b', '#2c4668', '#5e93da'];

interface Props {
  /** Valeur au format stocké : HTML+{{clé}} (corps) ou texte+{{clé}} (une ligne). */
  value: string;
  vars: EmailVarDef[];
  onChange: (stored: string) => void;
  singleLine?: boolean;
  /** Upload d'une image insérée dans le corps ; renvoie l'URL /uploads/… */
  onUploadImage?: (file: File) => Promise<string>;
}

export function RichEmailEditor({ value, vars, onChange, singleLine = false, onUploadImage }: Props) {
  const { th } = useTheme();
  const lastEmitted = useRef<string | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toEditor = (stored: string) => (singleLine ? plainToEditorHtml(stored, vars) : storedToEditorHtml(stored, vars));
  const fromEditor = (html: string) => (singleLine ? editorHtmlToPlain(html) : editorHtmlToStored(html));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: singleLine
      ? [
          StarterKit.configure({
            heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false,
            horizontalRule: false, bold: false, italic: false, strike: false, code: false,
            underline: false, link: false,
          } as never),
          SingleLine,
          EmailVar,
        ]
      : [
          StarterKit.configure({
            heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false, strike: false, code: false,
            link: { openOnClick: false },
          } as never),
          ImageExt,
          TextAlign.configure({ types: ['heading', 'paragraph'] }),
          TextStyle,
          Color,
          EmailVar,
        ],
    content: toEditor(value),
    onUpdate: ({ editor: ed }) => {
      const stored = fromEditor(ed.getHTML());
      lastEmitted.current = stored;
      onChange(stored);
    },
  });

  // Resynchronise l'éditeur quand la valeur change de l'extérieur (chargement, reset).
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    editor.commands.setContent(toEditor(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  function insertVar(v: EmailVarDef) {
    editor?.chain().focus().insertContent({ type: 'emailVar', attrs: { key: v.key, label: v.label } }).run();
    setVarsOpen(false);
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadImage || !editor) return;
    setUploadError(null);
    try {
      const url = await onUploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError((err as Error).message);
    }
  }

  function setLink() {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string) || '';
    const url = window.prompt('URL du lien (vide pour retirer)', prev);
    if (url === null) return;
    if (!url) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  }

  const tbtn = (active = false, borderStyle: 'solid' | 'dashed' = 'solid'): CSSProperties => ({
    minWidth: 30, height: 30, padding: '0 8px', borderRadius: 8, cursor: 'pointer',
    border: `1px ${borderStyle} ${active ? th.accent : th.line}`,
    background: active ? `${th.accent}22` : th.bgElev, color: th.text,
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
  });

  return (
    <div>
      <style>{`
        .pl-rte .ProseMirror { min-height: ${singleLine ? 0 : 170}px; outline: none; font-size: ${singleLine ? 15 : 14.5}px; line-height: 1.6; }
        .pl-rte .ProseMirror p { margin: 0 0 ${singleLine ? 0 : 10}px; }
        .pl-rte .email-var { background: #e3edf9; color: #2c4668; border-radius: 6px; padding: 1px 7px; font-weight: 600; font-size: .92em; white-space: nowrap; }
        .pl-rte .ProseMirror img { max-width: 100%; height: auto; border-radius: 12px; }
      `}</style>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        {!singleLine && editor && (
          <>
            <button type="button" title="Gras" style={{ ...tbtn(editor.isActive('bold')) }} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
            <button type="button" title="Italique" style={{ ...tbtn(editor.isActive('italic')), fontStyle: 'italic' }} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
            <button type="button" title="Souligné" style={{ ...tbtn(editor.isActive('underline')), textDecoration: 'underline' }} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>
            <button type="button" title="Liste à puces" style={tbtn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}>• Liste</button>
            <button type="button" title="Liste numérotée" style={tbtn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Liste</button>
            <button type="button" title="Lien" style={tbtn(editor.isActive('link'))} onClick={setLink}>🔗</button>
            <button type="button" title="Sous-titre" style={tbtn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>T2</button>
            <button type="button" title="Petit sous-titre" style={tbtn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>T3</button>
            <button type="button" title="Aligner à gauche" style={tbtn(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⬅</button>
            <button type="button" title="Centrer" style={tbtn(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()}>↔</button>
            {TEXT_COLORS.map((c) => (
              <button key={c} type="button" title={`Couleur ${c}`} onClick={() => editor.chain().focus().setColor(c).run()}
                style={{ width: 20, height: 20, borderRadius: 10, border: `1px solid ${th.line}`, background: c, cursor: 'pointer', padding: 0 }} aria-label={`Couleur ${c}`} />
            ))}
            <button type="button" title="Couleur par défaut" style={tbtn()} onClick={() => editor.chain().focus().unsetColor().run()}>A̶</button>
            {onUploadImage && (
              <>
                <button type="button" title="Insérer une photo" style={tbtn()} onClick={() => fileRef.current?.click()}>🖼 Photo</button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickImage} />
              </>
            )}
          </>
        )}
        <div style={{ position: 'relative', marginLeft: singleLine ? 0 : 'auto' }}>
          <button type="button" style={{ ...tbtn(varsOpen, 'dashed'), color: th.accent }} onClick={() => setVarsOpen((o) => !o)}>
            ＠ Insérer une info ▾
          </button>
          {varsOpen && (
            <div style={{ position: 'absolute', right: 0, top: 34, zIndex: 30, background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 12, boxShadow: '0 8px 26px rgba(0,0,0,.14)', padding: 6, minWidth: 250 }}>
              {vars.map((v) => (
                <button key={v.key} type="button" onClick={() => insertVar(v)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
                  <strong>{v.label}</strong> <span style={{ color: th.textFaint }}>— ex. {v.sample}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pl-rte" style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: th.bg, color: th.text, padding: singleLine ? '10px 14px' : '12px 14px', fontFamily: th.fontUI }}>
        <EditorContent editor={editor} />
      </div>
      {uploadError && <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: '#e55', margin: '6px 0 0' }}>{uploadError}</p>}
    </div>
  );
}
