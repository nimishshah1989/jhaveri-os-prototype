import Link from 'next/link';
import { Explain } from '../../../components/Explain';
import { ChartLines } from '../../../components/charts';
import { inr, inrCompact, dmy } from '../../../lib/format';
import {
  outlooks, goalPath, monthsBoughtBy, verdict, untagged, rateGap, GOAL_RULES, type Outlook,
} from '../../../lib/goals';
import { clientKpis, type ClientHeader } from '../../../lib/client360';

// What this client is saving for — the one thing the broker could not see before a
// review call. Same engine as the client's own screen, so an arrival date here and
// an arrival date on their phone can never differ; verify-goals-book holds it.

/** The month a projection has earned. A day would be false precision. */
const month = (d: string) => dmy(d).slice(3);

/** One more instalment, priced in time. Round numbers, because it is a conversation. */
const LEVERS = [2000, 5000, 10000];

function state(o: Outlook): { label: string; cls: string } {
  if (o.met) return { label: 'Reached', cls: 'lt' };
  if (o.monthsOff == null) return { label: 'Not on this path', cls: 'atrisk' };
  if (o.monthsOff > 0) return { label: `${o.monthsOff} months late`, cls: 'conc' };
  return { label: `${Math.abs(o.monthsOff)} months early`, cls: 'lt' };
}

