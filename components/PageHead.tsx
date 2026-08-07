import { dmy } from '../lib/format';
import { TODAY } from '../mockdb/engines';
import { Icon } from './Icon';

// One header for every page: the short name, the question the page exists to
// answer, and when the data underneath it was last true.
export function PageHead({ title, question, meta, icon }: {
  title: string; question: string; meta?: string; icon?: string;
}) {
  return (
    <>
      <div className="pagehead">
        <h1>{icon && <Icon name={icon} />} {title}</h1>
        <span className="fresh">{meta ?? `as of ${dmy(TODAY)}`}</span>
      </div>
      <p className="askq">{question}</p>
    </>
  );
}
