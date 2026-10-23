/** A screen that another work package has not delivered yet (docs/design/m8-client.md "Work packages"). */
import type { ReactNode } from 'react';
import { ScreenHeader } from './ScreenHeader';

export function Placeholder({ title, owner, children }: { title: string; owner: string; children?: ReactNode }) {
  return (
    <div className="screen">
      <ScreenHeader title={title} />
      <div className="placeholder" role="status">
        <p>
          This screen is not built yet (work package {owner}).
        </p>
        {children}
      </div>
    </div>
  );
}
