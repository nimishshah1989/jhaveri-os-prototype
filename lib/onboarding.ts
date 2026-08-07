import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { Figure, figure } from './queries';

// Onboarding reads the pipeline off the ledger, not off status columns: every
// stage entry is an `events` row, so "how many days at each stage" is measured,
// never stored. The status columns on onboarding_applications are the current
// snapshot; the events are the history. Where the two could disagree,
// verify-onboarding.ts asserts they don't.

/** Every threshold this page applies. One home, like SCORING_RULES. */
export const ONBOARDING_RULES = {
  /**
   * Days waiting in a stage before it counts as stalled and mints an action.
   * The one time-based knob: it governs both an unsigned e-log and a KYC still
   * sitting with the KRA. A rejection is not on this clock — it blocks from the
   * day it lands, because nothing moves until someone collects a document.
   */
  stall_days: 7,
  /** What "good" looks like: lead to live, in days. */
  target_days_to_live: 3,
  /** The bar the market has already set — research 02 §3.3. */
  benchmark: { who: 'AssetPlus', claim: '180-second paperless onboarding', source: 'research 02 §3.3' },
} as const;

export type StageKey = 'lead' | 'kyc' | 'elog' | 'ucc' | 'live';

export const STAGES: { key: StageKey; label: string; blurb: string }[] = [
  { key: 'lead', label: 'Lead', blurb: 'Name and number captured. Nothing filed yet.' },
  { key: 'kyc', label: 'KYC', blurb: 'Form and documents with the KRA, waiting on their verdict.' },
  { key: 'elog', label: 'e-log', blurb: 'BSE needs the client to authenticate. Digital path only.' },
  { key: 'ucc', label: 'UCC', blurb: 'KYC cleared, waiting for the exchange client code.' },
  { key: 'live', label: 'Live', blurb: 'Code allotted. They can transact.' },
];

export interface AppCard {
  application_id: number;
  name: string;
  broker: string;
  sb_id: number;
  client_id: number | null;
  channel: string;
  holding_type: string;
  stage: StageKey;
  since: string;
  days: number;
  blocked: string | null;
  error_code: string | null;
  action_id: number | null;
  action_state: string | null;
}

// The current stage is derived from the snapshot columns; the date it was entered
// comes from the matching event. Both in one statement so they can never drift.
const CARD_SQL = `
WITH ev AS (
  SELECT CAST(subject_id AS INTEGER) app, event_type, MIN(occurred_at) at
  FROM events WHERE subject_type='application' GROUP BY 1, 2
),
st AS (
  SELECT oa.application_id, oa.sb_id, oa.client_id, oa.channel, oa.holding_type,
         oa.kyc_status, oa.elog_status, oa.ucc_status, oa.started_at, oa.stall_since,
         CASE WHEN oa.ucc_status='ACTIVE'      THEN 'live'
              WHEN oa.ucc_status='PENDING_UCC' THEN 'ucc'
              WHEN oa.elog_status IN ('sent','stalled') THEN 'elog'
              ELSE 'kyc' END stage,
         k.name, k.kra_status_code, k.rejection_level
  FROM onboarding_applications oa
  JOIN client_kyc_logs k ON k.id = oa.kyc_log_id
)
SELECT st.*, sb.sb_holder_name broker,
  COALESCE(CASE st.stage
    WHEN 'live' THEN (SELECT at FROM ev WHERE app=st.application_id AND event_type='ucc_allotted')
    WHEN 'ucc'  THEN (SELECT at FROM ev WHERE app=st.application_id AND event_type='elog_completed')
    WHEN 'elog' THEN (SELECT at FROM ev WHERE app=st.application_id AND event_type='elog_sent')
    ELSE (SELECT at FROM ev WHERE app=st.application_id AND event_type='application_started')
  END, st.started_at) since,
  (SELECT a.action_id FROM actions a WHERE a.subject_type='application'
     AND a.subject_id = CAST(st.application_id AS TEXT)
   ORDER BY CASE a.state WHEN 'done' THEN 2 WHEN 'dismissed' THEN 2 ELSE 1 END, a.action_id DESC LIMIT 1) action_id,
  (SELECT a.state FROM actions a WHERE a.subject_type='application'
     AND a.subject_id = CAST(st.application_id AS TEXT)
   ORDER BY CASE a.state WHEN 'done' THEN 2 WHEN 'dismissed' THEN 2 ELSE 1 END, a.action_id DESC LIMIT 1) action_state
FROM st JOIN sub_broker_master sb ON sb.sb_id = st.sb_id
ORDER BY since`;

