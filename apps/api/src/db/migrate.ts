import { db } from './knex.ts';
import { up, down } from './schema.ts';

const reset = process.argv.includes('--reset');
if (reset) {
  if (db.client.config.client === 'pg') await db.raw('drop schema public cascade; create schema public');
  else await down(db);
}
const exists = await db.schema.hasTable('distributors');
if (!exists) { await up(db); console.log('schema created'); } else console.log('schema already present (use --reset to recreate)');
await db.destroy();
