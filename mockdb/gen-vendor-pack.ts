// Generates the vendor build pack from the running product.
//
// Nothing here is authored twice. The DDL comes from schema.sql, the queries come
// from calling the real query layer and capturing the SQL it returns, the
// thresholds come from the live rules objects, and the acceptance criteria are the
// assertion strings in the verifier scripts. Re-run it after any change and the
// document cannot describe a version of the system that no longer exists.
//
// Usage: npx tsx mockdb/gen-vendor-pack.ts [outfile.html]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const ROOT = process.cwd();
const OUT = process.argv[2] ?? join(ROOT, 'vendor-pack.html');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── 1. Schema: carried tables vs objects this platform introduces ────────────
const schemaSql = readFileSync(join(ROOT, 'mockdb', 'schema.sql'), 'utf8');

interface TableDef { name: string; ddl: string; columns: number; section: string }
const tables: TableDef[] = [];
{
  let section = 'Unclassified';
  const lines = schemaSql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const sec = lines[i].match(/^-- SECTION \d+ · (.+)$/);
    if (sec) section = sec[1].trim();
    const m = lines[i].match(/^CREATE TABLE (\w+)/);
    if (!m) continue;
    const body: string[] = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      body.push(lines[j]);
      if (lines[j].startsWith(');')) break;
    }
    const ddl = body.join('\n');
    tables.push({
      name: m[1], ddl, section,
      columns: ddl.split('\n').filter(l => /^\s{2}\w+\s+\w/.test(l)).length,
    });
  }
}
const NEW_OBJECTS = new Set(['events', 'actions', 'rules_registry', 'policies', 'experiments',
  'interactions', 'consents', 'leads', 'onboarding_applications', 'broker_links', 'segments',
  'campaign_templates', 'campaigns', 'campaign_sends', 'campaign_responses', 'payout_disputes',
  'review_packs', 'risk_allocation_bands', 'mv_portfolio_attention', 'mv_aum_daily',
  'mv_monthly_aum', 'import_runs', 'quarantine_rows', 'amc_rate_card', 'saved_queries',
  'mv_workflow_health', 'mv_broker_scorecard', 'mv_integration_health', 'mv_nominee_payouts',
  'stock_master', 'mf_scheme_holdings']);
const created = tables.filter(t => NEW_OBJECTS.has(t.name));
const carried = tables.filter(t => !NEW_OBJECTS.has(t.name));
const matviews = created.filter(t => t.name.startsWith('mv_'));

// ── 2. Queries: captured by calling the real query layer ─────────────────────
interface Captured { module: string; fn: string; sql: string; sources: string[]; tag?: string }
const captured: Captured[] = [];
const failed: { module: string; fn: string; why: string }[] = [];

const MODULES = ['queries', 'client360', 'portfolio', 'scoring', 'onboarding', 'earnings',
  'business', 'marketing', 'reviewpack'];
// Argument shapes the query layer actually uses, tried in order.
const ARGS: unknown[][] = [[], [4], ['1228'], [4, '2026-08-01'], [101], [4, 'whatsapp'],
  [101, 1], [4, '2026-08-01', 101], ['1228', {}]];

async function capture() {
  for (const mod of MODULES) {
    const m = (await import(`../lib/${mod}`)) as Record<string, unknown>;
    for (const [fn, val] of Object.entries(m)) {
      if (typeof val !== 'function') continue;
      let got = false;
      for (const args of ARGS) {
        try {
          const out = (val as (...a: unknown[]) => unknown)(...args);
          const o = out as { sql?: string; sources?: string[]; tag?: string };
          if (o && typeof o.sql === 'string' && o.sql.trim()) {
            captured.push({ module: mod, fn, sql: o.sql.trim(), sources: o.sources ?? [], tag: o.tag });
            got = true;
            break;
          }
          if (o && typeof o === 'object') { got = true; break; }   // returns data, no sql exposed
        } catch { /* wrong argument shape — try the next */ }
      }
      if (!got) failed.push({ module: mod, fn, why: 'no argument shape matched' });
    }
  }
}

