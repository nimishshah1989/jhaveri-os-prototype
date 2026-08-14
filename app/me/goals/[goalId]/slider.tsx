'use client';

import { useState } from 'react';
import type { Step } from '../../../../lib/goals';

// Drag a monthly amount, watch the arrival date move. Steps are precomputed by the
// same function that printed the date above; the slider chooses an index and does
// no arithmetic, because a second model in the browser would diverge from the
// first one touched. The answer is months, never final rupees — "four years
// sooner" is decidable and "₹1.2 crore instead of ₹94 lakh" is not.

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function when(s: Step, base: Step): string {
  if (s.met) return 'Already there';
  if (s.reachedOn === null) return 'Still does not get there';
  const sooner = base.monthsOff === null || s.monthsOff === null
    ? null
    : base.monthsOff - s.monthsOff;
  if (!sooner) return 'No change yet';
  const years = Math.floor(sooner / 12);
  const months = sooner % 12;
  return years > 0
    ? `${years} year${years === 1 ? '' : 's'}${months ? ` ${months} month${months === 1 ? '' : 's'}` : ''} sooner`
    : `${months} month${months === 1 ? '' : 's'} sooner`;
}

export function GoalSlider({ steps }: { steps: Step[] }) {
  const [i, setI] = useState(0);
  const s = steps[i];
  const base = steps[0];

  return (
    <div className="f-sim">
      <div className="f-simhead">
        <span className="num">{s.extra === 0 ? 'As it is today' : `${inr(s.extra)} a month more`}</span>
        <b className="num">{s.label}</b>
      </div>

      <input
        className="f-range"
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={i}
        onChange={e => setI(Number(e.target.value))}
        aria-label="Extra amount each month"
        aria-valuetext={`${inr(s.extra)} a month more, arriving ${s.reachedOn ? s.label : 'not within reach'}`}
      />

      <div className="f-simfoot">
        <span>{inr(0)}</span>
        <span className={s.extra > 0 && s.reachedOn ? 'good' : undefined}>{when(s, base)}</span>
        <span>{inr(steps[steps.length - 1].extra)}</span>
      </div>
    </div>
  );
}
