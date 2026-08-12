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
