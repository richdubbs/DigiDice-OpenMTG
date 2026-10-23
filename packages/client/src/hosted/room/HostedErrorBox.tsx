/** An error of the hosted server in words (hosted/errors.ts): what went wrong, what to do, and any lines to list (a deck's problems). Sounds ui.error when it appears. */
import { useSfxOn } from '../../audio/useSfxOn';
import type { ExplainedHostedError } from '../errors';

export function HostedErrorBox({ error }: { error: ExplainedHostedError }) {
  useSfxOn('ui.error', error.message);
  return (
    <div className="hosted-error" role="alert">
      <p>
        <strong>{error.message}</strong>
        {error.hint ? ` ${error.hint}` : ''}
      </p>
      {error.details && error.details.length > 0 && (
        <ul>
          {error.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The server could not be reached. */
export function ConnectProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  useSfxOn('ui.error', message);
  return (
    <div className="hosted-error" role="alert">
      <p>
        <strong>The game server is not available right now.</strong> {message}
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
