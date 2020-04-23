import * as readline from 'readline';
import { Writable } from 'stream';
import { REG } from './constants';

export type Chunk = string;

export interface PromptResult {
  id?: string;
  input: Chunk;
}

export interface PromptOptions extends Partial<readline.ReadLineOptions> {
  historyExclusions?: RegExp[];
}

export class Prompt {
  public static defaults: Partial<readline.ReadLineOptions> = {
    input: process.stdin,
    output: process.stdout,
    tabSize: 2,
    historySize: 0, // managed separately
  };
  public static readonly history: PromptResult[] = [];

  protected readonly _options: PromptOptions;
  protected readonly _rl: readline.Interface;
  // history
  protected readonly _history = [...Prompt.history];
  protected _historyMarker: number = this._history.length;
  // state
  protected _chunks: Chunk[] = [];
  protected _resolver: (chunks: Chunk[]) => void;

  /**
   * create a secure prompt
   * @param options
   */
  public static secure(options?: PromptOptions): Prompt {
    return new this({
      input: process.stdin,
      terminal: true,
      output: new Writable({
        write: (chunk: any, encoding: string, cb) => cb(),
      }),
      ...(options || {}),
    }, true);
  }

  public static init(options?: PromptOptions): Prompt {
    return new this(options as PromptOptions);
  }

  public static last(): PromptResult {
    return this.history[this.history.length - 1];
  }

  constructor(options: PromptOptions, protected readonly secure?: boolean) {
    this._options = {
      ...Prompt.defaults,
      ...options,
    };

    this.close = this.close.bind(this);
    this.clear = this.clear.bind(this);
    this.cancel = this.cancel.bind(this);
    this.onLine = this.onLine.bind(this);
    this.onKeypress = this.onKeypress.bind(this);
    // initialize
    this._rl = readline.createInterface(this._options as readline.ReadLineOptions);
    this._attachEvents();
  }

  public interface(): readline.Interface {
    return this._rl;
  }

  private _attachEvents(): void {
    this._options.input.on('keypress', this.onKeypress);
  }

  private _detachEvents(): void {
    this._options.input.off('keypress', this.onKeypress);
  }

  /**
   * finish the prompt and resolve the input(s)
   * @param chunks input chunks
   */
  private _finish(chunks: Chunk[]): void {
    this._addHistory(chunks);
    // resolve
    const r = this._resolver;
    this._resolver = null;
    return r && r(chunks);
  }

  /**
   * add history
   * @param chunks raw chunks
   */
  private _addHistory(chunks: Chunk[]): void {
    if (chunks && chunks.length) { // add history
      const { historyExclusions } = this._options;
      const input = chunks.map(t => t.replace(REG.LF, '')).join(' ');
      if (historyExclusions && historyExclusions.some(ex => ex.test(input))) {
        return;
      }
      const hist: PromptResult = { input };
      this._history.push(hist);
      Prompt.history.push(hist);
    }
  }

  /**
   * accept rl line input
   * @param line
   */
  private onLine(line: Chunk) {
    const chunk = line.replace(REG.TRAILSPC, '');
    if (chunk) {
      this._chunks.push(chunk);
      if (chunk && !REG.LF.test(chunk)) { // not new line, resolve
        this._finish(this._chunks);
        this._chunks = [];
      }
    }
  }

  /**
   * handle keypress
   * @param code the key code
   * @param key the key object
   */
  private onKeypress(code: any, key: any): void {
    if (['up', 'down'].indexOf(key.name) > -1) {
      if (!this._chunks.length) {
        const history = this._history;
        this._historyMarker += (key.name === 'up' ? -1 : 1);
        // clamp to bounds
        this._historyMarker = Math.min(Math.max(this._historyMarker, 0), history.length);
        const entry = history[this._historyMarker];
        const line = entry ? entry.input : '';
        // update prompt
        this.clear();
        this.interface().write(line);
      }
    }
  }

  /**
   * ask a single question
   * @param input the prompt question
   */
  public async question(input: string) : Promise<string> {
    if (this.secure) {
      Prompt.defaults.output.write(input);
    }
    return new Promise(resolve => this._rl.question(input, resolve));
  }

  /**
   * begin prompt
   */
  public multiline(): Promise<Chunk[]> {
    return new Promise(resolve => {
      // set resolver
      this._resolver = resolve;
      // prep start
      this._historyMarker = this._history.length;
      this._chunks = [];
      const rl = this.interface()
        .on('line', this.onLine)
        .on('SIGINT', this.clear); // handle CTRL-C (to clear)

      // begin
      rl.prompt();
    });
  }

  /**
   * clear the readline output
   */
  public clear(): void {
    return this.interface()
      .write(null, { ctrl: true, name: 'u' });
  }

  /**
   * cancel current prompt (resolves null)
   */
  public async cancel(): Promise<void> {
    return this._finish(null);
  }

  /**
   * close the prompt
   */
  public close(): void {
    this._detachEvents();
    this._resolver = null;
    this.interface().close(); // this will trigger the `SIGINT` on the readline
  }

  /**
   * test if the prompt is active
   */
  public isActive(): boolean {
    return !!this._resolver;
  }

};
