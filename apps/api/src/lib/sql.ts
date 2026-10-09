// The few SQL fragments that differ between Postgres and Oracle 12c.
import { config } from '../config.ts';
const ora = () => config.dbClient === 'oracledb';
export const sqlDay = (col: string) => (ora() ? `trunc(${col})` : `date(${col})`);
export const sqlSecondsBetween = (later: string, earlier: string) =>
  ora() ? `((cast(${later} as date) - cast(${earlier} as date)) * 86400)` : `extract(epoch from (${later} - ${earlier}))`;
