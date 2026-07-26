/**
 * The form-based conversation builder — the demo's primary authoring surface.
 *
 * It recreates the spirit of the original Microsoft Comic Chat interface: a list
 * of lines you fill in like a form (who speaks, what they say, to whom), plus the
 * shared "emote console" — the iconic **emotion wheel**, a set of gesture
 * buttons, and a live **character preview** ("the little Comic Chat head guy") —
 * that all act on whichever line is currently selected.
 *
 * It owns no composition logic. Each row becomes a `ChatEvent`; the builder hands
 * back `{ events, authors, cast }` and the host runs the exact same
 * `compose` + `renderPanelToSvg` path the Script tab uses. The character a row
 * picks *is* its speaker identity, so the cast map is built directly and no
 * `parseLog` round-trip is needed (though {@link BuilderApi.toScript} can still
 * emit the `name (hint): text` script for the power-user tab).
 */

import type {
  CastEntry,
  ChatEvent,
  Expression,
  Gesture,
  MessageEvent,
} from '../../src/types.ts';

/** How a line is delivered — folds the message/action split and balloon kind into one control. */
export type LineKind = 'say' | 'whisper' | 'think' | 'action';

/** One authored line. `characterId` doubles as the speaker's identity. */
export interface BuilderRow {
  id: number;
  characterId: string;
  text: string;
  expression: Expression;
  /** Emotion strength, 0 (neutral, centre) … 1 (rim). Captured for the wheel; the composer ignores it for now. */
  intensity: number;
  gesture: Gesture;
  /** Another row's `characterId`, or '' for nobody. */
  addresseeId: string;
  kind: LineKind;
}

export interface BuilderComposition {
  events: ChatEvent[];
  authors: string[];
  cast: Record<string, CastEntry>;
}

export interface BuilderDeps {
  /** All castable character ids, in menu order. */
  characterIds: string[];
  /** Display name for a character id. */
  nameOf: (id: string) => string;
  /** A stable neon accent colour (hex) for a character, for the member list and row accents. */
  colorOf: (id: string) => string;
  /** Render a standalone preview figure for the given look. */
  previewSvg: (characterId: string, expression: Expression, gesture: Gesture) => string;
  /** Called after any *user* edit, so the host can mark the script authored and recompose. */
  onChange: () => void;
}

export interface BuilderApi {
  /** Build the composer inputs from the current rows (incomplete rows are skipped). */
  getComposition: () => BuilderComposition;
  /** Replace all rows programmatically (surprise / seed). Does not fire `onChange`. */
  load: (rows: BuilderRow[]) => void;
  /** Serialise the rows to the `name (hint): text` script the Script tab understands. */
  toScript: () => string;
  /** True when no row is complete enough to compose. */
  isEmpty: () => boolean;
}

// The eight emotions on Comic Chat's wheel, clockwise from the top, with neutral
// living at the centre. Order matches the TODO / the original control.
const EMOTIONS: readonly { key: Expression; label: string }[] = [
  { key: 'happy', label: 'Happy' },
  { key: 'laughing', label: 'Laughing' },
  { key: 'coy', label: 'Coy' },
  { key: 'shouting', label: 'Shouting' },
  { key: 'angry', label: 'Angry' },
  { key: 'sad', label: 'Sad' },
  { key: 'scared', label: 'Scared' },
  { key: 'bored', label: 'Bored' },
];

const GESTURES: readonly { key: Gesture; label: string }[] = [
  { key: 'neutral', label: 'Neutral' },
  { key: 'wave', label: 'Wave' },
  { key: 'point-self', label: 'Point self' },
  { key: 'point-other', label: 'Point other' },
  { key: 'smile', label: 'Smile' },
  { key: 'shrug', label: 'Shrug' },
];

const KINDS: readonly { key: LineKind; label: string }[] = [
  { key: 'say', label: 'Say' },
  { key: 'whisper', label: 'Whisper' },
  { key: 'think', label: 'Think' },
  { key: 'action', label: 'Action' },
];

// Wheel geometry, in its own 260×260 viewBox.
const WHEEL_VB = 260;
const WHEEL_C = WHEEL_VB / 2;
const WHEEL_R = 86; // emotion-node ring
const WHEEL_LABEL_R = 114;
const WHEEL_DEADZONE = 26; // radius under which a click means "neutral"

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Polar → cartesian in the wheel viewBox. Angle 0 points up; increases clockwise. */
function wheelPoint(index: number, radius: number): { x: number; y: number } {
  const deg = -90 + index * 45;
  const rad = (deg * Math.PI) / 180;
  return { x: WHEEL_C + radius * Math.cos(rad), y: WHEEL_C + radius * Math.sin(rad) };
}

