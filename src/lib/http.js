// Consistent { data } / { message, code, fieldErrors } envelope (see BACKEND_API_CONTRACT.md).

export function ok(res, data, status = 200) {
  return res.status(status).json({ data });
}

export function fail(res, status, message, code = 'INTERNAL_ERROR', fieldErrors) {
  const body = { message, code };
  if (fieldErrors) body.fieldErrors = fieldErrors;
  return res.status(status).json(body);
}

// Wrap async route handlers so rejections reach the error middleware.
export function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
