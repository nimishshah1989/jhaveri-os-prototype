import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../components/Icon';
import { dmy } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { application, captured, stepsFor, STEPS, type Application, type Step } from '../../../lib/join';
import { advance, switchToPaper } from '../actions';

export const dynamic = 'force-dynamic';

interface Refusal { field: string; says: string }

/** A refusal is printed against the field that caused it, never as a banner. */
function refusalsFrom(e: string | undefined): Map<string, string> {
  if (!e) return new Map();
  try {
    const list = JSON.parse(e) as Refusal[];
    return new Map(list.map(r => [r.field, r.says]));
  } catch {
    return new Map();
  }
}

function Field({ name, label, hint, bad, children }: {
  name: string; label: string; hint?: string; bad?: string; children: React.ReactNode;
}) {
  return (
    <div className={`f-field${bad ? ' bad' : ''}`}>
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && !bad && <span className="hint">{hint}</span>}
      {bad && <span className="says">{bad}</span>}
    </div>
  );
}

function Pick({ name, options, bad, value }: {
  name: string; options: [string, string][]; bad?: string; value?: string;
}) {
  return (
    <div className={`f-field${bad ? ' bad' : ''}`}>
      <div className="f-pick">
        {options.map(([v, label]) => (
          <label key={v}>
            <input type="radio" name={name} value={v} defaultChecked={value === v} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {bad && <span className="says">{bad}</span>}
    </div>
  );
}

/* ── the rail ─────────────────────────────────────────────────────────────── */

function Rail({ app }: { app: Application }) {
  const order: Step[] = stepsFor(app.channel, app.kyc).filter(s => s !== 'live');
  const at = order.indexOf(app.step);
  const here = STEPS.find(s => s.key === app.step);
  return (
    <>
      <div className="f-rail" aria-hidden="true">
        {order.map((s, i) => (
          <i key={s} className={i < at ? 'done' : i === at ? 'now' : ''} />
        ))}
      </div>
      <div className="f-railtext">
        <span>{here?.label}</span>
        <span>{Math.max(at + 1, 1)} of {order.length}</span>
      </div>
    </>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export default async function JoinStep({ params, searchParams }: PageProps<'/join/[id]'>) {
  const { id } = await params;
  const q = await searchParams;
  const app = application(Number(id));
  if (!app) notFound();

  const bad = refusalsFrom(typeof q.e === 'string' ? q.e : undefined);
  const had = captured(app);
  const here = STEPS.find(s => s.key === app.step)!;

  return (
    <>
      <Rail app={app} />
      <p className="f-hello" style={{ fontSize: 22 }}>{here.label}</p>
      <p className="f-note" style={{ margin: '0 2px 14px' }}>{here.blurb}</p>

      {app.step === 'pan' && (
        <form action={advance}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <input type="hidden" name="step" value="pan" />
          <div className="f-card">
            <div className="f-fields">
              <Field name="pan" label="PAN" bad={bad.get('pan')}
                hint="We check this against the KRA before asking you for anything else.">
                <input id="pan" name="pan" type="text" defaultValue={had.pan ?? ''} maxLength={10}
                  placeholder="ABCDE1234F" autoComplete="off" required />
              </Field>
              <Field name="name" label="Name on the card" bad={bad.get('name')}>
                <input id="name" name="name" type="text" defaultValue={had.name ?? ''} required />
              </Field>
              <Field name="dob" label="Date of birth" bad={bad.get('dob')}>
                <input id="dob" name="dob" type="date" defaultValue={had.dob ?? ''} max={TODAY} required />
              </Field>
            </div>
            <button className="f-btn" type="submit">Check with the KRA <Icon name="chev" /></button>
          </div>
        </form>
      )}

      {app.step === 'kyc' && app.kyc && (
        <form action={advance}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <input type="hidden" name="step" value="kyc" />

          <div className={`f-card f-act${app.kyc.branch === 'lapsed' ? ' urgent' : ''}`}>
            <div className="f-k">
              <Icon name={app.kyc.branch === 'lapsed' ? 'alert' : 'info'} />
              {app.kyc.branch === 'lapsed' ? 'What the KRA sent back' : 'Your first account'}
              {app.kyc.code && <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>{app.kyc.code}</span>}
            </div>
            <div className="s" style={{ marginTop: 8 }}>{app.kyc.plain}</div>
            <div className="t" style={{ marginTop: 10, fontSize: 13.5 }}>{app.kyc.ask}</div>
            {app.kyc.unphrased && (
              <p className="f-note" style={{ marginTop: 10 }}>
                That is the regulator&rsquo;s own wording. We have not written a plainer sentence
                for this code yet, and we would rather show you theirs than guess at it.
              </p>
            )}
          </div>

          <div className="f-card">
            <div className="f-fields">
              <div className="f-field">
                <label htmlFor="identity_source">Where we take your identity from</label>
                <div className="f-pick">
                  {[['digilocker', 'DigiLocker'], ['aadhaar', 'Aadhaar OTP'], ['upload', 'Upload documents']].map(([v, l]) => (
                    <label key={v}>
                      <input type="radio" name="identity_source" value={v} defaultChecked={v === 'digilocker'} />
                      <span>{l}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="f-declare">
                <input type="checkbox" name="photo" value="1" defaultChecked />
                <span>I have taken the live photograph. <b>SEBI calls this in-person verification</b> — it must be you, now, not a stored picture.</span>
              </label>
              <label className="f-declare">
                <input type="checkbox" name="signature" value="1" defaultChecked />
                <span>I have captured my signature the way I sign at my bank.</span>
              </label>
            </div>
            <div className="f-seam">
              <Icon name="info" />
              <span><b>Seam.</b> DigiLocker, the Aadhaar OTP and the photograph are third-party
                journeys in the live build. This prototype records that they happened, and stops
                short of pretending to be them.</span>
            </div>
            <button className="f-btn" type="submit" style={{ marginTop: 12 }}>Done <Icon name="chev" /></button>
          </div>
        </form>
      )}

      {app.step === 'bank' && (
        <form action={advance}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <input type="hidden" name="step" value="bank" />
          <div className="f-card">
            <div className="f-fields">
              <Field name="account" label="Account number" bad={bad.get('account')}
                hint="It must be in your own name. Money only ever returns to this account.">
                <input id="account" name="account" type="text" inputMode="numeric" className="num"
                  defaultValue={had.account ?? ''} maxLength={18} autoComplete="off" required />
              </Field>
              <Field name="ifsc" label="IFSC" bad={bad.get('ifsc')}>
                <input id="ifsc" name="ifsc" type="text" defaultValue={had.ifsc ?? ''} maxLength={11}
                  placeholder="HDFC0001234" autoComplete="off" required />
              </Field>
              <Field name="bank_name" label="Bank" bad={bad.get('bank_name')}>
                <input id="bank_name" name="bank_name" type="text" defaultValue={had.bank_name ?? ''} />
              </Field>
            </div>
            <div className="f-seam">
              <Icon name="info" />
              <span><b>Seam.</b> The live build sends one rupee to this account and asks you to
                confirm the amount — that is how the name is proved to be yours.</span>
            </div>
            <button className="f-btn" type="submit" style={{ marginTop: 12 }}>Continue <Icon name="chev" /></button>
          </div>
        </form>
      )}

      {app.step === 'nominee' && (
        <form action={advance}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <input type="hidden" name="step" value="nominee" />
          <div className="f-card">
            <div className="f-fields">
              <Field name="nominee_name" label="Nominee's full name" bad={bad.get('nominee_name')}>
                <input id="nominee_name" name="nominee_name" type="text" defaultValue={had.nominee_name ?? ''} />
              </Field>
              <Field name="relation" label="Their relationship to you" bad={bad.get('relation')}>
                <select id="relation" name="relation" defaultValue={had.relation ?? ''}>
                  <option value="">Choose one</option>
                  {['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <label className="f-declare">
                <input type="checkbox" name="declined" value="1" />
                <span>I do not wish to nominate anyone. <b>I understand my family will need a court
                  order to claim this money</b>, and that I can add a nominee at any time.</span>
              </label>
            </div>
            <button className="f-btn" type="submit">Continue <Icon name="chev" /></button>
          </div>
          <p className="f-note">
            There is no third option. SEBI requires either a nominee or a written refusal, and the
            refusal is the one that costs your family months.
          </p>
        </form>
      )}

      {app.step === 'profile' && (
        <form action={advance}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <input type="hidden" name="step" value="profile" />
          <div className="f-card">
            <div className="f-k">When might you need this money?</div>
            <Pick name="horizon" value={had.horizon} bad={bad.get('horizon')} options={[
              ['short', 'Within 3 years'], ['medium', '3 to 7 years'], ['long', 'Longer than that'],
            ]} />

            <div className="f-k" style={{ marginTop: 14 }}>It falls 20% in a month. You&hellip;</div>
            <Pick name="fall" value={had.fall} bad={bad.get('fall')} options={[
              ['sell', 'Get out'], ['wait', 'Sit still'], ['buy', 'Buy more'],
            ]} />

            <div className="f-k" style={{ marginTop: 14 }}>What is it for?</div>
            <Pick name="purpose" value={had.purpose} bad={bad.get('purpose')} options={[
              ['grow', 'Growing it'], ['income', 'Income from it'], ['park', 'Parking it safely'],
            ]} />

            <label className="f-declare" style={{ marginTop: 14 }}>
              <input type="checkbox" name="fatca" value="1" defaultChecked={had.fatca === '1'} />
              <span>I am an Indian resident for tax, and I pay tax in no other country.
                <b> This is the FATCA declaration</b>, and it has to be true.</span>
            </label>
            {bad.get('fatca') && <span className="says">{bad.get('fatca')}</span>}

            <button className="f-btn" type="submit" style={{ marginTop: 14 }}>Continue <Icon name="chev" /></button>
          </div>
          <p className="f-note">
            These three answers shape what the app shows you. They are not a recommendation, and
            nothing is sold to you off the back of them.
          </p>
        </form>
      )}

      {app.step === 'sign' && (
        <form action={advance}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <input type="hidden" name="step" value="sign" />
          <input type="hidden" name="digio_request_id" value={`DIGIO-${app.application_id}`} />
          <div className="f-card">
            <div className="f-seam">
              <Icon name="info" />
              <span><b>Seam — DigiO.</b> The live build hands you to DigiO for an Aadhaar e-signature
                and takes back a signed document reference. Ticking this stands in for that return trip.</span>
            </div>
            <label className="f-declare" style={{ marginTop: 12 }}>
              <input type="checkbox" name="signed" value="1" defaultChecked />
              <span>I have signed the account opening form electronically.</span>
            </label>
            {bad.get('signed') && <span className="says">{bad.get('signed')}</span>}
            <button className="f-btn" type="submit" style={{ marginTop: 12 }}>File my application <Icon name="chev" /></button>
          </div>
        </form>
      )}

      {(app.step === 'waiting' || app.step === 'live') && <Filed app={app} />}

      {app.step !== 'live' && (
        <form action={switchToPaper}>
          <input type="hidden" name="application_id" value={app.application_id} />
          <p className="f-note" style={{ marginBottom: 6 }}>
            Would you rather someone did this with you? {app.broker} can fill the form and bring it
            to you to sign. Nothing you have entered is lost.
          </p>
          <button className="f-btn ghost" type="submit" style={{ width: 'auto' }}>
            <Icon name="chat" /> Ask for the assisted route
          </button>
        </form>
      )}
    </>
  );
}

/* ── filed: the status window, which is the whole point of the paper path ─── */

function Filed({ app }: { app: Application }) {
  const live = app.step === 'live';
  const ucc = app.data.live?.ucc ?? null;
  const stages: [string, string, boolean][] = [
    ['Your details', 'Captured and checked', true],
    ['KYC', app.kyc?.branch === 'validated' ? 'Carried over from the KRA' : 'Filed with the KRA', true],
    ...(app.channel === 'offline'
      ? []
      : [['e-signature', 'Signed and attached', app.done.includes('sign')] as [string, string, boolean]]),
    ['Exchange code', live ? `Allotted — ${ucc}` : 'Waiting on BSE StarMF', live],
  ];

  return (
    <>
      <div className="f-card">
        <div className="f-k"><Icon name={live ? 'shield' : 'clock'} /> {live ? 'Open' : 'With the regulator'}</div>
        {stages.map(([label, detail, done]) => (
          <div className="f-step" key={label}>
            <span style={{ color: done ? 'var(--f-ink)' : 'var(--f-faint)' }}>
              <Icon name={done ? 'shield' : 'clock'} /> {label} — {detail}
            </span>
            <b style={{ color: done ? 'var(--f-pos)' : 'var(--f-faint)' }}>{done ? 'Done' : 'Waiting'}</b>
          </div>
        ))}
        <p className="f-note" style={{ marginTop: 10 }}>
          Started {dmy(TODAY)} · {app.channel === 'offline' ? 'Assisted, on paper' : 'Filed from the app'} ·
          Your adviser is {app.broker}
        </p>
      </div>

      {app.channel === 'offline' && !live && (
        <p className="f-note">
          On the assisted route there is no exchange authentication step at all — the file clears
          when the KRA verifies it. If anything is needed from you, this page will say so in
          plain words rather than a code.
        </p>
      )}

      {live && (
        <Link href="/me" className="f-card tap">
          <div className="f-k"><Icon name="bank" /> Your account is open</div>
          <div className="t" style={{ fontSize: 15 }}>Put the first instalment in</div>
          <div className="s">Nothing here is worth reading until there is money behind it.</div>
          <span className="f-cardlink">Go to your Folio <Icon name="chev" /></span>
        </Link>
      )}
    </>
  );
}
