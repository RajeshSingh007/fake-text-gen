import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Extra class on the trigger, for sizing variants (e.g. "sel-compact"). */
  triggerClassName?: string;
  /** Extra class on the portaled menu, for theming (e.g. "sel-menu-awz"). */
  menuClassName?: string;
}

interface MenuPos {
  left: number;
  top: number;
  width: number;
  /** true when the menu opens above the trigger (not enough room below). */
  flipped: boolean;
  maxHeight: number;
}

const MENU_MIN_WIDTH = 200;
const MENU_GAP = 4;

/**
 * Custom dropdown. The native <select> popup is OS-rendered and
 * can't be styled, so we render our own menu — in a portal with fixed
 * positioning so the pane's `overflow: auto` never clips it.
 */
export default function Select({ value, options, onChange, ariaLabel, triggerClassName, menuClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [active, setActive] = useState(0); // keyboard-highlighted index
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex] ?? options[0];

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const wanted = Math.min(options.length * 32 + 8, 320);
    const flipped = spaceBelow < wanted && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, (flipped ? spaceAbove : spaceBelow) - MENU_GAP - 8);
    setPos({
      left: r.left,
      top: flipped ? r.top - MENU_GAP : r.bottom + MENU_GAP,
      width: Math.max(r.width, MENU_MIN_WIDTH),
      flipped,
      maxHeight,
    });
  }, [options.length]);

  const openMenu = useCallback(() => {
    setActive(selectedIndex);
    place();
    setOpen(true);
  }, [place, selectedIndex]);

  const choose = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  // Reposition while open (pane/window scroll or resize); close on outside click.
  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => place();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, place]);

  // Keep the highlighted option scrolled into view.
  useLayoutEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (options[active]) choose(options[active].value);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sel-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="sel-value">{current?.label ?? value}</span>
        <svg className="sel-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className={`sel-menu${menuClassName ? ` ${menuClassName}` : ''}`}
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.flipped
                ? { bottom: window.innerHeight - pos.top }
                : { top: pos.top }),
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                data-selected={o.value === value}
                className="sel-option"
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
              >
                <span className="sel-check" aria-hidden="true">
                  {o.value === value ? '✓' : ''}
                </span>
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
