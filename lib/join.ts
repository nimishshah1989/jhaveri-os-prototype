import { db } from './db';
import { TODAY } from '../mockdb/engines';
// Type-only: `lib/journey.ts` imports `next/headers`, and this module is walked
// by the verifiers under plain tsx. Erased at compile time, so nothing is loaded.
import type { Journey } from './journey';
import { KRA, kycFor, type KycVerdict } from './kra';

// The KRA half of joining lives in `lib/kra.ts` — its vocabulary and our
// phrasebook for it. Re-exported here so the journey stays one import.
export { kycFor, unphrasedJoinCodes, type KycBranch, type KycVerdict } from './kra';

/* ── Joining ─────────────────────────────────────────────────────────────────
   The client's own way in. Self-signup is the primary path (founder,
   12-Aug-2026); an RM invite is the same journey with the broker code
   pre-filled and nothing else skipped that the RM has not actually supplied.

   Two rules carried over from the broker's onboarding page, and they are the
   reason this file has no `current_step` column:

   1. Progress is measured off `events`, never stored. Each completed step
      appends one row; the current step is derived from what is present. A
      resumed application therefore restores exactly, by construction.
   2. Offline is the base case. ~78% of real applications are paper, and paper
      has NO BSE e-log step — it clears that stage when the KRA verifies and
      stalls on documents at KYC instead. `channel` decides which stages exist.  */

export type Step = 'pan' | 'kyc' | 'bank' | 'nominee' | 'profile' | 'sign' | 'waiting' | 'live';

export const STEPS: { key: Step; label: string; blurb: string }[] = [
  { key: 'pan', label: 'Who you are', blurb: 'Your PAN, so we can check what the KRA already holds for you.' },
  { key: 'kyc', label: 'Your documents', blurb: 'Only if the KRA has nothing on file, or what it holds has lapsed.' },
  { key: 'bank', label: 'Your bank', blurb: 'The account money leaves from and returns to. It must be in your name.' },
  { key: 'nominee', label: 'Who inherits', blurb: 'Name someone, or decline in writing. There is no third option.' },
  { key: 'profile', label: 'What this money is for', blurb: 'Three questions. They shape what we show you, not what we sell you.' },
  { key: 'sign', label: 'Your signature', blurb: 'One e-signature closes the file and sends it to the exchange.' },
  { key: 'waiting', label: 'With the regulator', blurb: 'Nothing is needed from you unless this page says otherwise.' },
  { key: 'live', label: 'Open', blurb: 'Your account can transact.' },
];

/** Event type written when a step completes. One vocabulary, used both ways. */
const DONE = (s: Step) => `join_${s}_done`;

/**
 * Where a blank broker code goes. Self-signup means most people will leave the
 * field empty, and "untagged" is not an option — the broker lens derives every
 * money figure from an advisor attribution, so an untagged client's money would
 * be invisible to the whole firm.
 * ponytail: a single house desk row, created on first use. The real rule
 * (round-robin, or by geography) is a founder decision still open; when it
 * lands it replaces `houseDesk()` and nothing else.
 */
const HOUSE_DESK = { sb_id: 9001, name: 'Jhaveri House Desk', code: 'HOUSE' };

