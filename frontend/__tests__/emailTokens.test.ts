import { storedToEditorHtml, editorHtmlToStored, plainToEditorHtml, editorHtmlToPlain } from '@/lib/emailTokens';

const vars = [
  { key: 'prenom', label: 'Prénom' },
  { key: 'activite', label: 'Activité' },
];

describe('emailTokens', () => {
  it('storedToEditorHtml : {{clé}} connue → span data-var avec libellé', () => {
    expect(storedToEditorHtml('<p>Bonjour {{prenom}}</p>', vars))
      .toBe('<p>Bonjour <span data-var="prenom">Prénom</span></p>');
  });

  it('storedToEditorHtml : clé inconnue laissée telle quelle (visible)', () => {
    expect(storedToEditorHtml('<p>{{mystere}}</p>', vars)).toBe('<p>{{mystere}}</p>');
  });

  it('editorHtmlToStored : les spans data-var (même enrichis par TipTap) redeviennent {{clé}}', () => {
    expect(editorHtmlToStored('<p>Salut <span class="email-var" data-var="prenom">Prénom</span> !</p>'))
      .toBe('<p>Salut {{prenom}} !</p>');
  });

  it('round-trip HTML riche : gras + jeton', () => {
    const stored = '<p><strong>Bonjour {{prenom}}</strong>, votre place à {{activite}} est confirmée.</p>';
    expect(editorHtmlToStored(storedToEditorHtml(stored, vars))).toBe(stored);
  });

  it('plainToEditorHtml : texte échappé + jetons, une seule ligne <p>', () => {
    expect(plainToEditorHtml('Confirmé & bienvenue {{prenom}}', vars))
      .toBe('<p>Confirmé &amp; bienvenue <span data-var="prenom">Prénom</span></p>');
  });

  it('editorHtmlToPlain : balises retirées, entités décodées, jetons → {{clé}}', () => {
    expect(editorHtmlToPlain('<p>Confirmé &amp; bienvenue <span data-var="prenom">Prénom</span></p>'))
      .toBe('Confirmé & bienvenue {{prenom}}');
  });
});
