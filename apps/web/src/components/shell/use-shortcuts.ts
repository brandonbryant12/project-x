import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** ⌘K palette, G-then-key navigation, L log work, O "I saw this". Disabled while typing. */
export const useShortcuts = (handlers: {
  readonly palette: () => void;
  readonly log: () => void;
  readonly observe: (() => void) | null;
}) => {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.palette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (pendingG.current) {
        pendingG.current = false;
        const to = { h: '/', i: '/inbox', d: '/development', p: '/people' }[key];
        if (to) void navigate({ to });
        return;
      }
      if (key === 'g') {
        pendingG.current = true;
        window.setTimeout(() => (pendingG.current = false), 1200);
      } else if (key === 'l') handlers.log();
      else if (key === 'o' && handlers.observe) handlers.observe();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers, navigate]);
};
