import { Redis } from 'ioredis';
import { config } from '../config.ts';
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
export const sub = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
