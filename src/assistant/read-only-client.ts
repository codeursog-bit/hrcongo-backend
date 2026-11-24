import type { Prisma } from '@prisma/client';
/** Block ORM side effects before Prisma can log their arguments; SQL READ ONLY remains the second barrier. */
export function readOnlyClient(tx: Prisma.TransactionClient) {
  let attempted = false;
  const mutations = new Set([
    'create',
    'createMany',
    'createManyAndReturn',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'upsert',
    'delete',
    'deleteMany',
  ]);
  const stop = () => {
    attempted = true;
    throw new Error('Assistant read-only operation refused');
  };
  const cache = new Map<PropertyKey, unknown>();
  const client = new Proxy(tx, {
    get(target, key) {
      if (
        typeof key === 'string' &&
        /^\$(executeRaw|queryRaw|transaction)/.test(key)
      )
        return stop;
      const value = Reflect.get(target, key);
      if (typeof value === 'function') return value.bind(target);
      if (value && typeof value === 'object') {
        if (!cache.has(key))
          cache.set(
            key,
            new Proxy(value, {
              get(delegate, method) {
                if (mutations.has(String(method))) return stop;
                const fn = Reflect.get(delegate, method);
                return typeof fn === 'function' ? fn.bind(delegate) : fn;
              },
            }),
          );
        return cache.get(key);
      }
      return value;
    },
  });
  return { client, attempted: () => attempted };
}
