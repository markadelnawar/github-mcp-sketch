interface CacheEntry {
  tool: string;
  args: unknown;
  response: unknown;
  createdAt: number;
}

export class ResponseCache {
  private store = new Map<string, CacheEntry>();
  private counter = 0;

  constructor(private maxSize: number) {}

  put(tool: string, args: unknown, response: unknown): string {
    this.counter += 1;
    const id = `gh-${this.counter}-${Math.random().toString(36).slice(2, 8)}`;
    this.store.set(id, { tool, args, response, createdAt: Date.now() });
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
    return id;
  }

  get(id: string): CacheEntry | undefined {
    return this.store.get(id);
  }

  size(): number {
    return this.store.size;
  }

  list(): Array<{ id: string; tool: string; createdAt: number }> {
    return Array.from(this.store.entries()).map(([id, e]) => ({
      id,
      tool: e.tool,
      createdAt: e.createdAt,
    }));
  }
}
