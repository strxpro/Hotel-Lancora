/**
 * "Watch me do it": steps the assistant plays on screen with a visible cursor.
 * Targets: `sel:<css>` or `text:<words>` (the smallest visible clickable element containing the
 * words, starting matches first); `a >> b` searches b inside a.
 */
export type UiStep =
  | { do: 'go'; path: string; say?: string }
  | { do: 'point'; target: string; say?: string }
  | { do: 'click'; target: string; say?: string }
  | { do: 'type'; target: string; text: string; say?: string }
  | { do: 'say'; say: string }
  | { do: 'wait'; ms: number };

export const ASSIST_EVENT = 'assist:play';

export function playAssist(steps: UiStep[]): void {
  if (typeof window === 'undefined' || !steps.length) return;
  window.dispatchEvent(new CustomEvent<UiStep[]>(ASSIST_EVENT, { detail: steps }));
}
