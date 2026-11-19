'use client';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { TOKENS } from '@/lib/email-themes';
import { cn } from '@/lib/utils';

const LABEL: Record<string, string> = Object.fromEntries(TOKENS.map((t) => [t.key, t.label]));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pill = (k: string) => `<span contenteditable="false" data-token="${k}" class="tok">${esc(LABEL[k] ?? k)}</span>`;

function toHtml(value: string): string {
  return esc(value)
    .replace(/\{(nome|cognome|camera|arrivo|partenza|codice)\}/gi, (_, k: string) => pill(k.toLowerCase()))
    .replace(/\n/g, '<br>');
}

function serialize(root: HTMLElement): string {
  let out = '';
  const walk = (n: Node, top: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent ?? '').replace(/ /g, ' ');
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset.token) {
      out += `{${n.dataset.token}}`;
      return;
    }
    if (n.tagName === 'BR') {
      out += '\n';
      return;
    }
    // Chrome wraps new lines in <div>
    if (!top && (n.tagName === 'DIV' || n.tagName === 'P') && out && !out.endsWith('\n')) out += '\n';
    n.childNodes.forEach((c) => walk(c, false));
  };
  root.childNodes.forEach((c) => walk(c, true));
  return out.replace(/\n$/, '');
}

/**
 * Text field where personal fields are shown as pills ("Nome", "Camera"…) instead of {nome}:
 * tap a pill above the field and it is inserted where the cursor is.
 */
export function TokenEditor({ value, onChange, multiline = false, placeholder, label, id, maxLength = 4000 }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; label: string; id: string; maxLength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!ref.current || value === last.current) return;
    ref.current.innerHTML = toHtml(value);
    last.current = value;
  }, [value]);

  const emit = useCallback(() => {
    if (!ref.current) return;
    let v = serialize(ref.current);
    if (!multiline) v = v.replace(/\n+/g, ' ');
    v = v.slice(0, maxLength);
    last.current = v;
    onChange(v);
  }, [onChange, multiline, maxLength]);

  const insert = (key: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = `${pill(key)} `;
    const frag = tpl.content;
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    emit();
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-mist">Inserisci</span>
        {TOKENS.map((t) => (
          <button
            key={t.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(t.key)}
            className="rounded-full bg-gold/15 px-2.5 py-1 text-[0.72rem] font-semibold text-navy ring-1 ring-gold/30 transition-[background-color,transform] hover:bg-gold/30 active:scale-95"
          >
            + {t.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-label={label}
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e) => {
          if (!multiline && e.key === 'Enter') e.preventDefault();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, multiline ? text : text.replace(/\n+/g, ' '));
        }}
        className={cn('field tok-editor whitespace-pre-wrap break-words outline-none', multiline ? 'min-h-[9rem] leading-relaxed' : 'min-h-12')}
      />
    </div>
  );
}
