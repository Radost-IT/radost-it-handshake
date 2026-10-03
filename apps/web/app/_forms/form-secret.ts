import { loadFormSigningSecret } from '@handshake/config';

let secret: Promise<string> | undefined;

// Loaded once per Lambda instance. A failed load is not cached, so the next
// request tries again.
export function formSigningSecret(): Promise<string> {
  secret ??= loadFormSigningSecret().catch((error: unknown) => {
    secret = undefined;
    throw error;
  });
  return secret;
}
