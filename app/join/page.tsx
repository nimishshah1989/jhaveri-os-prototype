import { Icon } from '../../components/Icon';
import { start } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The front door. Self-signup is the primary path (founder, 12-Aug-2026), so a
 * stranger with a phone can get here and finish. The adviser code is offered but
 * never demanded — most people arriving this way will not have one, and the field
 * that decides who gets paid should not be the field that stops someone joining.
 */
export default async function Start({ searchParams }: PageProps<'/join'>) {
  const q = await searchParams;
  const refusal = typeof q.e === 'string' ? q.e : null;
  const code = typeof q.code === 'string' ? q.code : '';

  return (
    <>
      <p className="f-hello">Open your account.</p>
      <p className="f-note" style={{ margin: '0 2px 16px' }}>
        Ten minutes, once. Most of it is the regulator&rsquo;s form, and we fill in
        everything we are allowed to fill in for you.
      </p>

      <form action={start}>
        <div className="f-card">
          <div className="f-fields">
            <div className={`f-field${refusal ? ' bad' : ''}`}>
              <label htmlFor="name">Your name</label>
              <input id="name" name="name" type="text" autoComplete="name"
                placeholder="Exactly as it is printed on your PAN card" required />
              <span className="hint">If it differs from the card by even a letter, the KRA rejects the form.</span>
            </div>

            <div className={`f-field${refusal ? ' bad' : ''}`}>
              <label htmlFor="mobile">Mobile number</label>
              <input id="mobile" name="mobile" type="tel" inputMode="numeric" className="num"
                autoComplete="tel-national" placeholder="10 digits" maxLength={10} required />
            </div>

            <div className={`f-field${refusal && code ? ' bad' : ''}`}>
              <label htmlFor="code">Adviser code <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— optional</span></label>
              <input id="code" name="code" type="text" defaultValue={code} placeholder="Leave blank if you do not have one" />
              <span className="hint">
                If someone at Jhaveri or a partner introduced you, their code keeps you with them.
                Blank is fine — we will assign someone and tell you who.
              </span>
              {refusal && <span className="says">{refusal}</span>}
            </div>
          </div>

          <button className="f-btn" type="submit">Begin <Icon name="chev" /></button>
        </div>
      </form>

      <div className="f-card">
        <div className="f-k"><Icon name="info" /> What happens next</div>
        <div className="f-step"><span>We check what the KRA already holds for your PAN</span><b>1 min</b></div>
        <div className="f-step"><span>Documents, but only if they have nothing on file</span><b>5 min</b></div>
        <div className="f-step"><span>Bank account, nominee, and three questions about you</span><b>3 min</b></div>
        <div className="f-step"><span>One e-signature, then the exchange allots your code</span><b>1 min</b></div>
      </div>

      <p className="f-note">
        Your number is confirmed by a one-time code in the live build; this prototype
        skips that step rather than staging a fake one. Nothing you enter here is
        shown to anyone but you and the adviser you end up with.
      </p>
    </>
  );
}
