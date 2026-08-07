import { PageHead } from '../../components/PageHead';
import { Icon } from '../../components/Icon';
import { GLOSSARY, TAG_MEANING, glossaryCoverage } from '../../lib/glossary';
import { db } from '../../lib/db';

export const dynamic = 'force-dynamic';

// The vendor's appendix, generated from the running product rather than written
// beside it. Every entry here is the same object the ⓘ on the page reads from, so
// this document cannot describe a version of the system that no longer exists.

interface TableRow { name: string; rows: number; kind: string }

function inventory(): TableRow[] {
  const conn = db();
  const names = (conn.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]).map(t => t.name);
  // New objects this platform introduces, versus tables carried from production.
  const NEW = new Set(['events', 'actions', 'rules_registry', 'policies', 'experiments', 'interactions',
    'consents', 'leads', 'onboarding_applications', 'broker_links', 'segments', 'campaign_templates',
    'campaigns', 'campaign_sends', 'campaign_responses', 'payout_disputes', 'review_packs',
    'risk_allocation_bands', 'mv_portfolio_attention', 'mv_aum_daily', 'mv_monthly_aum',
    'import_runs', 'quarantine_rows', 'amc_rate_card', 'saved_queries', 'mv_workflow_health',
    'mv_broker_scorecard', 'mv_integration_health', 'mv_nominee_payouts', 'stock_master',
    'mf_scheme_holdings']);
  return names.map(name => ({
    name,
    rows: (conn.prepare(`SELECT COUNT(*) n FROM "${name}"`).get() as { n: number }).n,
    kind: NEW.has(name) ? 'new' : 'carried',
  }));
}

export default function BackendPage() {
  const cov = glossaryCoverage();
  const tables = inventory();
  const carried = tables.filter(t => t.kind === 'carried');
  const created = tables.filter(t => t.kind === 'new');
  const byPage = new Map<string, [string, typeof GLOSSARY[string]][]>();
  for (const [id, t] of Object.entries(GLOSSARY)) {
    for (const pg of t.pages) {
      if (!byPage.has(pg)) byPage.set(pg, []);
      byPage.get(pg)!.push([id, t]);
    }
  }

  return (
    <>
      <PageHead
        title="Backend" icon="file"
        question="Where does every number come from, and what would a vendor have to build?"
        meta="generated from the running product"
      />

      <div className="cols">
        <div>
          <div className="bnote">
            <Icon name="info" /> This page is <b>generated</b>, not written. Each entry below is the
            same record the ⓘ on the product reads from, so this appendix cannot describe a version
            of the system that no longer exists. Where a figure has no plain-words entry yet, it is
            listed as such rather than being quietly left out.
          </div>

          <div className="cards">
            <div className="card"><div className="body">
              <div className="k">Tables in the schema</div>
              <div className="v num">{tables.length}</div>
              <div className="s">{carried.length} carried from production · {created.length} new</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Figures documented</div>
              <div className="v num">{cov.written}</div>
              <div className="s">across {cov.pages.length} surfaces</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Rows in the mock</div>
              <div className="v num">{tables.reduce((s, t) => s + t.rows, 0).toLocaleString('en-IN')}</div>
              <div className="s">every figure here computes off these</div>
            </div></div>
          </div>

          <h2 className="sec"><Icon name="shield" /> How to read a provenance tag</h2>
          <div className="tblwrap">
            <table>
              <thead><tr><th style={{ textAlign: 'left' }}>Tag</th><th style={{ textAlign: 'left' }}>What it promises</th></tr></thead>
              <tbody>
                {Object.entries(TAG_MEANING).map(([tag, meaning]) => (
                  <tr key={tag}>
                    <td><span className={`tag ${tag}`}>{tag}</span></td>
                    <td>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {[...byPage.entries()].sort().map(([pg, terms]) => (
            <div key={pg}>
              <h2 className="sec"><Icon name="file" /> {pg}</h2>
              {terms.map(([id, t]) => (
                <div key={id} className="bterm">
                  <div className="bt">
                    <b>{t.label}</b>
                    <code>{id}</code>
                    <span className={`tag ${t.tag}`}>{t.tag}</span>
                  </div>
                  <p className="bmeans">{t.means}</p>
                  <p className="bread"><b>How to read it:</b> {t.read}</p>
                  {t.formula && <p className="bform"><b>Derivation:</b> {t.formula}</p>}
                  {t.caveat && <p className="bcav"><Icon name="alert" /> {t.caveat}</p>}
                  <div className="bsrc">{t.sources.map(s => <code key={s}>{s}</code>)}</div>
                </div>
              ))}
            </div>
          ))}

          <h2 className="sec"><Icon name="file" /> Objects this platform introduces</h2>
          <div className="tblwrap">
            <table>
              <thead><tr><th style={{ textAlign: 'left' }}>Table</th><th className="r">Rows in the mock</th></tr></thead>
              <tbody>
                {created.map(t => (
                  <tr key={t.name}><td><code>{t.name}</code></td><td className="r num">{t.rows.toLocaleString('en-IN')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="sec"><Icon name="file" /> Tables carried from production</h2>
          <div className="tblwrap">
            <table>
              <thead><tr><th style={{ textAlign: 'left' }}>Table</th><th className="r">Rows in the mock</th></tr></thead>
              <tbody>
                {carried.map(t => (
                  <tr key={t.name}><td><code>{t.name}</code></td><td className="r num">{t.rows.toLocaleString('en-IN')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>What a vendor gets</h3>
            <div className="d">
              Exact production table and column names for everything carried forward, full DDL for
              the objects this platform adds, and — for every documented figure — the arithmetic and
              the columns it resolves to.
              <br /><br />
              The mock database is a deterministic seed: same seed, same database, every run. Ten
              verifier scripts re-derive the numbers with independent SQL and fail the build on drift.
            </div>
          </div>
          <div className="panel learn">
            <h3>Honest coverage</h3>
            <div className="d ghosttxt">
              {cov.written} figures carry a written explanation today. The query layer computes more
              than that, and the remainder show their SQL and source columns through the same ⓘ
              without a plain-words entry. That gap is listed, not hidden — closing it is written
              work, not code.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
