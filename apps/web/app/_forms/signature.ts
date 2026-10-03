import { createHmac, timingSafeEqual } from 'node:crypto';

export function signFormValue(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function hasValidSignature(secret: string, value: string, signature: string): boolean {
  const expected = Buffer.from(signFormValue(secret, value));
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
