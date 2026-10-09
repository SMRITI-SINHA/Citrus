import knexFactory, { type Knex } from 'knex';
import { config } from '../config.ts';

// One query layer for Postgres (local/CI) and Oracle 12c (CITRUS server). Queries stay inside what both support:
// no RETURNING-dependent logic, no JSON operators, row locks via forUpdate()/skipLocked().
export function makeDb(url = config.databaseUrl): Knex {
  if (config.dbClient === 'oracledb') {
    return knexFactory({
      client: 'oracledb',
      connection: { user: config.oracle.user, password: config.oracle.password, connectString: config.oracle.connectString },
      pool: { min: 2, max: 20 },
      fetchAsString: ['number', 'clob'],
    });
  }
  return knexFactory({ client: 'pg', connection: url, pool: { min: 2, max: 20 } });
}
export const db = makeDb();