interface CardRow extends Omit<AppCard, 'days' | 'blocked' | 'stage'> {
  stage: StageKey;
  kyc_status: string;
  elog_status: string | null;
  kra_status_code: string | null;
  rejection_level: string | null;
  stall_since: string | null;
}

function daysSince(iso: string): number {
  return Math.max(0, Math.round((Date.parse(TODAY) - Date.parse(iso)) / 86400000));
}

function cards(): AppCard[] {
  return (db().prepare(CARD_SQL).all() as CardRow[]).map(row => {
    const days = daysSince(row.since);
    const rejected = row.kyc_status === 'REJECTED';
    const overdue = days > ONBOARDING_RULES.stall_days;
    const blocked = rejected ? 'KRA rejected the application'
      : row.stage === 'elog' && overdue ? 'Client has not signed the BSE e-log'
        : row.stage === 'kyc' && overdue ? 'Documents still not with the KRA'
          : null;
    return {
      application_id: row.application_id, name: row.name, broker: row.broker, sb_id: row.sb_id,
      client_id: row.client_id, channel: row.channel, holding_type: row.holding_type,
      stage: row.stage, since: row.since, days, blocked,
      error_code: rejected ? row.kra_status_code : null,
      action_id: row.action_id, action_state: row.action_state,
    };
  });
}

export interface PipelineColumn { key: StageKey; label: string; blurb: string; cards: AppCard[]; leads?: LeadRow[] }
export interface LeadRow { lead_id: number; name: string; source: string; broker: string; days: number; consent_state: string }

/** The board: open leads plus every live application, in the column it sits in. */
export function pipeline(): { columns: PipelineColumn[]; sql: string } {
  const all = cards();
  const leads = db().prepare(`SELECT l.lead_id, l.name, l.source, l.consent_state, l.created_at, sb.sb_holder_name broker
    FROM leads l JOIN sub_broker_master sb ON sb.sb_id = l.sb_id
    WHERE l.stage IN ('new','contacted') ORDER BY l.created_at`).all() as
    (Omit<LeadRow, 'days'> & { created_at: string })[];
  const columns = STAGES.map(s => ({
    ...s,
    cards: s.key === 'lead' ? [] : all.filter(c => c.stage === s.key),
    leads: s.key === 'lead' ? leads.map(l => ({ ...l, days: daysSince(l.created_at) })) : undefined,
  }));
  return { columns, sql: CARD_SQL };
}

export interface FunnelStep { label: string; n: number; medianDays: number | null; note?: string }

/** Where applications die, and how long each step actually takes. */
export function funnel(): Figure<FunnelStep[]> {
  const rows = db().prepare(`SELECT CAST(subject_id AS INTEGER) app, event_type, MIN(occurred_at) at
    FROM events WHERE subject_type='application' GROUP BY 1, 2`).all() as
    { app: number; event_type: string; at: string }[];
  const byApp = new Map<number, Record<string, string>>();
  for (const e of rows) {
    if (!byApp.has(e.app)) byApp.set(e.app, {});
    byApp.get(e.app)![e.event_type] = e.at;
  }
  const leadCount = (db().prepare('SELECT COUNT(*) n FROM leads').get() as { n: number }).n;

  const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };
  const gap = (from: string, to: string): number | null => median([...byApp.values()]
    .filter(e => e[from] && e[to])
    .map(e => Math.round((Date.parse(e[to]) - Date.parse(e[from])) / 86400000)));
  const seen = (type: string) => [...byApp.values()].filter(e => e[type]).length;

  const steps: FunnelStep[] = [
    { label: 'Leads captured', n: leadCount, medianDays: gap('lead_created', 'application_started'), note: 'median measured on the leads that became applications' },
    { label: 'Application opened', n: seen('application_started'), medianDays: gap('application_started', 'kyc_verified') },
    { label: 'KYC cleared', n: seen('kyc_verified'), medianDays: gap('kyc_verified', 'elog_completed'), note: 'paper applications clear this step instantly — no BSE e-log' },
    { label: 'e-log cleared', n: seen('elog_completed'), medianDays: gap('elog_completed', 'ucc_allotted') },
    { label: 'UCC allotted — live', n: seen('ucc_allotted'), medianDays: null },
  ];
  return {
    value: steps, tag: 'computed',
    sql: "SELECT subject_id, event_type, MIN(occurred_at) FROM events WHERE subject_type='application' GROUP BY 1,2\n-- counts = applications reaching each stage-entry event; medians = date gaps between consecutive events",
    sources: ['events.event_type', 'events.occurred_at', 'events.subject_id', 'leads.lead_id'],
  };
}

