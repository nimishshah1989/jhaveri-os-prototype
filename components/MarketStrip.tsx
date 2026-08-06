// Both blocks below are the page's ONLY non-computed content: they need an
// external market/news feed we haven't connected. Clearly labelled until then.
const TICKS = [
  { name: 'NIFTY 50', value: '24,836.10', change: '+0.42%', up: true },
  { name: 'SENSEX', value: '81,455.40', change: '+0.38%', up: true },
  { name: 'GOLD', value: '₹1,01,240', change: '−0.21%', up: false },
  { name: 'USD/INR', value: '87.42', change: '+0.05%', up: true },
];

export function MarketStrip() {
  return (
    <div className="market">
      {TICKS.map(t => (
        <span key={t.name} className="tick num">
          <b>{t.name}</b> {t.value} <span className={t.up ? 'up' : 'down'}>{t.change}</span>
        </span>
      ))}
      <span className="placeholder-chip">Placeholder — live feed pending</span>
    </div>
  );
}

const NEWS = [
  { text: 'AMC merger notice affects 2 schemes your clients hold', src: 'will link to the actual holdings' },
  { text: 'SEBI TER circular — trail impact from 01-Apr', src: 'industry' },
  { text: 'Equity inflows hit record in July, SIP book ₹27,000 Cr', src: 'industry' },
];

export function NewsPanel() {
  return (
    <div className="panel">
      <h3>
        News for your book <span className="placeholder-chip">Placeholder</span>
      </h3>
      <ul className="news">
        {NEWS.map(n => (
          <li key={n.text}>
            {n.text}
            <span className="src">{n.src}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
