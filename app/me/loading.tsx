// Shown while the server is still counting. research/14 §10.14 lists sub-second
// tab switches as table stakes, and 13-APP-BASELINE calls the current Jhaveri app
// "waiting punctuated by data" — so the wait has a shape instead of a blank.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Counting your money">
      {[68, 44, 92].map((_, card) => (
        <div className="f-skel" key={card}>
          {[40, 85, 60].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}
        </div>
      ))}
    </div>
  );
}