/** Lead → live, end to end, for the applications that finished. The goal metric. */
export function daysToLive(): Figure<{ median: number | null; n: number; best: number | null }> {
  const rows = db().prepare(`SELECT CAST(a.subject_id AS INTEGER) app,
      MIN(CASE WHEN a.event_type='application_started' THEN a.occurred_at END) opened,
      MIN(CASE WHEN a.event_type='ucc_allotted' THEN a.occurred_at END) live
    FROM events a WHERE a.subject_type='application' GROUP BY 1 HAVING opened IS NOT NULL AND live IS NOT NULL`)
    .all() as { opened: string; live: string }[];
  const days = rows.map(r => Math.round((Date.parse(r.live) - Date.parse(r.opened)) / 86400000)).sort((a, b) => a - b);
  const m = Math.floor(days.length / 2);
  return {
    value: {
      median: days.length ? (days.length % 2 ? days[m] : Math.round((days[m - 1] + days[m]) / 2)) : null,
      n: days.length,
      best: days.length ? days[0] : null,
    },
    tag: 'computed',
    sql: "SELECT subject_id, MIN(CASE WHEN event_type='application_started' THEN occurred_at END) opened,\n  MIN(CASE WHEN event_type='ucc_allotted' THEN occurred_at END) live\nFROM events WHERE subject_type='application' GROUP BY 1 HAVING opened AND live",
    sources: ['events.event_type', 'events.occurred_at'],
  };
}

/** Everything sitting past its threshold, worst first. Both kinds of stall. */
export function stalls(): Figure<AppCard[]> {
  const rows = cards()
    .filter(c => c.blocked && c.stage !== 'live')
    .sort((a, b) => b.days - a.days);
  return {
    value: rows, tag: 'rule',
    sql: `${CARD_SQL}\n-- then: blocked = a KRA rejection (from day one), or >${ONBOARDING_RULES.stall_days} days waiting at the e-log or at KYC`,
    sources: ['onboarding_applications.elog_status', '.stall_since', '.kyc_status', 'events.occurred_at', 'client_kyc_logs.kra_status_code'],
  };
}

/** Aging buckets for the stall chart. */
export function stallAging(): { band: string; n: number }[] {
  const rows = stalls().value;
  const bands: [string, (d: number) => boolean][] = [
    ['0–7 days', d => d <= 7], ['8–14', d => d > 7 && d <= 14],
    ['15–21', d => d > 14 && d <= 21], ['22+', d => d > 21],
  ];
  return bands.map(([band, test]) => ({ band, n: rows.filter(r => test(r.days)).length }));
}

export interface Rejection extends AppCard { official: string; plain: string; ask: string }

// The phrasebook: a KRA error code says one thing to a compliance officer and
// nothing at all to a client. Each entry is what to tell them and what to collect.
// Rule-tagged — this is written policy, not something computed from the data.
const PLAIN_WORDS: Record<string, { plain: string; ask: string }> = {
  'ERR-00009': {
    plain: 'The PAN on the form does not match income-tax records — usually a typo, or a name spelt differently from the card.',
    ask: 'A clear photo of the PAN card, and the name spelt exactly as printed on it.',
  },
  'ERR-00004': {
    plain: 'The address written on the form is not the address on the proof they uploaded.',
    ask: 'Either an address proof that matches the form, or a corrected form matching the proof. One or the other, not both changed.',
  },
  'ERR-00017': {
    plain: 'The signature does not match the one the KRA already holds for them.',
    ask: 'A fresh signature on a blank sheet, signed the way they sign at the bank.',
  },
  'ERR-00010': {
    plain: 'The PAN belongs to someone under 18, so the account cannot stand alone.',
    ask: "The guardian's PAN and KYC, and the child's birth certificate.",
  },
  'ERR-00031': {
    plain: 'The KRA closed the file because the documents never arrived inside their deadline.',
    ask: 'The full set again — the earlier upload has expired and cannot be revived.',
  },
};

