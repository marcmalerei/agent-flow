export class FileWatchSuppression {
  private readonly paths = new Map<string, number>();

  constructor(private readonly now = Date.now, private readonly ttlMs = 1_500) {}

  markSelfWrites(paths: string[]): void {
    const expiresAt = this.now() + this.ttlMs;
    for (const file of paths) this.paths.set(normalizePath(file), expiresAt);
  }

  consumeIfSelfWrite(file: string): boolean {
    this.prune();
    const key = normalizePath(file);
    if (!this.paths.has(key)) return false;
    this.paths.delete(key);
    return true;
  }

  private prune(): void {
    const now = this.now();
    for (const [file, expiresAt] of this.paths) {
      if (expiresAt <= now) this.paths.delete(file);
    }
  }
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/');
}