const gestureLabel = (key: Gesture): string =>
  GESTURES.find((g) => g.key === key)?.label ?? key;
const emotionLabel = (key: Expression): string =>
  EMOTIONS.find((e) => e.key === key)?.label ?? key;

/**
 * Wire the builder into a container that already holds the expected child
 * elements (`#rows`, `#add-row`, `#preview`, `#wheel`, `#gestures`).
 */
export function createBuilder(root: HTMLElement, deps: BuilderDeps): BuilderApi {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const membersEl = $<HTMLDivElement>('members');
  const rowsEl = $<HTMLDivElement>('rows');
  const addBtn = $<HTMLButtonElement>('add-row');
  const previewEl = $<HTMLDivElement>('preview');
  const wheelEl = $<HTMLDivElement>('wheel');
  const gesturesEl = $<HTMLDivElement>('gestures');

  const rows: BuilderRow[] = [];
  let activeId: number | null = null;
  let nextId = 1;
  let loading = false; // true while load() runs, so edits don't count as authored

  const active = (): BuilderRow | undefined => rows.find((r) => r.id === activeId);
  const rowEl = (id: number): HTMLElement | null =>
    rowsEl.querySelector<HTMLElement>(`.brow[data-id="${id}"]`);

  /** A fresh row, rotating the default character so a new line isn't a copy of the last. */
  function makeRow(): BuilderRow {
    const ids = deps.characterIds;
    const characterId = ids[rows.length % ids.length] ?? ids[0] ?? '';
    return {
      id: nextId++,
      characterId,
      text: '',
      expression: 'neutral',
      intensity: 0,
      gesture: 'neutral',
      addresseeId: '',
      kind: 'say',
    };
  }

  /** Notify the host of a user edit (unless we're mid-load) and let it recompose. */
  function edited(): void {
    if (!loading) deps.onChange();
  }

  // ---- Rendering ---------------------------------------------------------

  function charOptions(selected: string): string {
    return deps.characterIds
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(deps.nameOf(id))}</option>`,
      )
      .join('');
  }

  /** Addressees are the *other* distinct characters in the conversation. */
  function addresseeOptions(row: BuilderRow): string {
    const others = [...new Set(rows.map((r) => r.characterId))].filter(
      (id) => id && id !== row.characterId,
    );
    const none = `<option value=""${row.addresseeId ? '' : ' selected'}>— to —</option>`;
    return (
      none +
      others
        .map(
          (id) =>
            `<option value="${escapeHtml(id)}"${id === row.addresseeId ? ' selected' : ''}>→ ${escapeHtml(deps.nameOf(id))}</option>`,
        )
        .join('')
    );
  }

  const kindOptions = (selected: LineKind): string =>
    KINDS.map(
      (k) => `<option value="${k.key}"${k.key === selected ? ' selected' : ''}>${k.label}</option>`,
    ).join('');

  const badgeText = (row: BuilderRow): string => {
    const e = row.expression === 'neutral' ? 'Auto' : emotionLabel(row.expression);
    return row.gesture === 'neutral' ? e : `${e} · ${gestureLabel(row.gesture)}`;
  };

  /** The Comic-Chat "member list": the distinct speakers in scene, each in their colour. */
  function renderMembers(): void {
    const ids: string[] = [];
    for (const r of rows) if (r.characterId && !ids.includes(r.characterId)) ids.push(r.characterId);
    if (ids.length === 0) {
      membersEl.innerHTML = `<span class="members-empty">No one in scene yet</span>`;
      return;
    }
    membersEl.innerHTML =
      `<span class="members-cap">In scene</span>` +
      ids
        .map((id) => {
          const c = deps.colorOf(id);
          const count = rows.filter((r) => r.characterId === id && r.text.trim()).length;
          return (
            `<button class="member" data-cid="${escapeHtml(id)}" style="--c:${c}" title="Select ${escapeHtml(deps.nameOf(id))}'s first line">` +
            `<span class="sw"></span>${escapeHtml(deps.nameOf(id))}` +
            (count ? `<span class="ct">${count}</span>` : '') +
            `</button>`
          );
        })
        .join('');
  }

  function renderRows(): void {
    rowsEl.innerHTML = rows
      .map((r) => {
        const activeCls = r.id === activeId ? ' is-active' : '';
        const color = r.characterId ? deps.colorOf(r.characterId) : 'var(--border-soft)';
        return (
          `<div class="brow${activeCls}" data-id="${r.id}" draggable="true" style="--c:${color}">` +
          `<span class="grip" title="Drag to reorder" aria-hidden="true">⠿</span>` +
          `<span class="rsw" aria-hidden="true"></span>` +
          `<select class="who" data-f="char" aria-label="Character">${charOptions(r.characterId)}</select>` +
          `<input class="line" data-f="text" type="text" placeholder="say something…" value="${escapeHtml(r.text)}" aria-label="Line text">` +
          `<select class="to" data-f="addr" aria-label="Addressee">${addresseeOptions(r)}</select>` +
          `<select class="kind" data-f="kind" aria-label="Delivery">${kindOptions(r.kind)}</select>` +
          `<span class="badge" title="Emotion &amp; gesture">${escapeHtml(badgeText(r))}</span>` +
          `<button class="rm" data-f="rm" title="Remove line" aria-label="Remove line">✕</button>` +
          `</div>`
        );
      })
      .join('');
    renderMembers();
  }

  function renderWheel(): void {
    const row = active();
    const expr = row?.expression ?? 'neutral';
    const intensity = row?.intensity ?? 0;
    const disabled = !row;

    const parts: string[] = [];
    parts.push(
      `<svg viewBox="0 0 ${WHEEL_VB} ${WHEEL_VB}" class="wheel-svg${disabled ? ' is-off' : ''}" role="img" aria-label="Emotion wheel">`,
    );
    parts.push(
      `<circle cx="${WHEEL_C}" cy="${WHEEL_C}" r="${WHEEL_R}" class="wheel-rim"/>`,
    );
    // Spokes and the selection needle.
    EMOTIONS.forEach((_, i) => {
      const p = wheelPoint(i, WHEEL_R);
      parts.push(`<line x1="${WHEEL_C}" y1="${WHEEL_C}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="wheel-spoke"/>`);
    });
    const sel = EMOTIONS.findIndex((e) => e.key === expr);
    if (sel >= 0) {
      const tip = wheelPoint(sel, Math.max(WHEEL_DEADZONE, WHEEL_R * intensity));
      parts.push(`<line x1="${WHEEL_C}" y1="${WHEEL_C}" x2="${tip.x.toFixed(1)}" y2="${tip.y.toFixed(1)}" class="wheel-needle"/>`);
      parts.push(`<circle cx="${tip.x.toFixed(1)}" cy="${tip.y.toFixed(1)}" r="6" class="wheel-tip"/>`);
    }
    // Emotion nodes + labels.
    EMOTIONS.forEach((e, i) => {
      const p = wheelPoint(i, WHEEL_R);
      const lp = wheelPoint(i, WHEEL_LABEL_R);
      const on = e.key === expr ? ' is-on' : '';
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" class="wheel-node${on}"/>`);
      parts.push(
        `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" class="wheel-label${on}" text-anchor="middle" dominant-baseline="middle">${e.label}</text>`,
      );
    });
    // Neutral, at the centre.
    const neutralOn = expr === 'neutral' ? ' is-on' : '';
    parts.push(`<circle cx="${WHEEL_C}" cy="${WHEEL_C}" r="18" class="wheel-center${neutralOn}"/>`);
    parts.push(
      `<text x="${WHEEL_C}" y="${WHEEL_C}" class="wheel-clabel${neutralOn}" text-anchor="middle" dominant-baseline="middle">Neutral</text>`,
    );
    parts.push(`</svg>`);
    wheelEl.innerHTML = parts.join('');
  }

  function renderGestures(): void {
    const row = active();
    gesturesEl.innerHTML = GESTURES.map((g) => {
      const on = row && row.gesture === g.key ? ' is-on' : '';
      const dis = row ? '' : ' disabled';
      return `<button class="gest${on}" data-g="${g.key}"${dis}>${g.label}</button>`;
    }).join('');
  }

  function renderPreview(): void {
    const row = active();
    if (!row || !row.characterId) {
      previewEl.style.borderColor = '';
      previewEl.innerHTML = `<div class="preview-empty">Pick a line to pose your character</div>`;
      return;
    }
    previewEl.style.borderColor = deps.colorOf(row.characterId);
    previewEl.innerHTML = deps.previewSvg(row.characterId, row.expression, row.gesture);
  }

  /** Refresh the shared console (preview + wheel + gestures) for the active row. */
  function refreshConsole(): void {
    renderPreview();
    renderWheel();
    renderGestures();
  }

  function setActive(id: number | null): void {
    if (activeId === id) return;
    if (activeId != null) rowEl(activeId)?.classList.remove('is-active');
    activeId = id;
    if (activeId != null) rowEl(activeId)?.classList.add('is-active');
    refreshConsole();
  }

  function updateBadge(row: BuilderRow): void {
    const el = rowEl(row.id)?.querySelector<HTMLElement>('.badge');
    if (el) el.textContent = badgeText(row);
  }

  // ---- Row mutations -----------------------------------------------------

  function addRow(): void {
    const row = makeRow();
    rows.push(row);
    renderRows();
    setActive(row.id);
    edited();
  }

  function removeRow(id: number): void {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    rows.splice(i, 1);
    if (activeId === id) activeId = rows[Math.min(i, rows.length - 1)]?.id ?? null;
    renderRows();
    refreshConsole();
    edited();
  }

  // ---- Events ------------------------------------------------------------

  addBtn.addEventListener('click', addRow);

  // Clicking a member in the list jumps to (and selects) their first line.
  membersEl.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.member');
    if (!btn) return;
    const first = rows.find((r) => r.characterId === btn.dataset.cid);
    if (first) {
      setActive(first.id);
      rowEl(first.id)?.scrollIntoView({ block: 'nearest' });
    }
  });

  // Value edits: mutate state in place without re-rendering the row (keeps focus).
  rowsEl.addEventListener('input', (ev) => {
    const t = ev.target as HTMLElement;
    if (!(t instanceof HTMLInputElement) || t.dataset.f !== 'text') return;
    const row = rowFromEvent(t);
    if (!row) return;
    row.text = t.value;
    edited();
  });

  rowsEl.addEventListener('change', (ev) => {
    const t = ev.target as HTMLElement;
    if (!(t instanceof HTMLSelectElement)) return;
    const row = rowFromEvent(t);
    if (!row) return;
    if (t.dataset.f === 'char') {
      row.characterId = t.value;
      // A character rename can invalidate other rows' addressee menus.
      renderRows();
      setActive(row.id);
    } else if (t.dataset.f === 'addr') {
      row.addresseeId = t.value;
    } else if (t.dataset.f === 'kind') {
      row.kind = t.value as LineKind;
    }
    refreshConsole();
    edited();
  });

  rowsEl.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const rowNode = t.closest<HTMLElement>('.brow');
    if (!rowNode) return;
    const id = Number(rowNode.dataset.id);
    if (t.dataset.f === 'rm') {
      removeRow(id);
      return;
    }
    // Clicking anywhere else on the row selects it for the console.
    setActive(id);
  });

  function rowFromEvent(t: HTMLElement): BuilderRow | undefined {
    const id = Number(t.closest<HTMLElement>('.brow')?.dataset.id);
    return rows.find((r) => r.id === id);
  }

  // Drag-to-reorder (native HTML5 DnD).
  let dragId: number | null = null;
  rowsEl.addEventListener('dragstart', (ev) => {
    const node = (ev.target as HTMLElement).closest<HTMLElement>('.brow');
    if (!node) return;
    dragId = Number(node.dataset.id);
    node.classList.add('dragging');
    ev.dataTransfer?.setData('text/plain', String(dragId));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  });
  rowsEl.addEventListener('dragover', (ev) => {
    if (dragId == null) return;
    ev.preventDefault();
    const over = (ev.target as HTMLElement).closest<HTMLElement>('.brow');
    if (!over || Number(over.dataset.id) === dragId) return;
    const from = rows.findIndex((r) => r.id === dragId);
    const to = rows.findIndex((r) => r.id === Number(over.dataset.id));
    if (from < 0 || to < 0) return;
    const rect = over.getBoundingClientRect();
    const after = ev.clientY > rect.top + rect.height / 2;
    const insertAt = after ? to + 1 : to;
    const [moved] = rows.splice(from, 1);
    rows.splice(from < insertAt ? insertAt - 1 : insertAt, 0, moved!);
    renderRows();
  });
  const endDrag = (): void => {
    if (dragId == null) return;
    rowEl(dragId)?.classList.remove('dragging');
    dragId = null;
    edited();
  };
  rowsEl.addEventListener('drop', (ev) => {
    ev.preventDefault();
    endDrag();
  });
  rowsEl.addEventListener('dragend', endDrag);

  // The emotion wheel: click or drag to set the active row's emotion (+ intensity).
  let wheeling = false;
  function applyWheel(clientX: number, clientY: number): void {
    const row = active();
    if (!row) return;
    const rect = wheelEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = ((clientX - rect.left) / rect.width) * WHEEL_VB - WHEEL_C;
    const vy = ((clientY - rect.top) / rect.height) * WHEEL_VB - WHEEL_C;
    const r = Math.hypot(vx, vy);
    if (r < WHEEL_DEADZONE) {
      row.expression = 'neutral';
      row.intensity = 0;
    } else {
      const deg = (Math.atan2(vy, vx) * 180) / Math.PI;
      const i = (((Math.round((deg + 90) / 45) % 8) + 8) % 8);
      row.expression = EMOTIONS[i]!.key;
      row.intensity = Math.min(1, r / WHEEL_R);
    }
    renderWheel();
    renderPreview();
    updateBadge(row);
  }
  wheelEl.addEventListener('pointerdown', (ev) => {
    if (!active()) return;
    wheeling = true;
    wheelEl.setPointerCapture(ev.pointerId);
    applyWheel(ev.clientX, ev.clientY);
  });
  wheelEl.addEventListener('pointermove', (ev) => {
    if (wheeling) applyWheel(ev.clientX, ev.clientY);
  });
  const stopWheel = (ev: PointerEvent): void => {
    if (!wheeling) return;
    wheeling = false;
    try {
      wheelEl.releasePointerCapture(ev.pointerId);
    } catch {
      /* pointer already released */
    }
    edited(); // recompose once, at the end of the gesture
  };
  wheelEl.addEventListener('pointerup', stopWheel);
  wheelEl.addEventListener('pointercancel', stopWheel);

  gesturesEl.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.gest');
    const row = active();
    if (!btn || !row) return;
    row.gesture = btn.dataset.g as Gesture;
    renderGestures();
    renderPreview();
    updateBadge(row);
    edited();
  });

  // ---- Public API --------------------------------------------------------

  function getComposition(): BuilderComposition {
    const events: ChatEvent[] = [];
    const authors: string[] = [];
    const cast: Record<string, CastEntry> = {};
    const seen = new Set<string>();
    let at = 0;

    for (const row of rows) {
      const id = row.characterId;
      const text = row.text.trim();
      if (!id || !text) continue; // skip incomplete lines

      if (!seen.has(id)) {
        seen.add(id);
        authors.push(id);
        cast[id] = { characterId: id };
        events.push({ type: 'join', author: id, at: at++ });
      }

      const ev: MessageEvent = {
        type: row.kind === 'action' ? 'action' : 'message',
        author: id,
        text,
        at: at++,
      };
      if (row.expression !== 'neutral') ev.expressionOverride = row.expression;
      if (row.gesture !== 'neutral') ev.gestureOverride = row.gesture;
      if (row.kind === 'whisper') ev.kind = 'whisper';
      else if (row.kind === 'think') ev.kind = 'thought';
      if (row.addresseeId && row.addresseeId !== id) ev.addressees = [row.addresseeId];
      events.push(ev);
    }

    return { events, authors, cast };
  }

  function load(next: BuilderRow[]): void {
    loading = true;
    rows.length = 0;
    for (const r of next) {
      rows.push({ ...r, id: nextId++ });
    }
    activeId = rows[0]?.id ?? null;
    renderRows();
    refreshConsole();
    loading = false;
  }

  function toScript(): string {
    const lines: string[] = [];
    for (const row of rows) {
      const id = row.characterId;
      const text = row.text.trim();
      if (!id || !text) continue;
      if (row.kind === 'action') {
        lines.push(`* ${id} ${text}`);
        continue;
      }
      const hints: string[] = [];
      if (row.expression !== 'neutral') hints.push(row.expression);
      if (row.gesture !== 'neutral') hints.push(row.gesture);
      if (row.kind === 'whisper') hints.push('whisper');
      else if (row.kind === 'think') hints.push('think');
      const to = row.addresseeId && row.addresseeId !== id ? ` -> ${row.addresseeId}` : '';
      const hint = hints.length ? ` (${hints.join(', ')})` : '';
      lines.push(`${id}${to}${hint}: ${text}`);
    }
    return lines.join('\n');
  }

  const isEmpty = (): boolean =>
    !rows.some((r) => r.characterId && r.text.trim());

  // First paint (empty until the host loads content).
  renderRows();
  refreshConsole();

  return { getComposition, load, toScript, isEmpty };
}
