import '../me/folio.css';
import './join.css';

/**
 * The pre-client shell. Same house, same language, but no bottom tabs — a person
 * joining has no portfolio, no discovery and no desk to switch between, and
 * offering four dead tabs is how an onboarding flow starts leaking people.
 */
export default function JoinLayout({ children }: LayoutProps<'/join'>) {
  return (
    <div className="folio" data-theme="light">
      <div className="f-top">
        <span className="house">JHAVERI PRIVATE</span>
      </div>
      <div className="f-scroll">{children}</div>
    </div>
  );
}
