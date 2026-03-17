export function apiError(message: string, status = 500) {
  return Response.json({ error: message }, { status })
}

export function apiSuccess<T>(data: T, status = 200) {
  return Response.json({ data }, { status })
}
