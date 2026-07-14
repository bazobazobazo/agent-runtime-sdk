export class BoundedDedupeWindow {
  private readonly values = new Set<string>();
  private readonly order: string[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('deduplication capacity must be a positive integer');
  }

  get size(): number {
    return this.values.size;
  }

  seen(key: string): boolean {
    if (this.values.has(key)) return true;
    this.values.add(key);
    this.order.push(key);
    if (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.values.delete(oldest);
    }
    return false;
  }

  clear(): void {
    this.values.clear();
    this.order.length = 0;
  }
}
