export const createSnapshotGate = () => {
  let context = { uid: "", barberId: "", generation: 0 };
  let revisions = { user: -1, barber: -1 };
  return {
    activate(uid, barberId) {
      if (uid !== context.uid || barberId !== context.barberId) {
        context = { uid, barberId, generation: context.generation + 1 };
        revisions = { user: -1, barber: -1 };
      }
      return { ...context };
    },
    capture() { return { ...context }; },
    isCurrent(token) {
      return token.generation === context.generation && token.uid === context.uid && token.barberId === context.barberId;
    },
    accept(sync, token) {
      if (!this.isCurrent(token) || !sync || sync.uid !== context.uid ||
          (context.barberId && sync.barberId !== context.barberId)) return false;
      const user = Number(sync.userRevision) || 0;
      const barber = Number(sync.barberRevision) || 0;
      if (user < revisions.user || barber < revisions.barber) return false;
      revisions = { user, barber };
      return true;
    },
    needsRefresh(source, revision) { return Number(revision) > revisions[source]; },
  };
};

// Invalidation during an in-flight read must trigger a trailing read. Ordinary
// duplicate callers share one promise; a different barber never shares it.
export const createScopedRefreshQueue = () => {
  const pending = new Map();
  return {
    run(key, load, invalidate = false) {
      const existing = pending.get(key);
      if (existing) {
        if (invalidate) existing.dirty = true;
        return existing.promise;
      }
      const entry = { dirty: false, promise: null };
      entry.promise = Promise.resolve().then(async () => {
        let result;
        do { entry.dirty = false; result = await load(); } while (entry.dirty);
        return result;
      }).finally(() => { if (pending.get(key) === entry) pending.delete(key); });
      pending.set(key, entry);
      return entry.promise;
    },
  };
};
