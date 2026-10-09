// Mobile OTP sign-in bound to existing ERP customers, distributors and CITRUS staff. Never creates unknown accounts.
// OTPs are single use, short lived, stored only as HMAC, attempt- and send-limited (OWASP MFA cheat sheet; TRAI DLT for SMS).
import { SignJWT, jwtVerify } from 'jose';
import type { Me, Role } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { config } from '../config.ts';
import { uid, otpCode, hmac, sha256, token, maskPhone, normPhone } from '../lib/ids.ts';
import { ApiError, forbidden, bad } from '../lib/errors.ts';
import { sender, TEMPLATES } from '../adapters/messaging.ts';
import { raiseException } from './exceptions.ts';

const key = new TextEncoder().encode(config.jwtSecret);
export interface Claims { sub: string; role: Role; rid?: string; did?: string }

export async function inviteInfo(tok: string) {
  const r = await db('retailers').where({ invite_token: tok }).first();
  if (!r) throw new ApiError(404, 'INVITE_NOT_FOUND', 'This link is not valid. Ask your CITRUS rep for a new one.');
  const d = await db('distributors').where({ id: r.distributor_id }).first();
  return { store: r.store, city: `${r.city}, ${r.state}`, code: r.code, gstin: r.gstin, maskedPhone: maskPhone(r.phone), distributor: `${d.name}, ${d.city}`, activated: r.status === 'active' };
}

async function findAccount(phone: string, invite?: string) {
  if (invite) {
    const r = await db('retailers').where({ invite_token: invite }).first();
    if (!r) throw new ApiError(404, 'INVITE_NOT_FOUND', 'This link is not valid. Ask your CITRUS rep for a new one.');
    if (r.phone !== phone) {
      await raiseException('activation', 'warn', 'Unmatched mobile number', `+91 ${maskPhone(phone)} tried to activate ${r.store} (${r.code}). Sent to manual verification.`);
      throw forbidden('PHONE_MISMATCH', 'This number is not registered for this store. Your CITRUS rep will verify it and call you.');
    }
    return { kind: 'retailer' as const, retailer: r };
  }
  const u = await db('users').where({ phone }).first();
  if (u) return { kind: 'user' as const, user: u };
  const r = await db('retailers').where({ phone }).first();
  if (r) return { kind: 'retailer' as const, retailer: r };
  await raiseException('activation', 'info', 'Unknown number tried to sign in', `+91 ${maskPhone(phone)} is not on any CITRUS customer, distributor or staff record.`);
  throw forbidden('UNKNOWN_NUMBER', 'This number is not registered with CITRUS. Please use the link your CITRUS rep sent you.');
}

export async function requestOtp(rawPhone: string, invite: string | undefined, ip: string, channel?: 'sms' | 'whatsapp' | 'voice') {
  const phone = normPhone(rawPhone);
  if (!/^[6-9]\d{9}$/.test(phone)) throw bad('INVALID_PHONE', 'Enter a 10-digit Indian mobile number.');
  await findAccount(phone, invite);
  const now = Date.now();
  const recent = await db('otp_requests').where({ phone }).andWhere('created_at', '>', new Date(now - 86_400_000)).orderBy('created_at', 'desc');
  const last = recent[0];
  if (last && now - new Date(last.created_at).getTime() < POLICY.otp.resendAfterSeconds * 1000)
    throw new ApiError(429, 'RESEND_TOO_SOON', 'Please wait a few seconds before asking for a new code.', { retryIn: POLICY.otp.resendAfterSeconds });
  if (recent.filter((r: any) => now - new Date(r.created_at).getTime() < 900_000).length >= POLICY.otp.maxPer15Min ||
      recent.length >= POLICY.otp.maxPerDay)
    {
    const oldest15 = recent.filter((r: any) => now - new Date(r.created_at).getTime() < 900_000).pop();
    const retryIn = recent.length >= POLICY.otp.maxPerDay ? 86_400 - Math.round((now - new Date(recent[recent.length - 1].created_at).getTime()) / 1000)
      : 900 - Math.round((now - new Date(oldest15.created_at).getTime()) / 1000);
    throw new ApiError(429, 'TOO_MANY_CODES', 'Too many codes requested. Please try again later or call your CITRUS rep.', { retryIn: Math.max(1, retryIn) });
  }
  await db('otp_requests').where({ phone }).whereNull('consumed_at').update({ consumed_at: new Date() }); // a new code invalidates older ones
  const id = uid(), code = otpCode();
  await db('otp_requests').insert({ id, phone, code_hash: hmac(config.otpPepper, id + code), expires_at: new Date(now + POLICY.otp.ttlSeconds * 1000), attempts: 0, created_at: new Date(), ip });
  // WhatsApp authentication template first, SMS (DLT) as fallback: SMS OTPs are often delayed or filtered in India.
  let sent = false;
  // "Get the code on a call" (voice) and explicit channel choices go first; the configured order is the fallback.
  for (const ch of [...new Set([...(channel ? [channel] : []), ...config.otpChannels])]) {
    try { await sender(ch).send({ channel: ch, to: phone, template: 'otp', body: TEMPLATES.otp(code) }); sent = true; break; } catch { /* try next channel */ }
  }
  if (!sent) throw new ApiError(503, 'OTP_NOT_SENT', 'We could not send your code right now. Please try again in a minute or call your CITRUS rep.');
  return { requestId: id, expiresIn: POLICY.otp.ttlSeconds, resendIn: POLICY.otp.resendAfterSeconds, devCode: config.otpDevEcho ? code : undefined };
}

