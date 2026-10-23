/**
 * The wait for room on a busy server (hosted design 4.6, 12; package M13-12): a table whose seats are all taken waits in the server's capacity queue
 * before its game starts. Its players see their place in line, the server's estimate and how long they have waited; running games always come first,
 * and a start that waits longer than the server allows (20 minutes by default) is sent back with "try again later" (the `capacityTimeout` notice).
 *
 * Shown by the waiting room (Room.tsx) for a table in `waitingCapacity`; Leave is the room's own button.
 */
import type { QueueStatus } from '@openmtg/hosted/api';
import { useState } from 'react';
import { useNow } from '../game/useNow';
import { capacityWait, elapsedText } from '../lobby/words';

export function CapacityWait({ queue, table }: { queue: QueueStatus | null; table: string }) {
  // when this page first saw the table wait (a reload starts the count again: the server's estimate is what matters)
  const [since] = useState(() => Date.now());
  const now = useNow(true, 1000);
  const status = queue?.kind === 'capacity' && queue.table === table ? queue : null;
  const wait = status ? capacityWait(status.estimatedWaitMs) : null;
  return (
    <div className="hosted-capacity" role="group" aria-label="Waiting for room on the server">
      <p role="status" className="hosted-status">
        The server is busy right now. Your game starts as soon as there is room
        {status ? (
          <>
            : you are number {status.position} in line{wait ? `, ${wait}` : ''}.
          </>
        ) : (
          '.'
        )}
      </p>
      <p className="hosted-note">
        Waiting for <span role="timer">{elapsedText(now - since)}</span>. Games already running always come first; if no room comes up in time, the server says
        so and you can try again later.
      </p>
    </div>
  );
}