function Goal({ o, focus }: { o: Outlook; focus: boolean }) {
  const s = state(o);
  // The two rates side by side. This is the sentence that turns "you are behind"
  // into something with a cause: the money is assumed to earn X and the target
  // demands Y, and the fix is the target, the date or the instalment — never a
  // hunt for a fund that returns Y.
  const gap = rateGap(o);
  // The lever that changes the answer, not a fixed one: the smallest step that
  // actually buys time back on THIS goal is what belongs in the broker's mouth.
  const lever = LEVERS.map(x => ({ x, months: monthsBoughtBy(o, x) }))
    .find(l => l.months != null && l.months > 0) ?? { x: LEVERS[LEVERS.length - 1], months: null };
  const path = goalPath(o, lever.x);
  // One point a quarter keeps a twenty-year path legible without thinning what it
  // says; the last month is always kept so the ending is never cropped. The ISO
  // month rides along so the target line can be placed without parsing a label
  // back into a date.
  const kept = path.filter((_, i) => i % 3 === 0 || i === path.length - 1);
  const rows = kept.map(p => ({
    m: month(p.m), projected: p.projected, boosted: p.boosted, target: p.target,
  }));
  // The reference line has to sit on a tick the axis actually drew, so it snaps to
  // the kept point nearest the target month.
  const nearest = kept.reduce((best, p) =>
    Math.abs(Date.parse(p.m) - Date.parse(o.on)) < Math.abs(Date.parse(best.m) - Date.parse(o.on)) ? p : best,
  kept[0]);
  const nearestTick = month(nearest.m);

  return (
    <div className="viz" style={{ marginBottom: 16 }}>
      <h4>
        {o.name}
        <span className={`fchip ${s.cls}`} style={{ marginLeft: 6 }}>{s.label}</span>
        <span className="d" style={{ marginLeft: 'auto', fontWeight: 400 }}>
          {inrCompact(o.now)} of {inrCompact(o.target)} · by {month(o.on)}
        </span>
      </h4>

      {o.schemes === 0 ? (
        <div className="empty">
          Named, but nothing is tagged to it yet — so there is no path to draw. Tagging a fund to
          this goal is the whole fix, and it is a two-minute job on the holdings tab.
        </div>
      ) : (
        <>
          <ChartLines
            height={focus ? 250 : 210} unit="inr"
            title={`Path to ${inrCompact(o.target)}`}
            xLabel="month" yLabel="value"
            source={`${o.schemes} scheme${o.schemes === 1 ? '' : 's'} tagged to this goal, walked monthly at ${o.rate}% — ${GOAL_RULES.version}`}
            data={rows} xKey="m"
            vline={{ x: nearestTick, label: `due ${month(o.on)}` }}
            alt={`${o.name}: ${inr(o.now)} today against a target of ${inr(o.target)} by ${month(o.on)}. ${verdict(o)}`}
            series={[
              { key: 'target', name: `Target ${inrCompact(o.target)}`, tone: 'grey' },
              { key: 'projected', name: 'On what goes in today', tone: 's1' },
              ...(lever.months ? [{ key: 'boosted', name: `With ₹${lever.x.toLocaleString('en-IN')} a month more`, tone: 'green' as const }] : []),
            ]}
            mark={<>
              {verdict(o)}
              {lever.months
                ? <> Another <b>₹{lever.x.toLocaleString('en-IN')}</b> a month buys back <b>{lever.months} month{lever.months === 1 ? '' : 's'}</b> — that is the green line.</>
                : <> Nothing in the {LEVERS.map(x => `₹${x.toLocaleString('en-IN')}`).join(' / ')} range brings it inside the horizon, so the conversation is about the target or the date, not the instalment.</>}
            </>}
            aside={<Explain teaser="What the line assumes">
              Projected at <b>{o.rate}%</b>, blended from what this goal actually holds
              ({o.mix.map(m => `${m.asset} ${m.pct}%`).join(' · ')}) at the published rates —{' '}
              {Object.entries(GOAL_RULES.rates).map(([k, v]) => `${k} ${v}%`).join(' · ')}.
              {o.ownRate !== null && <> This money has actually done <b>{o.ownRate}%</b> so far, and that
              figure is deliberately not projected forward: compounding one client&apos;s own history
              for twenty years is arithmetically perfect and completely false.</>}
            </Explain>}
          />
          <div className="lrow" style={{ marginTop: 8 }}>
            <span>Assumed / needed</span>
            <span className={`num ${gap.shortfall_pts != null && gap.shortfall_pts > 0 ? 'down' : 'up'}`}>
              {gap.assumed}% / {gap.required === null ? 'unreachable' : `${gap.required}%`}
            </span>
            <span>Going in monthly</span>
            <span className="num">{o.monthly > 0 ? `${inr(o.monthly)}/mo` : 'nothing'}</span>
            <span>Put in so far</span>
            <span className="num">{inr(o.put)}</span>
            <span>Worth today</span>
            <span className="num">{inr(o.now)}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function GoalsTab({ id, head, focus }: { id: number; head: ClientHeader; focus?: string }) {
  const list = outlooks(id);
  const loose = untagged(id);
  const total = clientKpis(id).value.v;
  const first = head.name.split(' ')[0];

  if (list.length === 0) {
    return (
      <div className="viz">
        <h4>Nothing named yet</h4>
        <div className="empty">
          {first} has never said what this money is for. {inrCompact(total)} is invested against no
          stated purpose — which is not a data gap, it is the conversation that has not happened.
          A goal takes a name, a number and a date, and it is the single thing that most changes
          whether someone stays invested in a bad month.
        </div>
        <div className="mark">
          Naming one is a client-side action today. <Link href={`/clients/${id}?tab=actions`}>Log it as a note</Link> and
          it joins the queue on Today.
        </div>
      </div>
    );
  }

  const late = list.filter(o => !o.met && (o.monthsOff == null || o.monthsOff > 0));

  return (
    <>
      <div className="cards six" style={{ marginBottom: 14 }}>
        <div className="card hero"><div className="body">
          <div className="k">Working towards something</div>
          <div className="v num">{inrCompact(list.reduce((s, o) => s + o.now, 0))}</div>
          <div className="s">{list.length} goal{list.length === 1 ? '' : 's'} named</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Not spoken for</div>
          <div className="v num warn">{inrCompact(loose.value)}</div>
          <div className="s">{loose.schemes} fund{loose.schemes === 1 ? '' : 's'} with no purpose</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Behind</div>
          <div className={`v num ${late.length ? 'warn' : 'good'}`}>{late.length}</div>
          <div className="s">of {list.length} on today&apos;s instalments</div>
        </div></div>
      </div>

      <div className="d">
        Distance is in months, not rupees — &ldquo;₹4 L short&rdquo; means nothing to a client
        and &ldquo;fourteen months late&rdquo; means everything.
        <Explain teaser="Why we never project their own return">
          One of these goals has earned 48.7% and another has lost money. Compounding either
          forward for twenty years produces a number that is arithmetically perfect and completely
          false. Every line here uses the published rate for what the money is actually in, the
          same for every client in the firm, and their own record stays on the fund pages where it
          belongs.
        </Explain>
      </div>

      {list.map(o => <Goal key={o.goal_id} o={o} focus={String(o.goal_id) === focus} />)}
    </>
  );
}