export async function verifyOtp(requestId: string, code: string, userAgent: string) {
  const r = await db('otp_requests').where({ id: requestId }).first();
  if (!r || r.consumed_at) throw bad('CODE_USED', 'This code has already been used. Ask for a new one.');
  if (new Date(r.expires_at).getTime() < Date.now()) throw bad('CODE_EXPIRED', 'This code has expired. Ask for a new one.');
  if (r.attempts >= POLICY.otp.maxAttempts) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong tries. Ask for a new code.');
  if (hmac(config.otpPepper, r.id + String(code).trim()) !== r.code_hash) {
    await db('otp_requests').where({ id: r.id }).increment('attempts', 1);
    const left = POLICY.otp.maxAttempts - r.attempts - 1;
    throw bad('WRONG_CODE', left > 0 ? `That code is not right. ${left} tries left.` : 'That code is not right. Ask for a new one.');
  }
  await db('otp_requests').where({ id: r.id }).update({ consumed_at: new Date() });
  let user = await db('users').where({ phone: r.phone }).first();
  if (!user) {
    const ret = await db('retailers').where({ phone: r.phone }).first();
    if (!ret) throw forbidden('UNKNOWN_NUMBER', 'This number is not registered with CITRUS.');
    user = { id: uid(), role: 'retailer', phone: r.phone, name: ret.owner, retailer_id: ret.id, created_at: new Date() };
    await db('users').insert(user);
  }
  if (user.retailer_id) await db('retailers').where({ id: user.retailer_id, status: 'invited' }).update({ status: 'active', activated_at: new Date() });
  await db('users').where({ id: user.id }).update({ last_login_at: new Date() });
  return issueSession(user, uid(), userAgent);
}

async function accessToken(user: any) {
  const c: Claims = { sub: user.id, role: user.role, rid: user.retailer_id ?? undefined, did: user.distributor_id ?? undefined };
  return new SignJWT({ role: c.role, rid: c.rid, did: c.did }).setProtectedHeader({ alg: 'HS256' }).setSubject(c.sub)
    .setIssuedAt().setExpirationTime(`${config.accessTtlSeconds}s`).sign(key);
}

async function issueSession(user: any, family: string, userAgent: string) {
  const refresh = token();
  await db('refresh_tokens').insert({
    id: uid(), user_id: user.id, family, token_hash: sha256(refresh), created_at: new Date(),
    expires_at: new Date(Date.now() + config.refreshTtlDays * 86_400_000), user_agent: userAgent.slice(0, 200),
  });
  return { accessToken: await accessToken(user), expiresIn: config.accessTtlSeconds, refresh, me: await me(user.id) };
}

/** Rotating refresh tokens with reuse detection: a replayed token revokes the whole family. */
export async function refreshSession(raw: string | undefined, userAgent: string) {
  if (!raw) throw new ApiError(401, 'NO_SESSION', 'Please sign in again.');
  const t = await db('refresh_tokens').where({ token_hash: sha256(raw) }).first();
  if (!t) throw new ApiError(401, 'NO_SESSION', 'Please sign in again.');
  if (t.revoked_at) {
    await db('refresh_tokens').where({ family: t.family }).whereNull('revoked_at').update({ revoked_at: new Date() });
    throw new ApiError(401, 'SESSION_REUSED', 'For your safety, please sign in again.');
  }
  if (new Date(t.expires_at).getTime() < Date.now()) throw new ApiError(401, 'SESSION_EXPIRED', 'Please sign in again.');
  await db('refresh_tokens').where({ id: t.id }).update({ revoked_at: new Date() });
  const user = await db('users').where({ id: t.user_id }).first();
  return issueSession(user, t.family, userAgent);
}

export async function logout(raw?: string) {
  if (raw) await db('refresh_tokens').where({ token_hash: sha256(raw) }).update({ revoked_at: new Date() });
}

export async function verifyAccess(tok: string): Promise<Claims> {
  try {
    const { payload } = await jwtVerify(tok, key);
    return { sub: payload.sub!, role: payload.role as Role, rid: payload.rid as string | undefined, did: payload.did as string | undefined };
  } catch { throw new ApiError(401, 'TOKEN_EXPIRED', 'Session expired.'); }
}

export async function me(userId: string): Promise<Me> {
  const u = await db('users').where({ id: userId }).first();
  const out: Me = { userId: u.id, role: u.role, name: u.name, phone: u.phone, supportPhone: config.supportPhone, repName: 'Imran K.' };
  if (u.retailer_id) {
    const r = await db('retailers').where({ id: u.retailer_id }).first();
    const d = await db('distributors').where({ id: r.distributor_id }).first();
    out.retailer = { id: r.id, code: r.code, store: r.store, city: r.city, state: r.state, gstin: r.gstin, distributor: { id: d.id, name: d.name, city: d.city } };
    out.points = Number(r.points);
    out.consentRequired = !r.consent_at;
  }
  if (u.distributor_id) {
    const d = await db('distributors').where({ id: u.distributor_id }).first();
    out.distributor = { id: d.id, name: d.name, city: d.city, state: d.state };
  }
  return out;
}

export async function recordConsent(retailerId: string, waMarketing: boolean) {
  await db('retailers').where({ id: retailerId }).update({ consent_at: new Date(), wa_marketing_opt_in: !!waMarketing });
}
