'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';

// One design language, two grounds. The lamp is the only thing that switches, and
// the choice survives a reload because a client who reads at night reads at night.
const KEY = 'folio-theme';

export function Lamp() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(saved ? saved === 'dark' : prefers);
  }, []);

  useEffect(() => {
    document.querySelector('.folio')?.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <button
      type="button"
      className="f-lamp"
      aria-label={dark ? 'Switch to the light page' : 'Switch to the dark page'}
      onClick={() => {
        const next = !dark;
        setDark(next);
        localStorage.setItem(KEY, next ? 'dark' : 'light');
      }}
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
