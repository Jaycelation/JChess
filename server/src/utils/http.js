export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizePair(a, b) {
  const first = a.toString();
  const second = b.toString();
  return first < second ? [first, second] : [second, first];
}
