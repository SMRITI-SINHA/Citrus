import type { Knex } from 'knex';

// Portable schema for Postgres and Oracle 12c. Text ids (UUIDs from the app), short varchar keys,
// integers for money in rupees (wholesale rates are whole rupees), timestamps, and text for small JSON blobs.
// Order tables are append-heavy and keyed by placed_at, ready for range partitioning on Oracle.
export async function up(k: Knex) {

  await k.schema.createTable('distributors', t => {
    t.string('id', 40).primary(); t.string('code', 20).notNullable().unique(); t.string('name', 120).notNullable();
    t.string('city', 60); t.string('state', 60); t.string('phone', 15); t.string('contact', 60);
  });
  await k.schema.createTable('retailers', t => {
    t.string('id', 40).primary(); t.string('code', 30).notNullable().unique(); t.string('store', 120).notNullable();
    t.string('owner', 80); t.string('city', 60); t.string('state', 60); t.string('gstin', 20); t.string('phone', 15).notNullable();
    t.string('distributor_id', 40).notNullable().references('distributors.id').index(); t.string('invite_token', 60).unique(); t.index(['state']);
    t.string('status', 20).notNullable().defaultTo('invited'); t.timestamp('activated_at'); t.integer('points').notNullable().defaultTo(0);
    t.string('ratio', 40); t.timestamp('consent_at'); t.integer('credit_limit'); t.integer('overdue_amount'); t.integer('overdue_days'); t.timestamp('credit_as_of'); t.string('grade', 2); t.boolean('wa_marketing_opt_in').notNullable().defaultTo(false);
  });
  await k.schema.createTable('users', t => {
    t.string('id', 40).primary(); t.string('role', 20).notNullable(); t.string('phone', 15).notNullable().unique(); t.string('name', 80);
    t.string('retailer_id', 40).references('retailers.id'); t.string('distributor_id', 40).references('distributors.id');
    t.timestamp('created_at').notNullable().defaultTo(k.fn.now()); t.timestamp('last_login_at');
  });
  await k.schema.createTable('otp_requests', t => {
    t.string('id', 40).primary(); t.string('phone', 15).notNullable().index(); t.string('code_hash', 128).notNullable();
    t.timestamp('expires_at').notNullable(); t.integer('attempts').notNullable().defaultTo(0); t.timestamp('consumed_at');
    t.timestamp('created_at').notNullable().defaultTo(k.fn.now()); t.string('ip', 64);
  });
  await k.schema.createTable('refresh_tokens', t => {
    t.string('id', 40).primary(); t.string('user_id', 40).notNullable().references('users.id').index(); t.string('family', 40).notNullable();
    t.string('token_hash', 128).notNullable().unique(); t.timestamp('expires_at').notNullable(); t.timestamp('revoked_at');
    t.timestamp('created_at').notNullable().defaultTo(k.fn.now()); t.string('user_agent', 200);
  });
  await k.schema.createTable('styles', t => {
    t.string('id', 20).primary(); t.string('name', 120).notNullable(); t.string('category', 20).notNullable(); t.string('kind', 20);
    t.string('fit', 30); t.string('pattern', 30); t.string('fabric', 80); t.integer('rate').notNullable(); t.integer('mrp').notNullable();
    t.integer('points').notNullable(); t.boolean('is_new').notNullable().defaultTo(false); t.integer('rank').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
  });
  await k.schema.createTable('style_colors', t => {
    t.string('style_id', 20).notNullable().references('styles.id'); t.string('color', 40).notNullable(); t.string('hex', 9).notNullable();
    t.integer('position').notNullable().defaultTo(0); t.primary(['style_id', 'color']);
  });
  // Our fast availability layer (near-live copy of Ginesys free stock). Not the authority: Ginesys reserves on SO creation.
  await k.schema.createTable('availability', t => {
    t.string('style_id', 20).notNullable(); t.string('color', 40).notNullable(); t.string('size', 8).notNullable();
    t.integer('available').notNullable().defaultTo(0); t.timestamp('updated_at').notNullable().defaultTo(k.fn.now());
    t.primary(['style_id', 'color', 'size']);
  });
  await k.schema.createTable('carts', t => {
    t.string('retailer_id', 40).primary().references('retailers.id'); t.string('note', 300); t.string('po', 40);
    t.integer('version').notNullable().defaultTo(0); t.timestamp('updated_at').notNullable().defaultTo(k.fn.now());
  });
  await k.schema.createTable('cart_lines', t => {
    t.string('retailer_id', 40).notNullable().references('retailers.id'); t.string('style_id', 20).notNullable();
    t.string('color', 40).notNullable(); t.string('size', 8).notNullable(); t.integer('qty').notNullable();
    t.integer('position').notNullable().defaultTo(0); t.primary(['retailer_id', 'style_id', 'color', 'size']);
  });
  await k.schema.createTable('orders', t => {
    t.string('id', 40).primary(); t.string('num', 20).notNullable().unique(); t.string('retailer_id', 40).notNullable().references('retailers.id');
    t.string('distributor_id', 40).notNullable().references('distributors.id'); t.string('status', 20).notNullable();
    t.string('idem_key', 80).notNullable(); t.unique(['retailer_id', 'idem_key']);
    t.string('note', 300); t.string('po', 40); t.string('reason', 200); t.string('change_reason', 200); t.text('changes_json');
    t.integer('total_qty').notNullable(); t.integer('total_value').notNullable(); t.integer('total_points').notNullable();
    t.string('erp_ref', 40); t.string('so_number', 40); t.string('erp_state', 20).notNullable().defaultTo('pending'); t.string('erp_status', 30);
    t.string('awb', 40); t.integer('erp_attempts').notNullable().defaultTo(0); t.string('erp_error', 300);
    t.timestamp('placed_at').notNullable(); t.timestamp('reserved_at'); t.timestamp('updated_at').notNullable(); t.timestamp('reminded_at'); t.boolean('points_awarded').notNullable().defaultTo(false);
    t.index(['distributor_id', 'status', 'placed_at']); t.index(['retailer_id', 'placed_at']); t.index(['status', 'updated_at']); t.index(['placed_at']); t.index(['erp_ref']);
  });
  await k.schema.createTable('order_lines', t => {
    t.string('order_id', 40).notNullable().references('orders.id'); t.string('style_id', 20).notNullable(); t.string('name', 120).notNullable();
    t.string('color', 40).notNullable(); t.string('size', 8).notNullable(); t.integer('qty').notNullable(); t.integer('orig_qty').notNullable();
    t.integer('rate').notNullable(); t.integer('points').notNullable(); t.integer('position').notNullable().defaultTo(0);
    t.primary(['order_id', 'style_id', 'color', 'size']); t.index(['style_id', 'order_id']);
  });
  await k.schema.createTable('order_events', t => {
    t.string('id', 40).primary(); t.string('order_id', 40).notNullable().references('orders.id').index(); t.timestamp('at').notNullable();
    t.string('type', 40).notNullable(); t.string('actor', 20).notNullable(); t.string('message', 400).notNullable();
  });
  // Transactional outbox: ERP calls and notifications are written in the same transaction as the state change.
  await k.schema.createTable('outbox', t => {
    t.string('id', 40).primary(); t.string('topic', 40).notNullable(); t.string('ref', 40).index(); t.text('payload').notNullable(); t.string('status', 12).notNullable().defaultTo('pending');
    t.integer('attempts').notNullable().defaultTo(0); t.timestamp('next_at').notNullable(); t.string('last_error', 300);
    t.timestamp('created_at').notNullable().defaultTo(k.fn.now()); t.timestamp('done_at'); t.string('request_id', 40); t.index(['status', 'next_at']);
  });
  await k.schema.createTable('notifications', t => {
    t.string('id', 40).primary(); t.string('channel', 12).notNullable(); t.string('to_phone', 15).notNullable(); t.string('template', 40).notNullable();
    t.text('body').notNullable(); t.string('order_id', 40).index(); t.string('status', 12).notNullable(); t.timestamp('created_at').notNullable().defaultTo(k.fn.now());
  });
  await k.schema.createTable('points_ledger', t => {
    t.string('id', 40).primary(); t.string('retailer_id', 40).notNullable().references('retailers.id').index(); t.integer('delta').notNullable();
    t.string('reason', 120).notNullable(); t.string('order_id', 40); t.timestamp('created_at').notNullable().defaultTo(k.fn.now());
    t.unique(['order_id', 'reason']);
  });
  await k.schema.createTable('exceptions', t => {
    t.string('id', 40).primary(); t.string('kind', 30).notNullable(); t.string('severity', 8).notNullable(); t.string('title', 120).notNullable();
    t.string('detail', 400).notNullable(); t.string('order_id', 40); t.timestamp('created_at').notNullable().defaultTo(k.fn.now()); t.timestamp('resolved_at');
    t.index(['resolved_at']);
  });
  // Inbox: inbound webhooks (WhatsApp button taps) stored first, de-duplicated on provider message id, processed async.
  await k.schema.createTable('inbox', t => {
    t.string('id', 120).primary(); t.string('source', 20).notNullable(); t.text('payload').notNullable(); t.string('status', 12).notNullable().defaultTo('pending');
    t.timestamp('created_at').notNullable().defaultTo(k.fn.now()); t.timestamp('done_at');
  });
  await k.schema.createTable('audit_log', t => {
    t.string('id', 40).primary(); t.timestamp('at').notNullable(); t.string('actor_id', 40).notNullable(); t.string('action', 40).notNullable();
    t.string('subject', 60); t.string('detail', 400); t.index(['subject']);
  });
  // Retailer's own size mix per category (overrides the mix computed from their orders). Stored as "1:3:3:2:1".
  await k.schema.createTable('size_mix', t => {
    t.string('retailer_id', 40).notNullable(); t.string('category', 20).notNullable(); t.string('ratio', 60).notNullable();
    t.timestamp('updated_at').notNullable().defaultTo(k.fn.now()); t.primary(['retailer_id', 'category']);
  });
  await k.schema.createTable('sync_cursors', t => { t.string('name', 40).primary(); t.string('cursor', 40).notNullable(); t.timestamp('updated_at').notNullable().defaultTo(k.fn.now()); });
  await k.schema.createTable('counters', t => { t.string('name', 40).primary(); t.integer('value').notNullable(); });
}

export async function down(k: Knex) {
  for (const t of ['size_mix', 'audit_log', 'inbox', 'counters', 'sync_cursors', 'exceptions', 'points_ledger', 'notifications', 'outbox', 'order_events', 'order_lines', 'orders',
    'cart_lines', 'carts', 'availability', 'style_colors', 'styles', 'refresh_tokens', 'otp_requests', 'users', 'retailers', 'distributors'])
    await k.schema.dropTableIfExists(t);
}