/** Rejections, each with the official wording and the sentence to actually say. */
export function rejections(): Figure<Rejection[]> {
  const codes = new Map((db().prepare('SELECT error_code, error_description FROM kra_error_codes').all() as
    { error_code: string; error_description: string }[]).map(c => [c.error_code, c.error_description]));
  const value = cards().filter(c => c.error_code).map(c => {
    const words = PLAIN_WORDS[c.error_code!];
    return {
      ...c,
      official: codes.get(c.error_code!) ?? c.error_code!,
      plain: words?.plain ?? '',
      ask: words?.ask ?? '',
    };
  }).sort((a, b) => b.days - a.days);
  return {
    value, tag: 'rule',
    sql: "SELECT k.kra_status_code, k.rejection_level, e.error_description\nFROM onboarding_applications oa JOIN client_kyc_logs k ON k.id=oa.kyc_log_id\nJOIN kra_error_codes e ON e.error_code=k.kra_status_code\nWHERE oa.kyc_status='REJECTED'\n-- the plain-word sentence is written policy (PLAIN_WORDS in lib/onboarding.ts), not derived",
    sources: ['client_kyc_logs.kra_status_code', '.rejection_level', 'kra_error_codes.error_description'],
  };
}

/** Codes we have not written a plain-word sentence for yet. Ghosted, not hidden. */
export function unphrasedCodes(): string[] {
  return (db().prepare("SELECT error_code FROM kra_error_codes WHERE error_code != 'ERR-00000'").all() as
    { error_code: string }[]).map(c => c.error_code).filter(c => !PLAIN_WORDS[c]);
}

export interface LinkRow { sb_id: number; broker: string; slug: string; visits: number; applications: number; live: number }

/** Referral links: visits are external (web analytics); everything else is ours. */
export function linkStats(): Figure<LinkRow[]> {
  const sql = `SELECT bl.sb_id, sb.sb_holder_name broker, bl.slug, bl.visits,
      COUNT(oa.application_id) applications,
      SUM(CASE WHEN oa.ucc_status='ACTIVE' THEN 1 ELSE 0 END) live
    FROM broker_links bl
    JOIN sub_broker_master sb ON sb.sb_id = bl.sb_id
    LEFT JOIN onboarding_applications oa ON oa.sb_id = bl.sb_id
    WHERE sb.is_active = 1
    GROUP BY bl.sb_id ORDER BY applications DESC, bl.visits DESC`;
  return {
    value: db().prepare(sql).all() as LinkRow[], tag: 'computed', sql,
    sources: ['broker_links.slug', '.visits', 'onboarding_applications.sb_id', '.ucc_status'],
  };
}

/** Applications opened and gone live this month — the movement figures. */
export function monthCounts(): Figure<{ opened: number; live: number }> {
  const sql = `SELECT
    (SELECT COUNT(*) FROM events WHERE subject_type='application' AND event_type='application_started'
       AND occurred_at >= ? AND occurred_at <= ?) opened,
    (SELECT COUNT(*) FROM events WHERE subject_type='application' AND event_type='ucc_allotted'
       AND occurred_at >= ? AND occurred_at <= ?) live`;
  const from = TODAY.slice(0, 8) + '01';
  return figure(sql, ['events.event_type', 'events.occurred_at'], 'computed', [from, TODAY, from, TODAY]);
}

/** The Today card and this page must count the same stalls. One definition. */
export function stuckCount(sbId?: number): { n: number; days: number } {
  const rows = stalls().value.filter(c => sbId == null || c.sb_id === sbId);
  return { n: rows.length, days: rows.length ? rows[0].days : 0 };
}
