import { Command, BaseCommand, Plugin } from '@jib/cli';
import { JibPrompt } from '@jib/prompt';

import * as url from 'url';
import * as readline from 'readline';
import * as childProcess from 'child_process';

// import * as ora from 'ora';
import { ChildPromise, child } from '../lib/child';
import { HttpClient } from '../lib/http';
import { EOL } from 'os';

const RegLF = /\\$/;

const CONTROLS = {
  QUIT: ['CTRL-D', 'quit', 'exit'],
}

type Chunk = string;

export interface IPipeOptions {
  // define invocation option types here
  authToken?: string;
}

@Command({
  description: 'Create TTY session piping stdin to a channel webhook',
  options: [
    { flag: '-t, --auth-token <token>', description: 'Telety.io authentication token' }
  ],
  args: [
    { name: 'webhook', description: 'Telety.io webhook URL', optional: false }
  ],
})
export class PipeCommand extends BaseCommand {
  private options: IPipeOptions;
  // http
  private http = new HttpClient();
  private token: string;
  private webhook: url.Url;
  // prompting
  private readonly history: string[] = [];
  private hMarker: number = 0;
  private chunk: string[];
  private disconnected: boolean;
  private rl: readline.Interface;
  private resolve: (chunks: string[]) => void;
  private cancel: () => void;
  // execution
  private child: childProcess.ChildProcess;
  private succeeded: boolean = null;

  @Plugin(JibPrompt)
  private ask: JibPrompt;

  public help(): void {
    // this.ui.output(...)
  }

  // public async run(options: IPipeOptions, ...args: string[]) {
  public async run(options: IPipeOptions, webhook: string) {
    this.options = options;
    this.webhook = url.parse(webhook);
    await this.init();
    this.next();
  }

  private async getToken(options: IPipeOptions): Promise<void> {
    if (options.authToken) {
      this.warn('It is not recommended to provide auth token with flag');
    }
    this.token = options.authToken ||
      await this.ask.prompt({
        type: 'password',
        name: 'token',
        message: 'Provide a telety.io auth token:',
      }).then(ans => ans.token);
  }

  private async init() {
    const { dim } = this.ui.color;
    process.on('SIGINT', async () => await this._teardown(0));
    // obtain token
    await this.getToken(this.options);

    // show controls
    this.ui.outputSection('Controls', this.ui.grid([
      [CONTROLS.QUIT.join('|'), dim('Signal end of transmission: EOT')],
    ])).output();

    // handle up/down
    process.stdin.on('keypress', (c, k) => {
      if (this.rl) {
        if (['up', 'down'].indexOf(k.name) > -1) {
          this.hMarker += (k.name === 'up' ? -1 : 1);
          // clamp to bounds
          this.hMarker = Math.min(Math.max(this.hMarker, 0), this.history.length);
          this.clearRl();
          this.rl.write(this.history[this.hMarker] || '');
        }
      }
    });

  }


  private getRl(): readline.Interface {
    // init readline
    return this.rl || readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      tabSize: 2,
      prompt: this.rlPrompt(),
    }).on('line', l => this.line(l))
      .on('close', () => this.rlClosed()) // CTRL-D, or explicit
      .on('SIGINT', () => this.rlInterrupt()); // CTRL-C
  }

  private clearRl(): void {
    return this.rl && this.rl.write(null, { ctrl: true, name: 'u' });
  }

  private rlPrompt(): string {
    const { red, green, yellow, dim } = this.ui.color;
    const p: string[] = [yellow('telety.pipe')];
    if (null != this.succeeded) {
      p.push(this.succeeded ? green('✔') : red('✘'));
    }
    p.push(dim('$> '));
    return p.join(' ');
  }

  private rlConnect() {
    this.rl = this.getRl();
    this.disconnected = false;
    this.hMarker = this.history.length;
  }

  private rlDisconnect() {
    this.disconnected = true;
    this.rl.close();
    this.rl = null;
  }

  /**
   * called either when EOT (ctrl-D) and on explicit close between commands;
   */
  private async rlClosed() {
    if (!this.disconnected) {
      await this._teardown(0);
    }
  }


  private rlInterrupt() {
    // resolve null to start new
    return this.resolve && this.resolve(null);
  }

  /**
   * next prompt
   */
  private async next(): Promise<void> {
    // prompt
    const text = await this.prompt().catch(e => null);
    // process
    await this.processInput(text);
    this.next();
  }

  /**
   * begin prompt
   */
  private prompt() : Promise<Chunk[]> {
    return new Promise((resolve, reject) => {
      this.chunk = [];
      this.rlConnect();

      // set hooks
      this.resolve = (chunks: string[]) => {
        this.resolve = null;
        resolve(chunks);
      };
      this.cancel = () => {
        this.chunk = [];
        this.cancel = null;
        reject();
      };
      // begin
      this.rl.prompt();
    });
  }

  /**
   * process input text
   * @param text
   */
  private async processInput(text: Chunk[]): Promise<void> {

    if (!text || !text.length) {
      // clear line
      this.clearRl();
      return;
    }

    const raw = text.map(t => t.replace(RegLF, '')).join(EOL);
    const cmd = text.map(t => t.replace(RegLF, '')).join(' ');

    // handle quit
    if (CONTROLS.QUIT.indexOf(cmd) > -1) {
      return this._teardown(0);
    }

    // push history
    this.history.push(cmd);

    // disconnect readline to allow inherit stdio
    this.rlDisconnect();

    // execute command from `text`
    this.child = child.spawn(cmd, {
      stdio: 'inherit',
      shell: true,
    });

    this.post(raw);

    await ChildPromise
      .resolve(this.child)
      .then(() => this.succeeded = true) // success
      .catch(e => this.succeeded = false); // error

    this.child = null;
  }

  private async post(input: string): Promise<void> {
    const headers = {
      'X-Auth-Token': this.token,
    };
    //
    await this.http.request(this.webhook.href, {
      body: {
        input,
      }
    }).catch(e => this.warn(e));
  }

  /**
   * accept rl line input
   * @param line
   */
  private line(line: string) {
    const chunk = line.trim();
    if (chunk) {
      this.chunk.push(chunk);
      if (chunk && !RegLF.test(chunk)) { // not new line, resolve
        this.resolve(this.chunk);
      }
    }
  }

  /**
   * print warning message
   */
  private warn(msg: string): void {
    const { red, dim } = this.ui.color;
    this.ui.output(red('WARNING:'), dim(msg));
  }

  /**
   * process completion
   * @param code exit code
   */
  private async _teardown(code: number): Promise<never> {
    const { yellow, dim } = this.ui.color;
    if (this.child) {
      this.child.kill(code);
      this.child = null;
      return;
    }
    this.ui.output();
    this.ui.output(dim('telety.disconnected'));
    process.exit(code);
  }
}