function houseDesk(): number {
  db().prepare(
    `INSERT OR IGNORE INTO sub_broker_master (sb_id, sb_holder_name, sb_sub_broker_code, sb_doj, is_active)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(HOUSE_DESK.sb_id, HOUSE_DESK.name, HOUSE_DESK.code, TODAY);
  return HOUSE_DESK.sb_id;
}

export interface BrokerRef { sb_id: number; name: string; code: string }

/**
 * A broker code is a money field: it decides attribution, and attribution
 * decides commission. So it is checked against the register at entry and a dead
 * code is refused rather than quietly dropped. Blank is not an error — it is the
 * house desk.
 */
export function resolveBroker(code: string): { ok: true; broker: BrokerRef } | { ok: false; reason: string } {
  const typed = code.trim().toUpperCase();
  if (!typed) {
    const id = houseDesk();
    return { ok: true, broker: { sb_id: id, name: HOUSE_DESK.name, code: HOUSE_DESK.code } };
  }
  const row = db().prepare(
    `SELECT sb_id, sb_holder_name name, sb_sub_broker_code code, is_active
     FROM sub_broker_master WHERE UPPER(sb_sub_broker_code) = ?`,
  ).get(typed) as (BrokerRef & { is_active: number }) | undefined;
  if (!row) return { ok: false, reason: `We have no adviser with the code ${typed}. Check it with whoever gave it to you, or leave it blank and we will assign someone.` };
  if (!row.is_active) return { ok: false, reason: `${row.name}'s code is no longer active. Leave it blank and we will assign someone, or use a current code.` };
  return { ok: true, broker: { sb_id: row.sb_id, name: row.name, code: row.code } };
}

/* ── the application, and where it has got to ─────────────────────────────── */

export interface Application {
  application_id: number;
  lead_id: number | null;
  client_id: number | null;
  sb_id: number;
  broker: string;
  channel: 'digital' | 'offline';
  step: Step;
  /** Steps already completed, oldest first. */
  done: Step[];
  /** What was captured at each completed step. */
  data: Record<string, Record<string, string>>;
  kyc: KycVerdict | null;
}

/** Steps this application actually has. Paper has no e-signature of its own. */
export function stepsFor(channel: string, kyc: KycVerdict | null): Step[] {
  const all = STEPS.map(s => s.key);
  return all.filter(s => {
    if (s === 'kyc') return kyc == null || kyc.branch !== 'validated';
    if (s === 'sign') return channel !== 'offline';
    return true;
  });
}

/**
 * Where the application has got to.
 *
 * `carried` is the browser's own copy of the journey (see `lib/journey.ts`).
 * On a serverless deploy the rows written by an earlier step may live on a
 * different instance's scratch database, so both sources are merged and the
 * browser's copy wins — it is the one that cannot be split across instances.
 * Passing nothing reads the database alone, which is what dev and every
 * verifier do.
 */
export function application(id: number, carried?: Journey | null): Application | null {
  const row = db().prepare(
    `SELECT oa.application_id, oa.lead_id, oa.client_id, oa.sb_id, oa.channel,
            COALESCE(sb.sb_holder_name, 'Unassigned') broker
     FROM onboarding_applications oa
     LEFT JOIN sub_broker_master sb ON sb.sb_id = oa.sb_id
     WHERE oa.application_id = ?`,
  ).get(id) as Omit<Application, 'step' | 'done' | 'data' | 'kyc'> | undefined;

  const mine = carried && carried.id === id ? carried : null;
  const base: Omit<Application, 'step' | 'done' | 'data' | 'kyc'> | null = row ?? (mine
    ? { application_id: id, lead_id: mine.lead, client_id: null, sb_id: mine.sb, broker: mine.br, channel: mine.channel }
    : null);
  if (!base) return null;

  const evs = db().prepare(
    `SELECT event_type, payload FROM events
     WHERE subject_type = 'application' AND subject_id = ? AND event_type LIKE 'join_%_done'
     ORDER BY event_id`,
  ).all(String(id)) as { event_type: string; payload: string | null }[];

  const done: Step[] = [];
  const data: Application['data'] = {};
  const put = (key: Step, payload: Record<string, string>) => {
    if (!done.includes(key)) done.push(key);
    data[key] = payload;
  };
  for (const e of evs) {
    const key = e.event_type.slice(5, -5) as Step;
    try { put(key, JSON.parse(e.payload ?? '{}')); } catch { put(key, {}); }
  }
  for (const [key, payload] of mine?.e ?? []) put(key, payload);

  // The paper switch is a single flag, and it may have been set on an instance
  // this request never sees. Once asked for, it stays asked for.
  const channel = mine?.channel === 'offline' ? 'offline' : base.channel;
  const kyc = data.pan?.pan ? kycFor(data.pan.pan) : null;
  const order = stepsFor(channel, kyc);
  const step = order.find(s => !done.includes(s)) ?? 'live';
  // A finished journey names its client in the payload of its own last step, so
  // it is still known when the row that would have carried it is on another box.
  const client_id = base.client_id ?? (data.live?.client_id ? Number(data.live.client_id) : null);
  return { ...base, channel, client_id, done, data, kyc, step };
}

/** Everything captured so far, flattened. Used to prefill a resumed journey. */
export function captured(app: Application): Record<string, string> {
  return Object.assign({}, ...Object.values(app.data));
}

/* ── the writes ───────────────────────────────────────────────────────────────
   These live here rather than in the server action so the verifier can walk a
   whole journey without a browser. The action layer above is validation and a
   redirect; every row that gets written is written from this file.            */

export function event(appId: number, type: string, payload: object): void {
  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'application', ?, ?, ?, 'client_app')`,
  ).run(TODAY, String(appId), String(appId), type, JSON.stringify(payload));
}

export function startApplication(name: string, mobile: string, code: string):
  { ok: true; appId: number; broker: BrokerRef } | { ok: false; reason: string } {
  const broker = resolveBroker(code);
  if (!broker.ok) return broker;

  const lead = db().prepare(
    `INSERT INTO leads (source, sb_id, name, mobile, consent_state, stage, created_at)
     VALUES (?, ?, ?, ?, 'granted', 'onboarding', ?)`,
  ).run(code.trim() ? 'link' : 'manual', broker.broker.sb_id, name, mobile, TODAY);

  const app = db().prepare(
    `INSERT INTO onboarding_applications (lead_id, sb_id, channel, holding_type, started_at)
     VALUES (?, ?, 'digital', 'Single', ?)`,
  ).run(Number(lead.lastInsertRowid), broker.broker.sb_id, TODAY);

  const appId = Number(app.lastInsertRowid);
  event(appId, 'stage_lead', { source: code.trim() ? 'invite' : 'self', broker: broker.broker.code, name, mobile });
  return { ok: true, appId, broker: broker.broker };
}

/** One completed step. Returns the step the application is on afterwards. */
export function recordStep(appId: number, step: Step, payload: Record<string, string>, carried?: Journey | null): Step | null {
  const before = application(appId, carried);
  if (!before || before.step !== step) return before?.step ?? null;

  event(appId, DONE(step), payload);

  if (step === 'pan') {
    const verdict = kycFor(payload.pan);
    const validated = verdict.branch === 'validated';
    const internal = validated ? KRA.internal.verified : KRA.internal.pending;
    const kra = validated ? KRA.verified : KRA.pending;
    const log = db().prepare(
      `INSERT INTO client_kyc_logs (name, mobile_no, pan_no, dob, status, kra_status, kra_status_code, kyc_type, is_digio, entry_date)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(payload.name, payload.pan, payload.dob, internal, kra, verdict.code ?? KRA.clean, KRA.type.digital, TODAY);
    db().prepare(
      `UPDATE onboarding_applications SET kyc_log_id = ?, kyc_status = ?, kra_status = ? WHERE application_id = ?`,
    ).run(Number(log.lastInsertRowid), internal, kra, appId);
    event(appId, 'stage_kyc', { branch: verdict.branch, code: verdict.code });
  }

  // The step just written is in the database on this instance, so it is visible
  // to the re-read without being carried; anything from an earlier instance is not.
  const after = application(appId, carried);
  if (after?.step === 'waiting') finishApplication(appId, carried);
  return application(appId, carried)?.step ?? null;
}

