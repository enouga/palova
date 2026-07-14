'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Member, MemberNote } from '@/lib/api';

const CORAL = '#ff7a4d';
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function NotesCard({ member, notes, clubId, token, onChanged, onNotesChanged, onError }: {
  member: Member;
  notes: MemberNote[];
  clubId: string;
  token: string;
  onChanged: () => void;                       // infos enregistrées → recharge liste + fiche
  onNotesChanged: (next: MemberNote[]) => void;
  onError: (msg: string) => void;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState({ phone: '', membershipNo: '', note: '', isSubscriber: false });
  const [busy, setBusy] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ phone: member.phone ?? '', membershipNo: member.membershipNo ?? '', note: member.note ?? '', isSubscriber: member.isSubscriber });
  }, [member.userId, member.phone, member.membershipNo, member.note, member.isSubscriber]);

  const save = async () => {
    setBusy(true);
    try {
      await api.adminUpdateMember(clubId, member.id, {
        phone: draft.phone || null, membershipNo: draft.membershipNo || null,
        note: draft.note || null, isSubscriber: draft.isSubscriber,
      }, token);
      onChanged();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const addNote = async () => {
    if (!noteBody.trim()) return;
    setAddingNote(true);
    try {
      const created = await api.adminAddMemberNote(clubId, member.userId, noteBody.trim(), token);
      onNotesChanged([created, ...notes]);
      setNoteBody('');
    } catch (e) { onError((e as Error).message); }
    finally { setAddingNote(false); }
  };

  const deleteNote = async (id: string) => {
    try {
      await api.adminDeleteMemberNote(clubId, member.userId, id, token);
      onNotesChanged(notes.filter((n) => n.id !== id));
      setConfirmDelete(null);
    } catch (e) { onError((e as Error).message); }
  };

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 13.5, width: '100%' };
  const fieldLbl: CSSProperties = { ...lbl, display: 'block', marginBottom: 4, fontSize: 10.5 };

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ marginBottom: 10 }}><span style={lbl}>📝 Notes & infos</span></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={fieldLbl}>Téléphone</span>
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="—" style={input} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={fieldLbl}>N° adhérent</span>
            <input value={draft.membershipNo} onChange={(e) => setDraft({ ...draft, membershipNo: e.target.value })} placeholder="—" style={input} />
          </div>
        </div>
        <div>
          <span style={fieldLbl}>Note</span>
          <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="—" rows={2} style={{ ...input, resize: 'vertical' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
          <input type="checkbox" checked={draft.isSubscriber} onChange={(e) => setDraft({ ...draft, isSubscriber: e.target.checked })} style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
          Abonné (fenêtre de réservation élargie)
        </label>
        <div>
          <button onClick={save} disabled={busy}
            style={{ border: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: 10, padding: '9px 16px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, background: th.accent, color: th.onAccent, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${th.line}`, marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Ajouter un commentaire…" style={{ ...input, flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} />
          <button onClick={addNote} disabled={addingNote || !noteBody.trim()}
            style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 10, padding: '0 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: addingNote || !noteBody.trim() ? 0.5 : 1 }}>
            {addingNote ? '…' : 'Ajouter'}
          </button>
        </div>
        {notes.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: 0 }}>Aucun commentaire du staff.</p>
        ) : notes.map((n) => (
          <div key={n.id} style={{ borderLeft: `3px solid ${th.line}`, paddingLeft: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: th.fontUI }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: th.text }}>{n.author ? `${n.author.firstName} ${n.author.lastName}` : 'Staff'}</span>
              <span style={{ fontSize: 11.5, color: th.textFaint }}>{fmtDateTime(n.createdAt)}</span>
              {confirmDelete === n.id ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button onClick={() => deleteNote(n.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: CORAL, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>Confirmer</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 11.5 }}>Annuler</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(n.id)} aria-label="Supprimer le commentaire"
                  style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5 }}>Supprimer</button>
              )}
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, marginTop: 2, whiteSpace: 'pre-wrap' }}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
