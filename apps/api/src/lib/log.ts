import pino from 'pino';
import { config } from '../config.ts';

// Structured JSON logs. Every order-affecting line carries orderId / requestId so one order can be traced end to end.
export const log = pino({ level: process.env.LOG_LEVEL ?? (config.env === 'test' ? 'silent' : 'info'), base: { svc: 'citrus-trade-api' } });
