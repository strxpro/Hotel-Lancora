import type { EmailTheme } from './types';

/** Ready-made email looks. The AI can also invent new ones (validated to this same shape). */
export const EMAIL_THEMES: EmailTheme[] = [
  { id: 'ancora', name: 'L’Ancora classico', layout: 'classic', bg: '#EFE9DD', card: '#F8F5EE', accent: '#10283D', ink: '#242B2D', headerBg: '#10283D', headerInk: '#F8F5EE', font: 'serif', radius: 24 },
  { id: 'mare', name: 'Mare aperto', layout: 'hero', bg: '#DCEAF0', card: '#FFFFFF', accent: '#0E5E7E', ink: '#1C2E36', headerBg: '#0E5E7E', headerInk: '#FFFFFF', font: 'sans', radius: 28 },
  { id: 'tramonto', name: 'Tramonto in Gallura', layout: 'postcard', bg: '#F4E4D3', card: '#FFF9F2', accent: '#B4532A', ink: '#3A2A20', headerBg: '#FFF9F2', headerInk: '#B4532A', font: 'serif', radius: 20 },
  { id: 'minimal', name: 'Essenziale', layout: 'minimal', bg: '#FFFFFF', card: '#FFFFFF', accent: '#111111', ink: '#222222', headerBg: '#FFFFFF', headerInk: '#111111', font: 'sans', radius: 0 },
  { id: 'notte', name: 'Notte elegante', layout: 'hero', bg: '#0B1B29', card: '#10283D', accent: '#B69562', ink: '#EDE6D8', headerBg: '#0B1B29', headerInk: '#B69562', font: 'serif', radius: 24 },
  { id: 'macchia', name: 'Macchia mediterranea', layout: 'classic', bg: '#E6EBDD', card: '#FBFCF7', accent: '#4F6B3A', ink: '#26301F', headerBg: '#4F6B3A', headerInk: '#FBFCF7', font: 'serif', radius: 18 },
  { id: 'festa', name: 'Feste di Natale', layout: 'postcard', bg: '#F3E7E4', card: '#FFFDFB', accent: '#9E2B2B', ink: '#3A1F1F', headerBg: '#9E2B2B', headerInk: '#FFF7EF', font: 'serif', radius: 22 },
  { id: 'sole', name: 'Estate solare', layout: 'hero', bg: '#FFF4D6', card: '#FFFFFF', accent: '#D08A00', ink: '#3A3020', headerBg: '#FFFFFF', headerInk: '#D08A00', font: 'sans', radius: 30 },
];

export const DEFAULT_THEME = EMAIL_THEMES[0]!;

const RULES: [RegExp, string[]][] = [
  [/(scur|nott|dark|ner|elegant|lusso|premium|ciemn|elegan)/i, ['notte', 'ancora', 'minimal', 'macchia']],
  [/(mare|blu|azzur|acqua|sea|morze|niebiesk)/i, ['mare', 'ancora', 'sole', 'minimal']],
  [/(tramont|caldo|arancio|terra|sunset|zach|ciep)/i, ['tramonto', 'sole', 'festa', 'ancora']],
  [/(minimal|semplic|pulit|bianc|clean|prost|biał)/i, ['minimal', 'ancora', 'mare', 'notte']],
  [/(natal|feste|inverno|christmas|święt|zim)/i, ['festa', 'notte', 'ancora', 'tramonto']],
  [/(estat|sole|summer|lato|słoń)/i, ['sole', 'mare', 'tramonto', 'minimal']],
  [/(natura|verde|green|macchia|zielon)/i, ['macchia', 'ancora', 'mare', 'minimal']],
];

/** Four looks matching a short description (used when no AI is connected). */
export function themesForPrompt(prompt: string): EmailTheme[] {
  const hit = RULES.find(([re]) => re.test(prompt));
  const ids = hit ? hit[1] : ['ancora', 'mare', 'tramonto', 'minimal'];
  return ids.map((id) => EMAIL_THEMES.find((t) => t.id === id)!).filter(Boolean);
}

const HEX = /^#[0-9a-f]{6}$/i;

export function sanitizeTheme(t: Partial<EmailTheme> | null | undefined, fallback: EmailTheme = DEFAULT_THEME): EmailTheme {
  if (!t) return fallback;
  const pick = (k: keyof EmailTheme) => (typeof t[k] === 'string' && HEX.test(t[k] as string) ? (t[k] as string) : (fallback[k] as string));
  return {
    id: typeof t.id === 'string' ? t.id.slice(0, 40) : fallback.id,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40) : fallback.name,
    layout: (['classic', 'hero', 'minimal', 'postcard'] as const).includes(t.layout as never) ? (t.layout as EmailTheme['layout']) : fallback.layout,
    bg: pick('bg'),
    card: pick('card'),
    accent: pick('accent'),
    ink: pick('ink'),
    headerBg: pick('headerBg'),
    headerInk: pick('headerInk'),
    font: t.font === 'sans' ? 'sans' : t.font === 'serif' ? 'serif' : fallback.font,
    radius: typeof t.radius === 'number' ? Math.max(0, Math.min(36, Math.round(t.radius))) : fallback.radius,
  };
}

/** Personal fields the owner can drop into a message as "pills". */
export const TOKENS = [
  { key: 'nome', label: 'Nome', sample: 'Giulia' },
  { key: 'cognome', label: 'Cognome', sample: 'Rossi' },
  { key: 'camera', label: 'Camera', sample: '104 Granito' },
  { key: 'arrivo', label: 'Data di arrivo', sample: '12 dicembre' },
  { key: 'partenza', label: 'Data di partenza', sample: '15 dicembre' },
  { key: 'codice', label: 'Codice prenotazione', sample: 'LA-7Q24N' },
] as const;
