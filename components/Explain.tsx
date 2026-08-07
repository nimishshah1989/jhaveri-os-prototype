import { GLOSSARY, TAG_TRUST } from '../lib/glossary';
import { Icon } from './Icon';

// The ⓘ a broker clicks. It answers three questions in plain words:
//   what is this · how do I read it · what do I do with it
//
// It deliberately shows NO SQL and NO table names. Those exist — every figure
// carries them — but they are the vendor's material and live on /backend. Putting
// `fifo_summary_holding_active.present_market_value` in front of a broker explains
// nothing and costs trust.

interface Props {
  /** Glossary key. */
  id?: string;
  /** Kept so callers can pass the figure; only its honesty tag is used here. */
  figure?: { tag?: string };
  as?: 'info' | 'bulb';
}

export function Explain({ id, figure, as = 'info' }: Props) {
  const t = id ? GLOSSARY[id] : undefined;
  if (!t) return null;                       // no written explanation, no empty popover
  const tag = t.tag ?? figure?.tag;

  return (
    <details className="prov">
      <summary title={`${t.label} — what this means and how to read it`}>
        <Icon name={as} />
      </summary>
      <div className="pop">
        <div className="ptitle">{t.label}</div>
        <p className="pmeans">{t.means}</p>

        <div className="prow">
          <Icon name="bulb" />
          <div><b>How to read it</b><p>{t.read}</p></div>
        </div>

        {t.act && (
          <div className="prow">
            <Icon name="arrow" />
            <div><b>What to do with it</b><p>{t.act}</p></div>
          </div>
        )}

        {t.formula && (
          <div className="prow">
            <Icon name="target" />
            <div><b>How it is worked out</b><p>{t.formula}</p></div>
          </div>
        )}

        {t.caveat && (
          <p className="pcav"><Icon name="alert" /> {t.caveat}</p>
        )}

        {tag && <div className="ptrust">{TAG_TRUST[tag as keyof typeof TAG_TRUST]}</div>}
      </div>
    </details>
  );
}
