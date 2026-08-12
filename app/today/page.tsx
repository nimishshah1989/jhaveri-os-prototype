import Link from 'next/link';
import { MarketStrip, NewsPanel } from '../../components/MarketStrip';
import { StatCard } from '../../components/StatCard';
import { QueueTable } from '../../components/QueueTable';
import { Explain } from '../../components/Explain';
import { PageHead } from '../../components/PageHead';
import { Icon } from '../../components/Icon';
import { inrCompact, signedInrCompact, dmy } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import {
  broker, myBook, netFlowsMtd, churnRisk, idleNoSip, sipsAtRisk, onboardingStuck,
  bookList, flowsList, churnList, idleList, sipRiskList, stuckList,
  streams, scoreboard, learning,
} from '../../lib/queries';
import { addTask } from './actions';
import { bookHealth } from '../../lib/scoring';
import { actionDetail } from '../../lib/action-detail';
import { ActionDrawer } from '../../components/ActionDrawer';
import { QueueKeys } from '../../components/QueueKeys';
import { VoiceTask } from '../../components/VoiceTask';
import { ProgressStrip } from '../../components/ProgressStrip';
import { QueueFilter } from '../../components/QueueFilter';
import { ChartBars } from '../../components/charts';
import { typeOf } from '../../lib/queue-display';

export const dynamic = 'force-dynamic';

