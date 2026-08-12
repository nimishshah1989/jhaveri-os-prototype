'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';

// Small, real controls. Text size and hidden values change the app immediately and
// survive a reload; anything that needs the device or the server says so rather
// than pretending with a dead switch.
const KEY = 'folio-prefs';
type Prefs = { hide: boolean; size: 's' | 'm' | 'l' };
const DEFAULTS: Prefs = { hide: false, size: 'm' };
const SIZE_PX: Record<Prefs['size'], string> = { s: '13px', m: '14px', l: '16px' };

export function Prefs() {
  const [p, setP] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setP({ ...DEFAULTS, ...JSON.parse(raw) as Partial<Prefs> });
    } catch { /* a corrupt preference is not worth an error page */ }
  }, []);

  useEffect(() => {
    const root = document.querySelector('.folio') as HTMLElement | null;
    if (!root) return;
    root.style.fontSize = SIZE_PX[p.size];
    root.classList.toggle('hide-money', p.hide);
  }, [p]);

  const save = (next: Prefs) => {
    setP(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  return (
    <div className="f-card">
      <div className="setrow">
        <span className="st2">Blur the figures<span>For trains and open-plan offices. Everything still works; the numbers just stop shouting.</span></span>
        <span className={`sw${p.hide ? ' on' : ''}`} onClick={() => save({ ...p, hide: !p.hide })}
          role="switch" aria-checked={p.hide} tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') save({ ...p, hide: !p.hide }); }}><i /></span>
      </div>

      <div className="setrow">
        <span className="st2">Text size<span>The whole page reflows. Nothing crops.</span></span>
        <span className="seg">
          {(['s', 'm', 'l'] as const).map((s, i) => (
            <button key={s} type="button" className={p.size === s ? 'on' : ''}
              style={{ fontSize: 10 + i * 2 }} onClick={() => save({ ...p, size: s })}>A</button>
          ))}
        </span>
      </div>

      <div className="setrow">
        <span className="st2">Language<span>The whole paper, not just the buttons. Figures stay in lakh and crore either way.</span></span>
        <span className="seg">
          {[['en', 'English'], ['hi', 'हिन्दी'], ['gu', 'ગુજરાતી']].map(([k, label]) => (
            <button key={k} type="button" className={k === 'en' ? 'on' : ''} disabled={k !== 'en'}
              title={k === 'en' ? '' : 'Translation is real-build work — the switch is not wired to a half-translated app'}>
              {label}
            </button>
          ))}
        </span>
      </div>

      <div className="setrow" style={{ borderBottom: 0 }}>
        <span className="st2"><Icon name="shield" /> Face ID on open<span>Needs the device, so it is real-build work. Shown here so you know it is coming, not pretended with a dead switch.</span></span>
        <span className="f-stamp" style={{ color: 'var(--f-faint)' }}>NOT YET</span>
      </div>
    </div>
  );
}