// ── 3. Thresholds, from the live rules objects ───────────────────────────────
interface RuleSet { name: string; module: string; entries: [string, string][] }
const ruleSets: RuleSet[] = [];
async function captureRules() {
  const want: [string, string][] = [['scoring', 'SCORING_RULES'], ['onboarding', 'ONBOARDING_RULES'],
    ['earnings', 'EARNINGS_RULES'], ['business', 'BUSINESS_RULES'],
    ['marketing', 'MARKETING_RULES'], ['reviewpack', 'REVIEW_RULES'],
    ['portfolio', 'LOOKTHROUGH_RULES']];
  for (const [mod, name] of want) {
    const m = (await import(`../lib/${mod}`)) as Record<string, unknown>;
    const obj = m[name] as Record<string, unknown> | undefined;
    if (!obj) continue;
    ruleSets.push({
      name, module: `lib/${mod}.ts`,
      entries: Object.entries(obj).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
    });
  }
}

// ── 4. Acceptance criteria: the assertion strings the verifiers run ──────────
interface Suite { file: string; checks: string[] }
const suites: Suite[] = readdirSync(join(ROOT, 'mockdb'))
  .filter(f => f.startsWith('verify') && f.endsWith('.ts'))
  .sort()
  .map(f => {
    const src = readFileSync(join(ROOT, 'mockdb', f), 'utf8');
    const checks = [...src.matchAll(/check\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
      .map(m => m[2].replace(/\\'/g, "'").replace(/\s+/g, ' ').trim());
    return { file: f, checks };
  });
const totalChecks = suites.reduce((s, x) => s + x.checks.length, 0);

// ── 5. Writes: every server action and what it touches ───────────────────────
interface Write { page: string; fn: string; touches: string[] }
const writes: Write[] = [];
for (const dir of readdirSync(join(ROOT, 'app'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const file of ['actions.ts', 'lever-actions.ts']) {
    let src: string;
    try { src = readFileSync(join(ROOT, 'app', dir.name, file), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/export async function (\w+)/g)) {
      const after = src.slice(src.indexOf(m[0]));
      const body = after.slice(0, after.indexOf('\nexport ') === -1 ? after.length : after.indexOf('\nexport '));
      const touches = [...new Set([...body.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g)].map(x => x[1]))];
      writes.push({ page: dir.name, fn: m[1], touches });
    }
  }
}

// ── 6. Emit ──────────────────────────────────────────────────────────────────
async function main() {
  await capture();
  await captureRules();
  const { GLOSSARY, TAG_MEANING } = await import('../lib/glossary');
  const terms = Object.entries(GLOSSARY);
  const byPage = new Map<string, typeof terms>();
  for (const [id, t] of terms) {
    for (const pg of t.pages) {
      if (!byPage.has(pg)) byPage.set(pg, []);
      byPage.get(pg)!.push([id, t]);
    }
  }

  const stat = (n: number | string, l: string) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  const SECTIONS: { id: string; label: string; html: string[] }[] = [
    { id: 'overview', label: 'Overview', html: [] },
    { id: 'data', label: 'Data layer', html: [] },
    { id: 'pages', label: 'Page spec', html: [] },
    { id: 'queries', label: 'All queries', html: [] },
    { id: 'rules', label: 'Thresholds', html: [] },
    { id: 'writes', label: 'Write paths', html: [] },
    { id: 'accept', label: 'Acceptance', html: [] },
    { id: 'gaps', label: 'Gaps', html: [] },
  ];
  const sec = (id: string) => SECTIONS.find(x => x.id === id)!.html;
  const H = sec('overview');
  H.push(`<h1>Jhaveri OS — vendor build pack</h1>
<p class="sub">Generated from the running prototype on ${new Date().toISOString().slice(0, 10)}. Every
query, threshold and acceptance criterion below was read out of the code that produces the screens —
not written alongside it. Re-generating after a change is the only way this document is updated, so it
cannot describe a version of the system that no longer exists.</p>
<div class="stats">
${stat(tables.length, 'tables in the schema')}
${stat(carried.length, 'carried from production')}
${stat(created.length, 'new objects to build')}
${stat(matviews.length, 'materialised views')}
${stat(captured.length, 'queries captured with SQL')}
${stat(writes.length, 'write paths')}
${stat(totalChecks, 'acceptance assertions')}
${stat(terms.length, 'figures documented in plain words')}
</div>

<h2>How to read this</h2>
<ol class="howto">
  <li><b>Section 2</b> is the data layer: what already exists in production and is carried forward
      unchanged, and what has to be created. Full DDL is given for everything new.</li>
  <li><b>Section 3</b> is the page-by-page specification. Each figure names what it means in plain
      words, the exact SQL that produces it, and the tables and columns it resolves to.</li>
  <li><b>Section 4</b> is every threshold in the product, with its current value and where it lives.
      None of these are hard-coded in a screen.</li>
  <li><b>Section 5</b> is every write path — what each user action inserts or updates.</li>
  <li><b>Section 6 is the contract.</b> ${totalChecks} assertions run against a freshly seeded
      database. A build is done when they all pass — not when the screens look right.</li>
</ol>

<h2>1 · Architecture decisions already taken</h2>
<div class="scroll"><table class="t"><thead><tr><th>Decision</th><th>Why it is fixed</th></tr></thead><tbody>
<tr><td>Postgres as the single spine</td><td>No Kafka, no microservices, no vector store. Every workflow is an explicit state machine over tables. Production precedent: a 43M-row job queue already runs this way.</td></tr>
<tr><td>Append-only <code>events</code> ledger</td><td>Every other table's changes emit here. The UI and analytics are projections of it; it doubles as the audit record. No update or delete grants.</td></tr>
<tr><td>Owned work lives in <code>actions</code></td><td>A signal that nobody owns is not a feature. Every action carries evidence, an assignee, an SLA and a mandatory reason on dismissal.</td></tr>
<tr><td>Three-tier intelligence</td><td>T0 deterministic rules over the ledger (most of it), T1 schema-validated LLM calls through one gateway with a named fallback, T2 nightly aggregate reasoning behind an experiment gate. <b>AI never computes a client's money.</b></td></tr>
<tr><td>Thresholds live in <code>rules_registry</code></td><td>Changing a threshold is a versioned, audited edit — never a deploy. Section 4 lists them all.</td></tr>
<tr><td>Provenance on every figure</td><td>Each number is tagged <code>computed</code>, <code>rule</code> or <code>learned</code> and can name its own source. This is a product requirement, not a debug aid.</td></tr>
</tbody></table></div>`);

  // Data layer
  sec('data').push(`<h2>2 · The data layer</h2>
<h3>2.1 New objects — build these (${created.length})</h3>
<p class="note">Full DDL as it runs in the prototype. Column comments carry the production mapping
where one exists.</p>`);
  for (const t of created) {
    sec('data').push(`<details class="ddl"><summary><code>${t.name}</code><span class="pill">${t.columns} columns</span>${t.name.startsWith('mv_') ? '<span class="pill mv">materialised view</span>' : ''}</summary><pre>${esc(t.ddl)}</pre></details>`);
  }
  sec('data').push(`<h3>2.2 Materialised views — refresh contract (${matviews.length})</h3>
<div class="scroll"><table class="t"><thead><tr><th>View</th><th>Rebuilt from</th><th>Cadence</th></tr></thead><tbody>
<tr><td><code>mv_aum_daily</code></td><td>Each folio's units carried forward through its own transactions, valued at that day's NAV, aggregated per broker per day.</td><td>Nightly, after the RTA import promotes</td></tr>
<tr><td><code>mv_monthly_aum</code></td><td>Rollup of <code>mv_aum_daily</code>. Carries peak-day AUM (the reported definition) <em>and</em> month-end, because only month-end makes opening + net flows + market movement equal closing exactly.</td><td>Nightly</td></tr>
<tr><td><code>mv_portfolio_attention</code></td><td>FIFO summary + transactions + <code>rules_registry</code> thresholds. Disposable projection; base tables stay truth.</td><td>Nightly</td></tr>
<tr><td><code>mv_broker_scorecard</code>, <code>mv_workflow_health</code>, <code>mv_integration_health</code>, <code>mv_nominee_payouts</code></td><td>Aggregations over actions, events and the brokerage chain.</td><td>Nightly</td></tr>
</tbody></table></div>
<h3>2.3 Carried from production — unchanged (${carried.length})</h3>
<p class="note">Exact production table names. The prototype uses the column subset shown; a vendor
should assume the real table is wider.</p>
<div class="tags">${carried.map(t => `<code>${t.name}</code>`).join('')}</div>`);

  // Page specs
  sec('pages').push(`<h2>3 · Page specification</h2>
<p class="note">Each figure: what it means to the person reading it, then the SQL and the columns it
resolves to. The plain-words half is what the product shows a broker; the SQL half is for you.</p>`);
  for (const [pg, list] of [...byPage.entries()].sort()) {
    sec('pages').push(`<h3>${pg}</h3>`);
    for (const [id, t] of list) {
      const cap = captured.find(c => c.sources.some(s => t.sources.includes(s)));
      sec('pages').push(`<div class="fig">
  <div class="fh"><b>${esc(t.label)}</b><code>${id}</code><span class="tag ${t.tag}">${t.tag}</span></div>
  <p><b>Means:</b> ${esc(t.means)}</p>
  <p><b>How a user reads it:</b> ${esc(t.read)}</p>
  ${t.formula ? `<p><b>Derivation:</b> ${esc(t.formula)}</p>` : ''}
  ${t.caveat ? `<p class="cav"><b>Caveat:</b> ${esc(t.caveat)}</p>` : ''}
  <div class="tags">${t.sources.map(s => `<code>${esc(s)}</code>`).join('')}</div>
  ${cap ? `<details><summary>SQL as it runs</summary><pre>${esc(cap.sql)}</pre></details>` : ''}
</div>`);
    }
  }

  sec('queries').push(`<h2>Every captured query (${captured.length})</h3>
<p class="note">The full query layer, harvested by calling it. Grouped by module.</p>`);
  for (const mod of MODULES) {
    const list = captured.filter(c => c.module === mod);
    if (!list.length) continue;
    sec('queries').push(`<h4><code>lib/${mod}.ts</code> — ${list.length} queries</h4>`);
    for (const c of list) {
      sec('queries').push(`<details class="ddl"><summary><code>${c.fn}()</code>${c.tag ? `<span class="tag ${c.tag}">${c.tag}</span>` : ''}</summary><pre>${esc(c.sql)}</pre><div class="tags">${c.sources.map(s => `<code>${esc(s)}</code>`).join('')}</div></details>`);
    }
  }

  // Rules
  sec('rules').push(`<h2>4 · Every threshold in the product</h2>
<p class="note">These migrate to <code>rules_registry</code> rows in the real build. Changing one is a
versioned edit with an approver — never a code change.</p>`);
  for (const r of ruleSets) {
    sec('rules').push(`<h4><code>${r.name}</code> <span class="note">${r.module}</span></h4>
<div class="scroll"><table class="t"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>
${r.entries.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td><code>${esc(v.length > 200 ? v.slice(0, 200) + '…' : v)}</code></td></tr>`).join('')}
</tbody></table></div>`);
  }

  // Writes
  sec('writes').push(`<h2>5 · Write paths (${writes.length})</h2>
<p class="note">Every user action that changes state. All of them also append to <code>events</code>.</p>
<div class="scroll"><table class="t"><thead><tr><th>Surface</th><th>Action</th><th>Tables written</th></tr></thead><tbody>
${writes.map(w => `<tr><td><code>${w.page}</code></td><td><code>${w.fn}()</code></td><td>${w.touches.map(t => `<code>${t}</code>`).join(' ') || '<span class="note">events only</span>'}</td></tr>`).join('')}
</tbody></table></div>`);

  // Acceptance
  sec('accept').push(`<h2>6 · Acceptance criteria — the contract</h2>
<p class="note"><b>This is the definition of done.</b> ${totalChecks} assertions run against a freshly
seeded database and re-derive every figure with SQL written independently of the query layer. A build
is complete when all of them pass. They are given verbatim.</p>`);
  for (const s of suites) {
    sec('accept').push(`<details class="ddl" open><summary><code>${s.file}</code><span class="pill">${s.checks.length} assertions</span></summary><ol class="checks">${s.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ol></details>`);
  }

  sec('gaps').push(`<h2>7 · Stated gaps</h2>
<ul class="howto">
  <li>${terms.length} figures carry a written plain-words explanation. The query layer computes more
      than that; the rest expose their SQL and source columns but no user-facing sentence yet. The gap
      is listed rather than hidden — closing it is writing, not engineering.</li>
  <li><code>goal_summary_master</code> and its satellites exist in production but are not in this
      schema. The review pack uses attention flags and health levers instead.</li>
  <li>Referral-link visit counts come from web analytics, which this database does not hold. The UI
      states that rather than presenting it as computed.</li>
  <li>Behavioural scores are ghosted until real outcome volume exists. They are schema, not numbers.</li>
  <li>Risk-to-allocation bands ship as schema with no rows — the values await a compliance decision.</li>
</ul>
<p class="foot">Provenance tags used above — ${Object.entries(TAG_MEANING).map(([k, v]) => `<b>${k}</b>: ${esc(v)}`).join(' · ')}</p>`);

  const html = `<title>Jhaveri OS — vendor build pack</title>
<style>
/* Tokens inherited from the product's own system (app/globals.css) so the spec and
   the thing it specifies look like one family. Neutrals are biased toward the navy
   accent rather than being pure grey. */
:root{
  --ground:#ffffff; --panel:#f5f7f9; --ink:#16212b; --muted:#5b6b78; --line:#e0e5ea;
  --accent:#23408e; --accent-soft:#eef1f9;
  --pos:#2c6b41; --pos-soft:#e7f0ea; --amber:#8a5d10; --amber-soft:#fbf3df;
  --grey-soft:#f1f3f4; --code-bg:#0f172a; --code-ink:#e2e8f0;
}
@media (prefers-color-scheme: dark){
  :root{
    --ground:#0f151b; --panel:#161e26; --ink:#e6eaee; --muted:#94a3b0; --line:#2a343e;
    --accent:#8fa9f0; --accent-soft:#1b2436;
    --pos:#7fc196; --pos-soft:#16281d; --amber:#d9ae62; --amber-soft:#2a2214;
    --grey-soft:#1c242c; --code-bg:#0a0f15; --code-ink:#d7dee6;
  }
}
:root[data-theme="light"]{
  --ground:#ffffff; --panel:#f5f7f9; --ink:#16212b; --muted:#5b6b78; --line:#e0e5ea;
  --accent:#23408e; --accent-soft:#eef1f9; --pos:#2c6b41; --pos-soft:#e7f0ea;
  --amber:#8a5d10; --amber-soft:#fbf3df; --grey-soft:#f1f3f4; --code-bg:#0f172a; --code-ink:#e2e8f0;
}
:root[data-theme="dark"]{
  --ground:#0f151b; --panel:#161e26; --ink:#e6eaee; --muted:#94a3b0; --line:#2a343e;
  --accent:#8fa9f0; --accent-soft:#1b2436; --pos:#7fc196; --pos-soft:#16281d;
  --amber:#d9ae62; --amber-soft:#2a2214; --grey-soft:#1c242c; --code-bg:#0a0f15; --code-ink:#d7dee6;
}
*{box-sizing:border-box}
html{background:var(--ground)}
body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  color:var(--ink);background:var(--ground);-webkit-text-size-adjust:100%}
.wrap{max-width:1080px;margin:0 auto;padding:36px 24px 90px;display:flex;flex-direction:column;gap:0}
h1{font-size:1.7rem;letter-spacing:-.022em;margin:0 0 6px;text-wrap:balance}
h2{font-size:1.05rem;margin:44px 0 12px;padding-bottom:8px;border-bottom:2px solid var(--accent);
  color:var(--accent);text-wrap:balance}
h3{font-size:.95rem;margin:28px 0 10px;text-wrap:balance}
h4{font-size:.82rem;margin:20px 0 8px;color:var(--muted);font-weight:650;letter-spacing:.02em}
p.sub{color:var(--muted);margin:0 0 22px;max-width:70ch}
.note{color:var(--muted);font-size:.83rem;max-width:74ch}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}
.stat{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--ground)}
.stat b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stat span{font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
ol.howto,ul.howto{max-width:76ch;padding-left:20px}
ol.howto li,ul.howto li{margin-bottom:8px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;margin:10px 0 18px}
table.t{width:100%;border-collapse:collapse;font-size:.83rem;min-width:520px}
table.t th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);padding:9px 11px;border-bottom:1px solid var(--line);background:var(--panel)}
table.t td{padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}
table.t tr:last-child td{border-bottom:0}
code{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:.75rem;background:var(--panel);
  border:1px solid var(--line);border-radius:4px;padding:1px 5px;color:var(--ink)}
pre{background:var(--code-bg);color:var(--code-ink);border-radius:8px;padding:12px 14px;
  overflow-x:auto;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:.73rem;
  line-height:1.6;margin:8px 0;tab-size:2}
details.ddl{border:1px solid var(--line);border-radius:8px;margin-bottom:6px;background:var(--ground)}
details.ddl>summary{cursor:pointer;padding:9px 12px;display:flex;gap:8px;align-items:center;
  flex-wrap:wrap;font-size:.83rem;border-radius:8px}
details.ddl>summary::-webkit-details-marker{display:none}
details.ddl>summary:hover{background:var(--panel)}
details.ddl>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
details.ddl pre,details.ddl .tags,details.ddl .checks{margin-left:12px;margin-right:12px;margin-bottom:12px}
.pill{font-size:.67rem;color:var(--muted);background:var(--panel);border:1px solid var(--line);
  border-radius:20px;padding:1px 8px;font-variant-numeric:tabular-nums}
.pill.mv{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.fig{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:var(--ground)}
.fig .fh{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.fig p{margin:0 0 5px;font-size:.85rem;max-width:74ch}
.fig p.cav{color:var(--amber);background:var(--amber-soft);border-radius:6px;padding:7px 9px;font-size:.8rem}
.tag{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-radius:3px;padding:1px 7px}
.tag.computed{background:var(--pos-soft);color:var(--pos)}
.tag.rule{background:var(--amber-soft);color:var(--amber)}
.tag.learned{background:var(--grey-soft);color:var(--muted)}
ol.checks{padding-left:24px;font-size:.82rem;max-width:80ch}
ol.checks li{margin-bottom:5px}
a{color:var(--accent)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.foot{margin-top:32px;padding-top:14px;border-top:1px solid var(--line);font-size:.78rem;
  color:var(--muted);max-width:80ch}
.phead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--line)}
.phead .brand{font-weight:700;font-size:.95rem;letter-spacing:-.01em}
.phead .brand span{font-weight:400;color:var(--muted)}
.phead .gen{margin-left:auto;font-size:.74rem;color:var(--muted);font-variant-numeric:tabular-nums}
.tabs{display:flex;gap:2px;flex-wrap:wrap;position:sticky;top:0;z-index:5;background:var(--ground);
  border-bottom:1px solid var(--line);margin-bottom:22px;padding-top:2px}
.tabs button{appearance:none;background:none;border:0;border-bottom:2px solid transparent;
  margin-bottom:-1px;padding:9px 13px;font:inherit;font-size:.83rem;color:var(--muted);cursor:pointer;
  border-radius:6px 6px 0 0}
.tabs button:hover{background:var(--panel);color:var(--ink)}
.tabs button[aria-selected]{color:var(--accent);font-weight:650;border-bottom-color:var(--accent)}
.tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.panel[hidden]{display:none}
.panel>h2:first-child{margin-top:0}
@media(max-width:820px){.stats{grid-template-columns:repeat(2,1fr)}.wrap{padding:24px 16px 60px}
  .tabs{overflow-x:auto;flex-wrap:nowrap}.tabs button{white-space:nowrap}}
@media print{details.ddl{break-inside:avoid}details[open] pre{max-height:none}}
</style>
<div class="wrap">
  <header class="phead">
    <div class="brand">Jhaveri OS <span>vendor build pack</span></div>
    <div class="gen">generated ${new Date().toISOString().slice(0, 10)}</div>
  </header>
  <nav class="tabs" role="tablist">
    ${SECTIONS.map((x, i) => `<button role="tab" data-t="${x.id}"${i === 0 ? ' aria-selected="true"' : ''}>${x.label}</button>`).join('')}
  </nav>
  ${SECTIONS.map((x, i) => `<section id="p-${x.id}" class="panel"${i === 0 ? '' : ' hidden'}>${x.html.join('\n')}</section>`).join('\n')}
</div>
<script>
  const tabs = [...document.querySelectorAll('.tabs button')];
  tabs.forEach(b => b.addEventListener('click', () => {
    tabs.forEach(o => o.removeAttribute('aria-selected'));
    b.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'p-' + b.dataset.t; });
    window.scrollTo({ top: 0 });
  }));
</script>`;

  writeFileSync(OUT, html);
  console.log(`Vendor pack → ${OUT}`);
  console.log(`  ${tables.length} tables (${created.length} new, ${matviews.length} matviews)`);
  console.log(`  ${captured.length} queries captured, ${failed.length} functions exposed no SQL`);
  console.log(`  ${ruleSets.length} rule sets, ${writes.length} write paths, ${totalChecks} assertions`);
  console.log(`  ${terms.length} figures with plain-words entries`);
}

main();
