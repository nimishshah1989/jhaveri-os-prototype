'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Icon } from '../../components/Icon';
import type { Sheet } from '../../lib/explain';

/* ── A figure, opened ────────────────────────────────────────────────────────
   DESIGN.md allows depth in exactly three places, and this is the second: "a
   sheet rises — for a conversation about one figure, with its act at the bottom."

   The three voices are rendered as three labelled blocks and never merged into
   a paragraph. A client has to be able to tell which sentence is arithmetic,
   which is a person, and which is the market — because they carry completely
   different weight and the only thing worse than not saying is implying.       */

export function FigureSheet({ sheet, children }: { sheet: Sheet | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Portalled to the body, and this is not a style preference.
  //
  // `.f-card` animates on mount with a transform, and a transformed ancestor
  // becomes the containing block for `position: fixed` descendants. Rendered in
  // place, the sheet anchored itself to the CARD rather than the viewport: it
  // measured 756px tall with its top at −100px, so its title, its figure and its
  // close button all sat above the top of the screen. Every route returned 200
  // and the body of the sheet was readable, which is exactly how this class of
  // bug survives a sweep that only checks for errors.
  //
  // The target is `.folio`, NOT document.body: every colour in this lens is a
  // token defined on `.folio`, so a sheet portalled to the body renders with a
  // transparent background and no theme at all. `.folio` is only
  // `position: relative`, which does not create a containing block for a fixed
  // child — so it fixes the anchoring and keeps the tokens.
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector('.folio') ?? document.body), []);

  // The page behind must not scroll under an open sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); };
  }, [open]);

  // A figure with no sheet stays a figure. It does not become a dead tap that
  // opens onto an apology.
  if (!sheet) return <>{children}</>;

  return (
    <>
      <button type="button" className="f-figure" onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-label={`What is behind ${sheet.title}`}>
        {children}
        <Icon name="info" />
      </button>

      {open && host && createPortal(
        <>
          <div className="f-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="f-sheet" role="dialog" aria-modal="true" aria-label={sheet.title}>
            <div className="f-sheethead">
              <span>
                <span className="f-k" style={{ display: 'block', marginBottom: 4 }}>{sheet.title}</span>
                <b className="num" style={{ fontFamily: 'var(--display)', fontSize: 24 }}>{sheet.figure}</b>
              </span>
              <button type="button" className="f-lamp" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="cross" />
              </button>
            </div>

            <div className="f-sheetbody">
              {sheet.passages.map(p => (
                <div className="f-voice" key={p.voice}>
                  <div className="vh">
                    {p.label}
                    {p.seeded && <span className="f-stamp" style={{ color: 'var(--f-faint)' }}>STAND-IN</span>}
                  </div>
                  <p>{p.text}</p>
                  {p.seeded && (
                    <p className="f-note" style={{ margin: '6px 0 0' }}>
                      Your manager has not written on this yet. These are our words in his place, and
                      they are marked so you never mistake one for the other.
                    </p>
                  )}
                </div>
              ))}

              {sheet.mirror.length > 0 && (
                <div className="f-voice">
                  <div className="vh">What your own decisions did</div>
                  {sheet.mirror.map(m => (
                    <div className="f-step" key={m.key}>
                      <span>{m.deed}</span>
                      <b className={m.good ? 'pos' : 'neg'}>{m.figure}</b>
                    </div>
                  ))}
                  <p className="f-note" style={{ margin: '6px 0 0' }}>
                    Each of these is generated from your own transactions by a rule that runs for
                    everybody. None of it is written about you.
                  </p>
                </div>
              )}

              {sheet.drill && (
                <Link href={sheet.drill.href} className="f-btn" style={{ display: 'block', textAlign: 'center' }}
                  onClick={() => setOpen(false)}>
                  {sheet.drill.label}
                </Link>
              )}
            </div>
          </div>
        </>,
        host,
      )}
    </>
  );
}
