import type { IsoDate } from '@repo/domain';
import { addDaysIso } from '../../platform/time.ts';

/** Monday of the business week containing `on`. */
export const mondayOf = (on: IsoDate): IsoDate => {
  const weekday = new Date(`${on}T12:00:00Z`).getUTCDay();
  return addDaysIso(on, -((weekday + 6) % 7));
};
