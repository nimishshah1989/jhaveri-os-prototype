import { Icon } from './Icon';

// Where a page's standing explanation goes. It is not deleted and it is not hidden
// in a footnote — it is one click away, on the page it belongs to, and the button
// says so in plain words.
//
// Same <details> idiom as the stat cards and the ⓘ popover, so there is no new
// mechanism to learn and no JavaScript involved. The one line that stays on screen
// is the page's question; everything else lives in here.

export function PageGuide({ children, lines }: {
  children: React.ReactNode;
  /** The one-line answer that stays visible. The rest opens. */
  lines: string;
}) {
  return (
    <div className="guiderow">
      <p className="denom">{lines}</p>
      <details className="guide">
        <summary><Icon name="bulb" /> How this page works</summary>
        <div className="guidebody prosecap">{children}</div>
      </details>
    </div>
  );
}
