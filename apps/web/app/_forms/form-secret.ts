import { loadFormSigningSecret, loadOriginVerifySecret } from '@handshake/config';

// Loaded once per Lambda instance. A failed load is not cached, so the next
// request tries again.
function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => {
    value ??= load().catch((error: unknown) => {
      value = undefined;
      throw error;
    });
    return value;
  };
}

export const formSigningSecret = loadOnce(() => loadFormSigningSecret());

export const originVerifySecret = loadOnce(() => loadOriginVerifySecret());
