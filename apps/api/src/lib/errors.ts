export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export const bad = (code: string, msg: string, extra?: Record<string, unknown>) => new ApiError(400, code, msg, extra);
export const notFound = (msg = 'Not found') => new ApiError(404, 'NOT_FOUND', msg);
export const forbidden = (code: string, msg: string) => new ApiError(403, code, msg);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) => new ApiError(409, code, msg, extra);