/**
 * Files the application and creates the client. The broker tag is written in all
 * three places the rest of the app reads it from — the client row, the mapping
 * table and the login row — because a client present in one and absent from the
 * others is invisible to their own adviser while every total still balances.
 *
 * ponytail: the exchange leg is a seam. A real UCC comes back from BSE StarMF
 * minutes to hours later; here it is allotted at once and labelled as such.
 */
export function finishApplication(appId: number, carried?: Journey | null): number | null {
  const app = application(appId, carried);
  if (!app || app.client_id) return null;
  const d = captured(app);
  if (!d.pan || !d.name) return null;

  // The same PAN cannot open a second account. Without this, a double submit —
  // or the same journey replayed on a second instance — mints a twin: two client
  // rows for one person, and every total still balances.
  const already = db().prepare(`SELECT cm_user_id id FROM client_master WHERE cm_pan_no = ?`)
    .get(d.pan) as { id: number } | undefined;
  if (already) {
    close(appId, already.id, app.sb_id, app.lead_id);
    return already.id;
  }

  const next = (db().prepare(`SELECT COALESCE(MAX(cm_user_id), 0) + 1 n FROM client_master`).get() as { n: number }).n;
  const parts = d.name.trim().split(/\s+/);

  db().prepare(
    `INSERT INTO client_master
      (cm_user_id, cm_full_name, cm_first_name, cm_last_name, cm_pan_no, cm_date_of_birth,
       cm_mobile_number, fk_primary_sub_broker_id, is_active, is_client_prospect,
       is_kyc_done, is_fatca_done, is_client_app, created_date)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, 0, 1, ?, 1, ?)`,
  ).run(next, d.name, parts[0], parts.slice(1).join(' ') || parts[0], d.pan, d.dob,
    app.sb_id, d.fatca === '1' ? 1 : 0, TODAY);

  db().prepare(
    `INSERT OR IGNORE INTO client_sub_broker_mapping (cm_user_id, sb_id, is_primary, created_date)
     VALUES (?, ?, 1, ?)`,
  ).run(next, app.sb_id, TODAY);

  db().prepare(
    `INSERT INTO client_login_master (fk_cm_user_id, clm_pan_no, is_kyc, fk_sb_id, last_login_at)
     VALUES (?, ?, 1, ?, ?)`,
  ).run(next, d.pan, app.sb_id, TODAY);

  const ucc = `MKYC${String(next).padStart(6, '0')}`;
  db().prepare(
    `INSERT OR IGNORE INTO bse_client_master (bse_client_id, ucc_status, holding_pattern, first_applicant, pan_no, kyc_type)
     VALUES (?, 'ACTIVE', 'SI', ?, ?, 'K')`,
  ).run(ucc, d.name, d.pan);

  // The account is what actually holds money — a client row without one cannot own
  // a folio or carry a transaction. `acc_id` deliberately equals the client id: every
  // query in this codebase joins `transaction_master.fk_acc_id` straight to a client,
  // and a new client numbered differently would simply have no history anywhere.
  db().prepare(
    `INSERT OR IGNORE INTO accounts_master (acc_id, fk_cm_user_id, acc_name, acc_bse_code, acc_activation_date, is_active, is_prospect)
     VALUES (?, ?, ?, ?, ?, 1, 0)`,
  ).run(next, next, d.name, ucc, TODAY);

  close(appId, next, app.sb_id, app.lead_id);
  return next;
}

