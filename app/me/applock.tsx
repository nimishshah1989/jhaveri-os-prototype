'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';

/* ── The app lock ────────────────────────────────────────────────────────────
   Phase 7, table stakes. Until now the Desk carried a "Face ID on open" row
   marked NOT YET, which was honest and also meant the lens had no lock at all.

   WHAT THIS ACTUALLY PROTECTS AGAINST, stated on the screen rather than only
   here: somebody picking up an unlocked phone. That is the real threat for this
   app — a train, a desk, a family member — and a cover that has to be dismissed
   answers it completely. It is NOT encryption. The figures underneath are in the
   page, and anyone with the phone, the time and a browser console can read them.
   Face ID needs the device's own secure enclave and stays a named seam.

   The PIN is hashed before it is stored, because a four-digit number sitting in
   plain localStorage is the kind of thing a security review finds and is right
   to. Hashing a four-digit PIN does not make it hard to brute force — it stops
   it being readable, which is the honest claim and the one the screen makes.

   Locked state lives in sessionStorage, so the lock asks once when the app is
   opened rather than on every page — a lock that interrupts a client six times
   while they read their own statement is a lock that gets turned off.          */

const PIN_KEY = 'folio-lock';
const OPEN_KEY = 'folio-lock-open';

async function hash(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`folio:${pin}`);
  const out = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(out)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function useLockState(): [boolean, (on: boolean) => void] {
  const [set, setSet] = useState(false);
  useEffect(() => {
    try { setSet(!!localStorage.getItem(PIN_KEY)); } catch { /* private mode */ }
  }, []);
  return [set, setSet];
}

/**
 * The cover. Rendered by the layout on every client-lens page, and inert unless
 * a PIN has been set and this browser session has not been unlocked yet.
 */
export function AppLock() {
  const [locked, setLocked] = useState(false);
  const [entered, setEntered] = useState('');
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    try {
      const has = !!localStorage.getItem(PIN_KEY);
      const open = sessionStorage.getItem(OPEN_KEY) === '1';
      setLocked(has && !open);
    } catch { /* private mode: no lock rather than a broken one */ }
  }, []);

  const press = useCallback(async (digit: string) => {
    const next = (entered + digit).slice(0, 4);
    setEntered(next);
    setWrong(false);
    if (next.length < 4) return;
    const want = localStorage.getItem(PIN_KEY);
    if (want && (await hash(next)) === want) {
      sessionStorage.setItem(OPEN_KEY, '1');
      setLocked(false);
      setEntered('');
    } else {
      setWrong(true);
      setEntered('');
    }
  }, [entered]);

  if (!locked) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'var(--f-ground)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
    }}>
      <span className="house" style={{ letterSpacing: '.26em', fontSize: 11, color: 'var(--f-faint)' }}>
        JHAVERI PRIVATE
      </span>
      <Icon name="shield" />
      <p style={{ fontFamily: 'var(--display)', fontSize: 19, margin: 0 }}>Enter your PIN.</p>

      <div style={{ display: 'flex', gap: 10 }} aria-live="polite">
        {[0, 1, 2, 3].map(i => (
          <i key={i} style={{
            width: 12, height: 12, borderRadius: '50%', display: 'block',
            background: i < entered.length ? 'var(--f-gold)' : 'var(--f-track)',
            border: '1px solid var(--f-line)',
          }} />
        ))}
      </div>
      {wrong && <span style={{ color: 'var(--f-neg)', fontSize: 12.5 }}>That is not the PIN.</span>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 10, marginTop: 6 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''].map((d, i) => (
          d ? (
            <button key={i} type="button" className="f-btn ghost" onClick={() => press(d)}
              style={{ margin: 0, minHeight: 54, fontSize: 17 }}>{d}</button>
          ) : <span key={i} />
        ))}
      </div>

      <p className="f-note" style={{ maxWidth: 280, textAlign: 'left' }}>
        This covers the screen when the app is opened. It stops someone picking up your phone. It is
        not encryption, and it is not a substitute for your phone&rsquo;s own lock.
      </p>
    </div>
  );
}

/** The control that sets or clears it. Lives in the Desk beside the other preferences. */
export function LockSetting() {
  const [isSet, setIsSet] = useLockState();
  const [typing, setTyping] = useState(false);
  const [pin, setPin] = useState('');

  const commit = async (value: string) => {
    if (value.length !== 4) return;
    localStorage.setItem(PIN_KEY, await hash(value));
    sessionStorage.setItem(OPEN_KEY, '1');
    setIsSet(true);
    setTyping(false);
    setPin('');
  };

  const clear = () => {
    localStorage.removeItem(PIN_KEY);
    sessionStorage.removeItem(OPEN_KEY);
    setIsSet(false);
  };

  return (
    <>
      <div className="setrow">
        <span className="st2">
          <Icon name="shield" /> PIN on open
          <span>
            Covers the screen each time the app is opened. Stops someone picking up your phone; it is
            not encryption, and your phone&rsquo;s own lock still matters more.
          </span>
        </span>
        {isSet ? (
          <button type="button" className="f-btn ghost" style={{ margin: 0, width: 'auto', minHeight: 40 }}
            onClick={clear}>Turn off</button>
        ) : (
          <span className={`sw${typing ? ' on' : ''}`} role="switch" aria-checked={typing} tabIndex={0}
            onClick={() => setTyping(!typing)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setTyping(!typing); }}><i /></span>
        )}
      </div>

      {typing && !isSet && (
        <div className="setrow" style={{ display: 'block' }}>
          <label className="st2" htmlFor="pin" style={{ display: 'block', marginBottom: 8 }}>
            Four digits
            <span>Not your bank PIN, and not your phone&rsquo;s. Something else.</span>
          </label>
          <input id="pin" inputMode="numeric" maxLength={4} value={pin} className="num"
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setPin(v);
              if (v.length === 4) void commit(v);
            }}
            style={{ width: 120, letterSpacing: '.4em', textAlign: 'center' }} />
        </div>
      )}

      <div className="setrow" style={{ borderBottom: 0 }}>
        <span className="st2">
          <Icon name="shield" /> Face ID
          <span>Needs the device&rsquo;s secure enclave, so it is real-build work. Named rather than pretended with a dead switch.</span>
        </span>
        <span className="f-stamp" style={{ color: 'var(--f-faint)' }}>NOT YET</span>
      </div>
    </>
  );
}
