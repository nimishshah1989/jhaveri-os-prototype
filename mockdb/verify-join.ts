/**
 * verify-join — the client's own way in, walked end to end.
 *
 * Unlike the other verifiers this one WRITES: a journey that is never taken proves
 * nothing. Everything happens inside a transaction that is rolled back at the end,
 * so the database it leaves behind is byte-identical to the one it found. If this
 * file ever leaves rows behind, every count assertion in the other ten verifiers
 * starts drifting.
 *
 * House rule kept: each assertion re-derives its answer with SQL written here,
 * never by calling the function under test a second time.
 *
 * Run: npx tsx mockdb/verify-join.ts   (joined to `npm run verify:all`)
 */
import { db } from '../lib/db';
import {
  application, captured, finishApplication, kycFor, recordStep, resolveBroker,
  setPaper, startApplication, stepsFor, unphrasedJoinCodes, type Step,
} from '../lib/join';
import { open, seal } from '../lib/journey';

const conn = db();
let pass = 0;
const fails: string[] = [];

function assert(name: string, cond: boolean, why = ''): void {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${why ? ` — ${why}` : ''}`); }
}
function check(name: string, got: unknown, want: unknown): void {
  assert(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
const one = <T>(sql: string, ...p: unknown[]): T => conn.prepare(sql).get(...p) as T;

console.log('\nverify-join — joining, walked end to end\n');
conn.exec('BEGIN');

try {
  /* ── the adviser code is a money field ─────────────────────────────────── */

  const real = one<{ code: string; sb_id: number; name: string }>(
    `SELECT sb_sub_broker_code code, sb_id, sb_holder_name name
     FROM sub_broker_master WHERE is_active = 1 AND sb_sub_broker_code IS NOT NULL LIMIT 1`);

  const good = resolveBroker(real.code);
  assert('a live adviser code resolves to that adviser', good.ok && good.broker.sb_id === real.sb_id);

  const nonsense = resolveBroker('ZZZZ9999');
  assert('an unknown code is refused, not ignored', !nonsense.ok);
  assert('the refusal names the code so the client can check it',
    !nonsense.ok && nonsense.reason.includes('ZZZZ9999'));
  check('an unknown code writes nothing',
    one<{ n: number }>(`SELECT COUNT(*) n FROM leads WHERE mobile = '9000000001'`).n, 0);

  const blank = resolveBroker('');
  assert('a blank code lands on the house desk, never untagged', blank.ok && blank.broker.code === 'HOUSE');
  check('the house desk exists exactly once',
    one<{ n: number }>(`SELECT COUNT(*) n FROM sub_broker_master WHERE sb_sub_broker_code = 'HOUSE'`).n, 1);
  resolveBroker('');
  check('resolving a blank code twice does not create a second house desk',
    one<{ n: number }>(`SELECT COUNT(*) n FROM sub_broker_master WHERE sb_sub_broker_code = 'HOUSE'`).n, 1);

  /* ── a whole digital journey ───────────────────────────────────────────── */

  const started = startApplication('Anaya Verma', '9000000002', real.code);
  assert('starting an application succeeds', started.ok);
  if (!started.ok) throw new Error('cannot continue without an application');
  const appId = started.appId;

  const lead = one<{ n: number; sb: number }>(
    `SELECT COUNT(*) n, MAX(sb_id) sb FROM leads WHERE mobile = '9000000002'`);
  check('the journey opens a lead', lead.n, 1);
  check('the lead carries the adviser from the code', lead.sb, real.sb_id);

  check('a fresh application starts at the PAN step', application(appId)!.step, 'pan');

  // A PAN the KRA has never seen: the longest journey, and the default for a new investor.
  const PAN_NEW = 'AAAAA1111A';
  check('an unknown PAN is a first-time KYC', kycFor(PAN_NEW).branch, 'none');
  assert('the first-time sentence is written policy, not a code', kycFor(PAN_NEW).plain.length > 40);

  recordStep(appId, 'pan', { pan: PAN_NEW, name: 'Anaya Verma', dob: '1991-04-17' });
  check('after the PAN, the documents step is next', application(appId)!.step, 'kyc');

  const kycRow = one<{ n: number; kra: string; status: string }>(
    `SELECT COUNT(*) n, MAX(kra_status) kra, MAX(status) status FROM client_kyc_logs WHERE pan_no = ?`, PAN_NEW);
  check('a KYC log is filed against the PAN', kycRow.n, 1);
  // The vocabulary has to be the seed's own, or the same client reads verified on
  // one lens and pending on the other.
  check('a first-time KYC is filed as pending, never as verified', kycRow.kra, 'Under Process');
  check('and in the words every other row already uses', kycRow.status, 'PENDING');
  check('no status is invented that the database has never seen',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM client_kyc_logs WHERE kra_status NOT IN ('KRA Verified','KRA Rejected','Under Process')`).n, 0);
  check('nor on the application row',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM onboarding_applications WHERE kra_status IS NOT NULL
       AND kra_status NOT IN ('KRA Verified','KRA Rejected','Under Process')`).n, 0);

  // A forged or replayed form must not rewrite a step that is already behind us.
  recordStep(appId, 'pan', { pan: 'BBBBB2222B', name: 'Someone Else', dob: '1980-01-01' });
  check('replaying a completed step changes nothing', captured(application(appId)!).pan, PAN_NEW);
  check('and files no second KYC log',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_kyc_logs WHERE pan_no = 'BBBBB2222B'`).n, 0);

  // Resumption is not a feature here, it is the shape: the step is derived, never stored.
  check('a resumed application restores to the step it left', application(appId)!.step, 'kyc');

  recordStep(appId, 'kyc', { identity_source: 'digilocker', photo: '1', signature: '1' });
  check('documents lead to the bank step', application(appId)!.step, 'bank');

  recordStep(appId, 'bank', { account: '004701538291', ifsc: 'HDFC0000047', bank_name: 'HDFC Bank' });
  check('the bank leads to the nominee step', application(appId)!.step, 'nominee');

  recordStep(appId, 'nominee', { declined: '1' });
  check('a declined nomination still moves on', application(appId)!.step, 'profile');
  check('the declaration is kept, not discarded', captured(application(appId)!).declined, '1');

  recordStep(appId, 'profile', { horizon: 'long', fall: 'wait', purpose: 'grow', fatca: '1' });
  check('the profile leads to the signature', application(appId)!.step, 'sign');

  recordStep(appId, 'sign', { signed: '1', digio_request_id: `DIGIO-${appId}` });
  check('signing opens the account', application(appId)!.step, 'live');

  /* ── nobody joins untagged ─────────────────────────────────────────────── */

  const made = one<{ id: number; sb: number; kyc: number; fatca: number }>(
    `SELECT cm_user_id id, fk_primary_sub_broker_id sb, is_kyc_done kyc, is_fatca_done fatca
     FROM client_master WHERE cm_pan_no = ?`, PAN_NEW);
  assert('a client row exists at the end of the journey', made != null);
  check('the client carries the adviser from the code they typed', made.sb, real.sb_id);
  check('the FATCA declaration is recorded as given', made.fatca, 1);

  check('the client is tagged in the mapping table too',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM client_sub_broker_mapping WHERE cm_user_id = ? AND sb_id = ? AND is_primary = 1`,
      made.id, real.sb_id).n, 1);
  check('and on the login row, so all three agree',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_login_master WHERE fk_cm_user_id = ? AND fk_sb_id = ?`,
      made.id, real.sb_id).n, 1);
  check('the client is tagged to exactly one adviser',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_sub_broker_mapping WHERE cm_user_id = ?`, made.id).n, 1);
  check('and appears in no other adviser\'s book',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_sub_broker_mapping WHERE cm_user_id = ? AND sb_id != ?`,
      made.id, real.sb_id).n, 0);

  const ucc = one<{ n: number; status: string }>(
    `SELECT COUNT(*) n, MAX(ucc_status) status FROM bse_client_master WHERE pan_no = ?`, PAN_NEW);
  check('an exchange code is allotted', ucc.n, 1);
  check('and it is active', ucc.status, 'ACTIVE');

  // Without this row the client exists but can hold nothing: every holding and
  // transaction in the codebase hangs off an account, keyed to the client id.
  const acct = one<{ n: number; acc: number; code: string }>(
    `SELECT COUNT(*) n, MAX(acc_id) acc, MAX(acc_bse_code) code FROM accounts_master WHERE fk_cm_user_id = ?`, made.id);
  check('the client gets an account that can hold money', acct.n, 1);
  check('and its id is the client id, the way every query in this codebase assumes', acct.acc, made.id);
  check('the account carries the exchange code', acct.code, `MKYC${String(made.id).padStart(6, '0')}`);

  check('the lead is closed as converted',
    one<{ stage: string; cid: number }>(`SELECT stage, converted_client_id cid FROM leads WHERE mobile = '9000000002'`).stage,
    'converted');
  check('the application names the client it produced',
    one<{ cid: number }>(`SELECT client_id cid FROM onboarding_applications WHERE application_id = ?`, appId).cid,
    made.id);
  assert('finishing twice creates no second client', finishApplication(appId) === null);
  check('and there is still exactly one client on that PAN',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_master WHERE cm_pan_no = ?`, PAN_NEW).n, 1);

  /* ── the carried-over KYC path is genuinely shorter ────────────────────── */

  const held = one<{ pan: string }>(
    `SELECT pan_no pan FROM client_kyc_logs
     WHERE kra_status = 'KRA Verified' AND (kra_status_code IS NULL OR kra_status_code = 'ERR-00000')
     AND pan_no IS NOT NULL LIMIT 1`);
  if (held) {
    check('a PAN the KRA has already verified is carried over', kycFor(held.pan).branch, 'validated');
    const shorter = stepsFor('digital', kycFor(held.pan));
    assert('a carried-over KYC skips the documents step', !shorter.includes('kyc'));
    assert('and asks for nothing', kycFor(held.pan).ask.toLowerCase().startsWith('nothing'));
  } else {
    assert('a verified KYC exists in the seed to walk the carried-over path', false,
      'no VERIFIED kyc log with a clean code — the short path is untested');
  }

  /* ── offline is the base case ──────────────────────────────────────────── */

  const paper = startApplication('Mahesh Patel', '9000000003', '');
  if (!paper.ok) throw new Error('cannot start the paper application');
  setPaper(paper.appId);
  recordStep(paper.appId, 'pan', { pan: 'CCCCC3333C', name: 'Mahesh Patel', dob: '1975-09-02' });

  const paperSteps = stepsFor('offline', application(paper.appId)!.kyc);
  assert('the paper path has no e-signature step of its own', !paperSteps.includes('sign'));
  check('a paper application never emits a BSE e-log stage event',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM events WHERE subject_type='application' AND subject_id=? AND event_type LIKE '%elog%'`,
      String(paper.appId)).n, 0);
  check('a blank code puts the client on the house desk',
    one<{ code: string }>(
      `SELECT sb.sb_sub_broker_code code FROM onboarding_applications oa
       JOIN sub_broker_master sb ON sb.sb_id = oa.sb_id WHERE oa.application_id = ?`, paper.appId).code,
    'HOUSE');

  /* ── nothing is said to a client that we have not written ──────────────── */

  const unphrased = unphrasedJoinCodes();
  const shown = conn.prepare(
    `SELECT DISTINCT kra_status_code c FROM client_kyc_logs WHERE kra_status_code IS NOT NULL AND kra_status_code != 'ERR-00000'`,
  ).all() as { c: string }[];
  for (const { c } of shown) {
    const v = kycFor(one<{ pan: string }>(`SELECT pan_no pan FROM client_kyc_logs WHERE kra_status_code = ? LIMIT 1`, c).pan);
    assert(`${c} is either phrased plainly, or shown as the KRA's own words`,
      v.plain.length > 20 && (!unphrased.includes(c) || v.unphrased),
      'a code with no written sentence must say so, never be guessed at');
  }

  /* ── the journey survives losing the database it started on ─────────────
     On Vercel `lib/db.ts` gives every serverless instance its own scratch copy,
     so the rows a step wrote can be invisible to the request that serves the
     next one. This block reproduces exactly that: walk three steps, delete
     every row the journey wrote, and require the client to be able to carry on.
     Without `lib/journey.ts` the first assertion below passes and the second
     fails — which is the production bug, reproduced. */

  const car = startApplication('Carried Client', '9000000004', real.code);
  if (!car.ok) throw new Error('cannot continue without an application');
  const carId = car.appId;
  const CARRIED_PAN = 'BBBBB2222B';
  recordStep(carId, 'pan', { pan: CARRIED_PAN, name: 'Carried Client', dob: '1990-02-02' });
  const afterPan = application(carId)!;
  for (const s of afterPan.step === 'kyc' ? ['kyc'] as Step[] : [] as Step[]) {
    recordStep(carId, s, { identity_source: 'digilocker', photo: '1', signature: '1' });
  }
  recordStep(carId, 'bank', { account: '000111222333', ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' });

  // What the browser is holding, assembled the way `carry()` in the action does.
  const inHand = application(carId)!;
  const cookie = seal({
    id: inHand.application_id, sb: inHand.sb_id, br: inHand.broker, channel: inHand.channel,
    lead: inHand.lead_id, e: Object.entries(inHand.data) as [Step, Record<string, string>][],
  });

  // The next request lands on an instance that never saw any of this.
  conn.prepare(`DELETE FROM events WHERE subject_type='application' AND subject_id=?`).run(String(carId));
  conn.prepare(`DELETE FROM onboarding_applications WHERE application_id=?`).run(carId);
  conn.prepare(`DELETE FROM client_kyc_logs WHERE pan_no=?`).run(CARRIED_PAN);

  check('an application whose rows are on another instance is gone from this one',
    application(carId), null);

  const carried = open(cookie);
  assert('the sealed journey opens', carried != null && carried.id === carId);
  const restored = application(carId, carried)!;
  assert('and the journey is restored from what the browser carried', restored != null);
  check('to the exact step it left', restored.step, inHand.step);
  check('with the adviser it was tagged to', restored.sb_id, real.sb_id);
  check('and every field already captured', captured(restored), captured(inHand));

  assert('a tampered cookie is refused rather than trusted',
    open(cookie.slice(0, cookie.lastIndexOf('.')) + '.forged') === null,
    'the adviser code decides commission — an edited journey must not be honoured');
  const swapped = seal({ ...carried!, sb: real.sb_id + 1 });
  check('a re-signed journey for another application is not this one\'s state',
    application(carId + 99_000, open(swapped)), null);

  // …and the rest of the journey completes on the instance that has nothing.
  let at = restored.step;
  const fill: Record<string, Record<string, string>> = {
    nominee: { nominee_name: 'Vikram Verma', relation: 'Spouse' },
    profile: { horizon: 'long', fall: 'wait', purpose: 'grow', fatca: '1' },
    sign: { signed: '1', digio_request_id: `DIGIO-${carId}` },
    kyc: { identity_source: 'digilocker', photo: '1', signature: '1' },
    bank: { account: '000111222333', ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' },
  };
  let live: ReturnType<typeof application> = null;
  for (let guard = 0; guard < 8 && at !== 'live'; guard++) {
    recordStep(carId, at, fill[at] ?? {}, carried);
    live = application(carId, carried);
    if (!live) break;
    at = live.step;
  }
  check('the journey reaches open on an instance that never saw it start', at, 'live');
  check('and mints exactly one client for that PAN',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_master WHERE cm_pan_no = ?`, CARRIED_PAN).n, 1);
  check('tagged to the adviser the cookie carried, not the house desk',
    one<{ sb: number }>(`SELECT fk_primary_sub_broker_id sb FROM client_master WHERE cm_pan_no = ?`, CARRIED_PAN).sb,
    real.sb_id);

  // A double submit is the same race with a shorter fuse.
  finishApplication(carId, carried);
  check('filing the same journey twice does not mint a twin',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_master WHERE cm_pan_no = ?`, CARRIED_PAN).n, 1);

  /* ── every step is reachable, and the order never doubles back ─────────── */

  const order = stepsFor('digital', null);
  const seen = new Set<Step>();
  assert('no step appears twice in the journey', order.every(s => !seen.has(s) && seen.add(s)));
  assert('the journey ends open', order[order.length - 1] === 'live');
} finally {
  conn.exec('ROLLBACK');
}

const left = one<{ n: number }>(`SELECT COUNT(*) n FROM client_master WHERE cm_pan_no IN ('AAAAA1111A','CCCCC3333C')`).n;
assert('the verifier leaves the database exactly as it found it', left === 0,
  `${left} rows survived the rollback`);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
