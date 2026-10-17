import argon2 from "argon2";

import { env } from "../config/env.js";

/**
 * Password hashing — argon2id with OWASP-recommended parameters.
 *
 * argon2id (the default `argon2` type) is chosen over argon2i/bcrypt because it
 * resists both GPU cracking and side-channel attacks.
 */

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
} as const;

/** Lower bounds for a user-supplied password. Deliberately modest. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * `verify` takes no cost parameters — argon2 reads them back out of the encoded
 * hash, so old hashes keep verifying even after the defaults are raised.
 */
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

/**
 * Burns roughly the same CPU as a real verification so that "no such user" and
 * "wrong password" take the same time. Without this, response latency leaks
 * which emails are registered.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Q7YvZ0kQ0hZ2xQ0hZ2xQ0hZ2xQ0hZ2xQ0hZ2xQ0hZ";

export async function dummyVerify(plain: string): Promise<false> {
  await argon2.verify(DUMMY_HASH, plain).catch(() => false);
  return false;
}