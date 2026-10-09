import { randomUUID, randomInt, createHmac, createHash, randomBytes } from 'node:crypto';
export const uid = () => randomUUID();
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const hmac = (secret: string, v: string) => createHmac('sha256', secret).update(v).digest('hex');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const maskPhone = (p: string) => p.replace(/^(\d{2})\d{4}(\d{4})$/, '$1•••• $2');
export const normPhone = (p: string) => { const d = String(p).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