/** The UCC the exchange allots. One spelling, used by both paths through `finishApplication`. */
const uccFor = (clientId: number) => `MKYC${String(clientId).padStart(6, '0')}`;

/**
 * The last four rows of a journey: the application points at its client, the lead
 * is converted, and the terminal events are appended. Split out because the
 * duplicate-PAN path has to close the journey too — a client who exists but whose
 * application never reaches `live` leaves the joiner staring at "with the regulator".
 */
function close(appId: number, clientId: number, sbId: number, leadId: number | null): void {
  db().prepare(
    `UPDATE onboarding_applications
     SET client_id = ?, ucc_status = 'ACTIVE', bse_status = 'Registered', completed_at = ?
     WHERE application_id = ?`,
  ).run(clientId, TODAY, appId);

  if (leadId != null) {
    db().prepare(`UPDATE leads SET stage = 'converted', converted_client_id = ? WHERE lead_id = ?`)
      .run(clientId, leadId);
  }

  const ucc = uccFor(clientId);
  event(appId, 'stage_ucc', { ucc });
  event(appId, 'stage_live', { client_id: clientId, sb_id: sbId });
  event(appId, DONE('waiting'), {});
  event(appId, DONE('live'), { client_id: String(clientId), ucc });
}

/** The assisted route. Paper has no e-signature step of its own — `stepsFor` drops it. */
export function setPaper(appId: number): void {
  db().prepare(`UPDATE onboarding_applications SET channel = 'offline' WHERE application_id = ?`).run(appId);
  event(appId, 'channel_offline', { reason: 'client asked for the assisted route' });
}
