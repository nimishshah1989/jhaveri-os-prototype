'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// A broker doing thirty items a morning outruns the mouse. The open drawer is the
// selection, so j/k just walk it and Esc shuts it — no roving highlight to keep in
// sync with the table, and nothing to see when the keyboard is not being used.
//
// This is the only keyboard handler on the product. Everything else is plain links
// and forms, which is why the prototype is quick and hard to break; keep it that way.

export function QueueKeys({ prevId, nextId, firstId, isOpen }: {
  prevId?: number; nextId?: number; firstId?: number; isOpen: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal a keystroke from someone typing a note or a task.
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const go = (id?: number) => {
        if (id == null) return;
        e.preventDefault();
        router.push(`/today?action=${id}`, { scroll: false });
      };

      if (e.key === 'Escape' && isOpen) { e.preventDefault(); router.push('/today', { scroll: false }); return; }
      if (e.key === 'j') go(isOpen ? nextId : firstId);
      if (e.key === 'k' && isOpen) go(prevId);
      if (e.key === 'Enter' && !isOpen) go(firstId);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, prevId, nextId, firstId, isOpen]);

  return null;
}
