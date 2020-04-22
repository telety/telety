
import * as url from 'url';
import * as readline from 'readline';

import { EOL } from 'os';
import { Writable } from 'stream';
import { REG } from './constants';

export type Chunk = string;

export interface PromptResult {
  id?: string;
  input: Chunk;
}

export class Prompt {
  public static defaults: Partial<readline.ReadLineOptions> = {
    input: process.stdin,
    output: process.stdout,
  };
  public static readonly history: PromptResult[];

  protected readonly _options: readline.ReadLineOptions;
  protected readonly _rl: readline.Interface;
  protected _chunks: Chunk[] = [];
  protected _resolve: (chunks: Chunk[]) => void;

  protected readonly _history = [...Prompt.history];
  protected _historyMarker: number = this._history.length;

  public static secure(options?: readline.ReadLineOptions): Prompt {
    return new this({
      input: process.stdin,
      terminal: true,
      output: new Writable({
        write: (chunk: any, encoding: string, cb) => cb(),
      }),
      ...(options || {}),
    }, true);
  }

  public static init(options?: readline.ReadLineOptions): Prompt {
    return new this(options);
  }

  constructor(options: readline.ReadLineOptions, protected readonly secure?: boolean) {
    this._options = {
      ...Prompt.defaults,
      ...options,
    };

    this._rl = readline.createInterface(this._options);
    this._attachEvents();
  }

  private _attachEvents(): void {
    // keypress
    this.keypress = this.keypress.bind(this);
    this._options.input.on('keypress', this.keypress);
  }

  private _detachEvents(): void {
    this._options.input.off('keypress', this.keypress);
  }

  /**
   * accept rl line input
   * @param line
   */
  private line(line: string) {
    const chunk = line.replace(REG.TRAILSPC, '');
    if (chunk) {
      this._chunks.push(chunk);
      if (chunk && !REG.LF.test(chunk)) { // not new line, resolve
        this._resolve(this._chunks);
      }
    }
  }

  /**
   * handle keypress
   * @param code the key code
   * @param key the key object
   */
  private keypress(code: any, key: any): void {
    if (['up', 'down'].indexOf(key.name) > -1) {
      const history = this._history;
      this._historyMarker += (key.name === 'up' ? -1 : 1);
      // clamp to bounds
      this._historyMarker = Math.min(Math.max(this._historyMarker, 0), history.length);
      const entry = history[this._historyMarker];
      const line = entry ? entry.input : '';
      // update
      this.clear();
      this._rl.write(line);
    }
  }

  public interface(): readline.Interface {
    return this._rl;
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
  public open(): Promise<Chunk[]> {
    return new Promise(resolve => {
      this._chunks = [];
      // this.rlConnect();

      // set hooks
      this._resolve = (chunks: Chunk[]) => {
        this._resolve = null;
        resolve(chunks);
      };
      // begin
      this._rl.prompt();
    });
  }

  public close(): void {
    this._detachEvents();
    this._rl.close();
  }

  // public terminate(): void {
  //   this._rl.close();
  // }

  /**
   * clear the readline output
   */
  public clear(): void {
    return this._rl && this._rl.write(null, { ctrl: true, name: 'u' });
  }

};
