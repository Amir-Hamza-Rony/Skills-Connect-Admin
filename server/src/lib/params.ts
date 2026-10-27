import type { Request } from "express";

/**
 * Reads a route param as a plain string.
 *
 * Express 5 types `ParamsDictionary` as `{ [key: string]: string | string[] }`
 * because a repeated segment (`/:id*`) can produce an array. A plain `:id`
 * segment never does, but the type system cannot see that, so `req.params.id`
 * reads back as `string | string[] | undefined` and every handler would need
 * its own `as string` assertion.
 *
 * This helper centralises the one place where that assertion is made. An empty
 * string is returned for a missing param so callers get a clean 404 from their
 * `ObjectId.isValid` guard rather than a 500.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
