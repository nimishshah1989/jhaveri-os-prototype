import { MarketStrip, NewsPanel } from '../../components/MarketStrip';
import { StatCard } from '../../components/StatCard';
import { QueueCard } from '../../components/QueueCard';
import { Provenance } from '../../components/Provenance';
import { inrCompact, signedInrCompact, dmy } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import {
  broker, myBook, netFlowsMtd, churnRisk, idleNoSip, sipsAtRisk, onboardingStuck,
  bookList, flowsList, churnList, idleList, sipRiskList, stuckList,
  streams, scoreboard, learning,
} from '../../lib/queries';
import { addTask } from './actions';

export const dynamic = 'force-dynamic';

export default function TodayPage() {
  const me = broker();
  const book = myBook(me.code);
  const flows = netFlowsMtd();
  const churn = churnRisk(me.code);
  const idle = idleNoSip(me.code);
  const sipRisk = sipsAtRisk(me.code);
  const stuck = onboardingStuck();
  const q = streams();
  const score = scoreboard();
  const learn = learning();
  const closedPct = score.value.closed > 0 ? Math.round((score.value.closedInSla / score.value.closed) * 100) : null;

  return (
    <>
      <MarketStrip />
      <div className="pagehead">
        <h1>Today</h1>
        <span className="fresh">{dmy(TODAY)}</span>
      </div>

      <div className="cols">
        <div>
          <div className="cards">
            <StatCard label="My book" value={inrCompact(book.value.v)} sub={`${bookList(me.code).total} clients · as of ${dmy(book.value.as_of)}`} figure={book} list={bookList(me.code)} />
            <StatCard label="Net flows · Aug" value={signedInrCompact(flows.value.v)} sub={`${flows.value.n} transactions this month`} tone={flows.value.v >= 0 ? 'pos' : 'warn'} figure={flows} list={flowsList()} />
            <StatCard label="Churn risk" value={`${churn.value.n} clients`} sub={`${inrCompact(churn.value.v)} at risk · gone quiet / concentrated`} tone="warn" figure={churn} list={churnList(me.code)} />
            <StatCard label="Invested, no SIP" value={`${idle.value.n} clients`} sub={`${inrCompact(idle.value.v)} held · zero monthly commitment`} tone="opp" figure={idle} list={idleList(me.code)} />
            <StatCard label="SIPs at risk" value={`${sipRisk.value.n} plans`} sub={`${inrCompact(sipRisk.value.v)} / year on the line`} tone="warn" figure={sipRisk} list={sipRiskList(me.code)} />
            <StatCard label="Onboarding stuck" value={`${stuck.value.n} application${stuck.value.n === 1 ? '' : 's'}`} sub={`oldest waiting ${stuck.value.days} days`} tone="warn" figure={stuck} list={stuckList()} listAmountKind="days" />
          </div>

          <form className="taskadd" action={addTask}>
            <input type="text" name="note" placeholder="Add your own task — joins this queue with the same priorities…" required />
            <select name="days" defaultValue="7">
              <option value="1">by tomorrow</option>
              <option value="3">in 3 days</option>
              <option value="7">next week</option>
            </select>
            <button type="button" className="mic" title="Voice capture ships next — browser speech-to-text">🎙 voice — next</button>
            <button type="submit">Add</button>
          </form>

          <section className="stream red">
            <h2>Act now <span className="count">· {q.red.length}</span></h2>
            {q.red.length === 0 && <div className="empty">Nothing urgent — the queue is clear.</div>}
            {q.red.map(item => <QueueCard key={item.action_id} item={item} />)}
          </section>

          <section className="stream amber">
            <h2>Opportunities <span className="count">· {q.amber.length} — ranked by ₹</span></h2>
            {q.amber.length === 0 && <div className="empty">No open opportunities right now.</div>}
            {q.amber.map(item => <QueueCard key={item.action_id} item={item} />)}
          </section>

          <section className="stream grey">
            <h2>Relationship &amp; FYI <span className="count">· {q.grey.length}</span></h2>
            {q.grey.length === 0 && <div className="empty">Nothing here today.</div>}
            {q.grey.map(item => <QueueCard key={item.action_id} item={item} />)}
          </section>
        </div>

        <aside className="side">
          <NewsPanel />
          <div className="panel score">
            <h3>My scoreboard <Provenance figure={score} /></h3>
            <div className="big num">
              {score.value.closed > 0 ? `${score.value.closedInSla} of ${score.value.closed}` : '—'}
            </div>
            <div className="d">
              {closedPct !== null ? `actions closed within deadline (${closedPct}%)` : 'no actions closed yet'} · {score.value.dueToday} due today
              <br />
              Management sees this same number.
            </div>
          </div>
          <div className="panel learn">
            <h3>What the system is learning <Provenance figure={learn} /></h3>
            {learn.value.map(p => (
              <div key={`${p.workflow}-${p.policy_key}`} className="row">
                <span>{p.workflow.replace(/_/g, ' ')} · {p.policy_key.replace(/_/g, ' ')}</span>
                <span className="bar"><i style={{ width: `${Math.min(100, (p.evidence_n / p.target_n) * 100)}%` }} /></span>
                <span className="num">{p.evidence_n}/{p.target_n}</span>
              </div>
            ))}
            <div className="d ghost">Greyed until enough real outcomes exist — never a faked insight.</div>
          </div>
        </aside>
      </div>
    </>
  );
}
