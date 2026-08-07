'use client';

import { useEffect, useRef, useState } from 'react';

// The mic on the add-task bar. It dictates into the box beside it and stops —
// it never submits, because a task a broker did not read before it was filed is
// how the queue fills with noise.
//
// Browser speech recognition only: no audio leaves the machine, no key, no vendor.
// Firefox has no support, so the button removes itself rather than sitting there
// dead — a control that never works teaches people to stop trusting the toolbar.

interface Recogniser extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

// Not in lib.dom yet, and Chrome still ships it prefixed.
declare global {
  interface Window {
    SpeechRecognition?: new () => Recogniser;
    webkitSpeechRecognition?: new () => Recogniser;
  }
}

export function VoiceTask({ targetName }: { targetName: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recogniser | null>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const r = new Ctor();
    r.lang = 'en-IN';
    r.interimResults = false;
    r.continuous = false;
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    return () => r.stop();
  }, []);

  if (!supported) return null;

  const toggle = () => {
    const r = rec.current;
    if (!r) return;
    if (listening) { r.stop(); return; }
    r.onresult = e => {
      const said = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(' ').trim();
      const box = document.querySelector<HTMLInputElement>(`input[name="${targetName}"]`);
      if (!box || !said) return;
      // Append rather than replace — a second burst of dictation adds to the sentence.
      box.value = box.value ? `${box.value} ${said}` : said;
      box.focus();
    };
    setListening(true);
    r.start();
  };

  return (
    <button type="button" className={`mic${listening ? ' on' : ''}`} onClick={toggle}
      title={listening ? 'Listening — click to stop' : 'Dictate the task; nothing is sent until you press Add'}>
      🎙 {listening ? 'listening…' : 'voice'}
    </button>
  );
}