export default async function TodayPage({ searchParams }: PageProps<'/today'>) {
  const sp = await searchParams;
  const openId = typeof sp.action === 'string' ? Number(sp.action) : undefined;
  const kind = typeof sp.type === 'string' ? sp.type : undefined;
  const detail = openId ? actionDetail(openId) : null;
  const me = broker();
  const book = myBook(me.code);
  const flows = netFlowsMtd();
  const churn = churnRisk(me.code);
  const idle = idleNoSip(me.code);
  const sipRisk = sipsAtRisk(me.code);
  const stuck = onboardingStuck();
  const scores = bookHealth(me.code);
  const q = streams();
  // Health lens on the queue: a client's available score-gain rides along, and
  // opportunities rank by ₹ at stake × gain available (quick wins surface).
  for (const item of [...q.red, ...q.amber, ...q.grey]) {
    item.score_gain = item.client_id != null ? scores.get(item.client_id)?.gain ?? 0 : 0;
  }
  q.amber.sort((a, b) => (b.impact_score * (1 + (b.score_gain ?? 0) / 20)) - (a.impact_score * (1 + (a.score_gain ?? 0) / 20)));
  // "Next" has to mean the next row on his screen, so it is read off the sorted
  // streams rather than re-queried — otherwise the drawer walks a different order
  // than the list behind it.
  const all = [...q.red, ...q.amber, ...q.grey];
  if (kind) {
    q.red = q.red.filter(i => i.action_type === kind);
    q.amber = q.amber.filter(i => i.action_type === kind);
    q.grey = q.grey.filter(i => i.action_type === kind);
  }
  // Walking order follows what is on screen, so j/k and "next" obey the filter too.
  const order = [...q.red, ...q.amber, ...q.grey];
  const at = openId ? order.findIndex(i => i.action_id === openId) : -1;
  const nextId = at >= 0 ? order[at + 1]?.action_id : undefined;
  const prevId = at > 0 ? order[at - 1].action_id : undefined;

  const score = scoreboard();
  const learn = learning();

  // Two pictures of the same queue: when it lands, and what it is worth. Both are
  // folded out of the streams already in hand — no second query, and no number in
  // either that the table below does not also carry. Both follow the filter, so
  // the charts and the rows under them can never describe different work.
  const band = (due: string) => {
    const d = Math.round((Date.parse(due) - Date.parse(TODAY)) / 86400000);
    return d < 0 ? 0 : d === 0 ? 1 : d === 1 ? 2 : d <= 7 ? 3 : d <= 14 ? 4 : 5;
  };
  const BANDS = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Next 2 wks', 'Later'];
  const week = BANDS.map((label, i) => ({
    band: label,
    now: q.red.filter(a => band(a.sla_due) === i).length,
    opp: q.amber.filter(a => band(a.sla_due) === i).length,
    fyi: q.grey.filter(a => band(a.sla_due) === i).length,
  }));
  const overdue = week[0].now + week[0].opp + week[0].fyi;

  // impact_score is rupees — the same figure the Opportunities stream is already
  // ranked by. Grouped by kind of work, and each bar keeps the colour that kind
  // wears in the table, so the chart and the row are the same vocabulary.
  const kinds = new Map<string, { kind: string; v: number; n: number; tone: string }>();
  for (const a of order) {
    const t = typeOf(a.action_type);
    const row = kinds.get(t.label) ?? { kind: t.label, v: 0, n: 0, tone: t.tone };
    row.v += a.impact_score;
    row.n += 1;
    kinds.set(t.label, row);
  }
  const worth = [...kinds.values()].sort((a, b) => a.v - b.v);
  const atStake = worth.reduce((s, k) => s + k.v, 0);

  return (
    <>
      <MarketStrip />
      <PageHead
        title="Today" icon="spark"
        question="What needs me today, and what is it worth if I do it?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />

      <ProgressStrip name={me.name} p={{
        closed: score.value.closed,
        closedInSla: score.value.closedInSla,
        dueToday: score.value.dueToday,
        movedThisMonth: signedInrCompact(flows.value.v),
        movedPositive: flows.value.v >= 0,
      }} learning={learn.value} learningFigure={learn} />

      <div className="wide">
        <div>
          <QueueFilter items={all} active={kind} />
          <div className="cards">
            <StatCard hero id="my_book" icon="money" label="My book" value={inrCompact(book.value.v)} sub={`${bookList(me.code).total} clients · as of ${dmy(book.value.as_of)}`} figure={book} list={bookList(me.code)} />
            <StatCard id="net_flows_mtd" icon="up" label="Net flows · Aug" value={signedInrCompact(flows.value.v)} sub={`${flows.value.n} transactions this month`} tone={flows.value.v >= 0 ? 'pos' : 'warn'} figure={flows} list={flowsList()} />
            <StatCard id="churn_risk" icon="alert" label="Churn risk" value={`${churn.value.n} clients`} sub={`${inrCompact(churn.value.v)} at risk · gone quiet / concentrated`} tone="warn" figure={churn} list={churnList(me.code)} />
            <StatCard id="idle_no_sip" icon="target" label="Invested, no SIP" value={`${idle.value.n} clients`} sub={`${inrCompact(idle.value.v)} held · zero monthly commitment`} tone="opp" figure={idle} list={idleList(me.code)} />
            <StatCard id="sips_at_risk" icon="clock" label="SIPs at risk" value={`${sipRisk.value.n} plans`} sub={`${inrCompact(sipRisk.value.v)} / year on the line`} tone="warn" figure={sipRisk} list={sipRiskList(me.code)} />
            <StatCard id="onboarding_stuck" icon="clock" label="Onboarding stuck" value={`${stuck.value.n} application${stuck.value.n === 1 ? '' : 's'}`} sub={`oldest waiting ${stuck.value.days} days`} tone="warn" figure={stuck} list={stuckList()} listAmountKind="days" />
          </div>

          <form className="taskadd" action={addTask}>
            <input type="text" name="note" placeholder="Add your own task — joins this queue with the same priorities…" required />
            <select name="days" defaultValue="7">
              <option value="1">by tomorrow</option>
              <option value="3">in 3 days</option>
              <option value="7">next week</option>
            </select>
            <VoiceTask targetName="note" />
            <button type="submit">Add</button>
          </form>

          <div className="charts">
            <ChartBars
              title="When the queue lands" height={210}
              xLabel="due" yLabel="items"
              source="actions.sla_due · open items assigned to you"
              data={week} xKey="band"
              series={[
                { key: 'now', name: 'Act now', tone: 'red', stack: 'q' },
                { key: 'opp', name: 'Opportunities', tone: 'amber', stack: 'q' },
                { key: 'fyi', name: 'Relationship & FYI', tone: 'grey', stack: 'q' },
              ]}
              mark={overdue > 0
                ? <><b>{overdue}</b> of {order.length} are already past their date — the week starts behind.</>
                : <>Nothing overdue. <b>{week[1].now + week[1].opp + week[1].fyi}</b> due today.</>}
              aside={<Explain teaser="How the bands are set">
                Bands are cut off the SLA date each item was minted with, not off when you
                opened the page. &ldquo;Act now&rdquo; is money work due by tomorrow;
                relationship items never escalate into it, however old they get.
              </Explain>}
            />
            <ChartBars
              horizontal unit="inr" height={210}
              title="What it is worth, by kind of work"
              xLabel="₹ at stake" yLabel="kind"
              source="actions.impact_score — the figure the Opportunities stream is ranked by"
              data={worth} xKey="kind"
              series={[{ key: 'v', name: '₹ at stake', tone: 'blue' }]}
              toneKey="tone"
              mark={<><b>{inrCompact(atStake)}</b> across {order.length} open items{kind ? ` · filtered to ${typeOf(kind).label}` : ''}. Birthdays carry no rupee figure and sit at zero on purpose.</>}
            />
          </div>

          {/* One table, three sections. Three tables meant three column templates and
              the eye stepped sideways twice on the way down the page. */}
          <div className="stream">
            <div className="streamhint">
              <span className="hint">click a row for the full story · <b>j</b> <b>k</b> to move · <b>esc</b> to close</span>
            </div>
            <QueueTable openId={openId} sections={[
              { key: 'red', label: 'Act now', icon: 'alert', tone: 'red', items: q.red, shown: 6 },
              { key: 'amber', label: 'Opportunities', icon: 'target', tone: 'amber', items: q.amber, shown: 4, note: 'ranked by ₹' },
              { key: 'grey', label: 'Relationship & FYI', icon: 'users', tone: 'grey', items: q.grey, shown: 4 },
            ]} />
          </div>
        </div>

      </div>

      <QueueKeys prevId={prevId} nextId={nextId} firstId={order[0]?.action_id} isOpen={!!openId} />

      {detail && <ActionDrawer detail={detail} nextId={nextId} />}

      {/* Other pages link here by action id, and some of those items belong to a
          different broker — the lookup is scoped to the signed-in one on purpose.
          Say so; a link that opens nothing is worse than one that explains itself. */}
      {openId && !detail && (
        <>
          <Link href="/today" className="scrim" aria-label="Close" />
          <aside className="drawer" aria-label="Item not available">
            <header>
              <span className="tchip grey">Not in your queue</span>
              <Link href="/today" className="x" aria-label="Close">×</Link>
            </header>
            <h2>Item #{openId}</h2>
            <p className="dnote">
              This action is assigned to another broker, or has already been closed and
              archived. You are seeing it referenced from another page — only its owner
              can work it.
            </p>
          </aside>
        </>
      )}
    </>
  );
}
