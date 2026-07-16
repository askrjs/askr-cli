export interface AppDependencies {
  readonly sessions: {
    get(id: string): Promise<{ id: string; subject: string } | null>;
  };
  readonly principals: {
    get(subject: string): Promise<{
      id: string;
      subject: string;
      permissions: readonly string[];
    } | null>;
  };
  readonly actions: {
    record(entry: { action: string; value: string }): Promise<void>;
  };
  readonly rateLimits: {
    consume(key: string, limit: number, windowMs: number): Promise<{
      allowed: boolean;
      remaining: number;
      reset: number;
    }>;
  };
}

export function createDependencies(): AppDependencies {
  const counters = new Map<string, { count: number; reset: number }>();
  return {
    sessions: {
      get: async (id) => id === 'demo-session'
        ? { id, subject: 'demo-user' }
        : null,
    },
    principals: {
      get: async (subject) => subject === 'demo-user'
        ? { id: subject, subject, permissions: ['messages:create'] }
        : null,
    },
    actions: { record: async () => undefined },
    rateLimits: {
      async consume(key, limit, windowMs) {
        const now = Date.now();
        const current = counters.get(key);
        const window = !current || current.reset <= now
          ? { count: 0, reset: now + windowMs }
          : current;
        window.count += 1;
        counters.set(key, window);
        return {
          allowed: window.count <= limit,
          remaining: Math.max(0, limit - window.count),
          reset: window.reset,
        };
      },
    },
  };
}
