export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const assert = (condition, status, code, message) => {
  if (!condition) throw new HttpError(status, code, message);
};

export const errorPayload = (code, message, details) => ({
  error: { code, message, ...(details ? { details } : {}) },
});
