import type { Terminal } from "@mariozechner/pi-tui";

export type TuiInputInterceptor = (data: string) => boolean;

export class InterceptingTerminal implements Terminal {
  private inputInterceptor?: TuiInputInterceptor;

  constructor(private readonly delegate: Terminal) {}

  setInputInterceptor(interceptor?: TuiInputInterceptor): void {
    this.inputInterceptor = interceptor;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.delegate.start((data) => {
      if (this.inputInterceptor?.(data)) {
        return;
      }
      onInput(data);
    }, onResize);
  }

  stop(): void {
    this.delegate.stop();
  }

  async drainInput(maxMs?: number, idleMs?: number): Promise<void> {
    await this.delegate.drainInput(maxMs, idleMs);
  }

  write(data: string): void {
    this.delegate.write(data);
  }

  get columns(): number {
    return this.delegate.columns;
  }

  get rows(): number {
    return this.delegate.rows;
  }

  get kittyProtocolActive(): boolean {
    return this.delegate.kittyProtocolActive;
  }

  moveBy(lines: number): void {
    this.delegate.moveBy(lines);
  }

  hideCursor(): void {
    this.delegate.hideCursor();
  }

  showCursor(): void {
    this.delegate.showCursor();
  }

  clearLine(): void {
    this.delegate.clearLine();
  }

  clearFromCursor(): void {
    this.delegate.clearFromCursor();
  }

  clearScreen(): void {
    this.delegate.clearScreen();
  }

  setTitle(title: string): void {
    this.delegate.setTitle(title);
  }
}
