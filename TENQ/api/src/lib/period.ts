import { isPastLocalTime, isWorkingDay, localDate, periodKey, type Frequency } from '@tenq/shared';

export interface FactoryTime { timezone: string; working_days: string }

/** 今日（工場のタイムゾーン）の点検期間。判定は shared の関数だけを使う */
export function todayFor(factory: FactoryTime, at = new Date()) {
  return {
    date: localDate(at, factory.timezone),
    keys: {
      daily: periodKey('daily', at, factory.timezone),
      weekly: periodKey('weekly', at, factory.timezone),
      monthly: periodKey('monthly', at, factory.timezone),
    } satisfies Record<Frequency, string>,
    workingDay: isWorkingDay(at, factory.timezone, factory.working_days),
    pastDeadline: (hhmm: string) => isPastLocalTime(at, factory.timezone, hhmm),
  };
}
