import { Command, BaseCommand } from '@jib/cli';

import { EOL } from 'os';
import { Writable } from 'stream';
import * as url from 'url';
import * as readline from 'readline';

import { ChildPromise, child } from '../lib/child';
import { HttpClient } from '../lib/http';

const REG = {
  LF: /\\$/,
  TRAILSPC: /\s+$/g,
  GUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

const CONTROLS = {
  QUIT: ['ctrl-d', 'quit', 'exit'],
};

const CONST = {
  XAUTH: 'X-Auth-Token',
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
    { name: 'webhookURL', description: 'Telety.io webhook URL', optional: false }
  ],
})
export class PipeCommand extends BaseCommand {
  private options: IPipeOptions;
  // http
  private http = new HttpClient();
  private jwToken: string;
  private webhook: url.Url;
  // prompting
  private readonly history: string[] = [];
  private hMarker: number = 0;
  private chunk: string[] = [];
  private disconnected: boolean;
  private rl: readline.Interface;
  private resolve: (chunks: string[]) => void;
  private cancel: () => void;
  // execution
  private child: child.ChildProcess;
  private succeeded: boolean = null;

  public help(): void {
    // this.ui.output(...)
  }

  /**
   * command runner
   * @param options
   * @param webhook
   */
  public async run(options: IPipeOptions, webhook: string) {
    this.options = options;
    this.webhook = url.parse(webhook);
    // initialize and start prompt
    await this.init();
    this.next();
  }

  /**
   * obtain the user authentication token
   * @param options
   */
  private async getToken(options: IPipeOptions): Promise<void> {
    let { authToken } = options;
    const { TELETY_TOKEN } = process.env;
    const { cyan, yellow, red, green, bold, dim } = this.ui.color;

    if (authToken) { // from flag
      this.warn(`Use ${yellow('TELETY_TOKEN')} environment variable for improved security`);
    } else if (TELETY_TOKEN) { // from env
      authToken = TELETY_TOKEN;
    } else { // prompt
      authToken = await new Promise<string>(resolve => {
        // create noop writeable stream
        const secWriter = new Writable({
          write: (chunk: any, encoding: string, cb) => cb(),
        });
        // open readline with this output
        const rl = readline.createInterface({
          input: process.stdin,
          output: secWriter,
          terminal: true,
        });
        // prompt
        // this.ui.output(bold(cyan('Enter Auth Token:')));
        process.stdout.write(bold(cyan('Enter auth token: ')));
        rl.question(null, token => {
          rl.close();
          resolve(token);
        });
      });
    }
    // verify guid
    if (!REG.GUID.test(authToken || '')) {
      throw new Error('Invalid auth token');
    }

    // request JWT
    this.ui.append(dim('telety.connecting...'));
    const tokenURL = `${this.webhook.protocol}//${this.webhook.host}/auth/token`;
    try {
      const auth = await this.http.request(tokenURL, {
        method: 'POST',
        headers: {
          [CONST.XAUTH]: authToken,
        }
      });
      // this.ui.output(dim('telety.connected') + ' ' +  green('✔'));
      this.ui.append(green('✔'));
      this.jwToken = auth.headers[CONST.XAUTH.toLowerCase()] as string;
    } catch (e) {
      this.ui.append(red('✘'));
      throw(e);
    }
  }

  /**
   * initialize the runtime
   */
  private async init() {
    const { dim } = this.ui.color;
    process.on('SIGINT', async () => await this._teardown(0));
    // obtain token
    await this.getToken(this.options);

    // show controls
    this.ui.outputSection('telety.controls', this.ui.grid([
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

  /**
   * get the readline interface
   */
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

  /**
   * clear the readline output
   */
  private clearRl(): void {
    return this.rl && this.rl.write(null, { ctrl: true, name: 'u' });
  }

  /**
   * get the readline prompt string
   */
  private rlPrompt(): string {
    const { red, green, yellow, dim } = this.ui.color;
    const p: string[] = [yellow('telety.pipe')];
    if (null != this.succeeded) {
      p.push(dim(this.succeeded ? green('✔') : red('✘')));
    }
    p.push(dim('$> '));
    return p.join(' ');
  }

  /**
   * create a readline interface
   */
  private rlConnect(): void {
    this.rl = this.getRl();
    this.disconnected = false;
    this.hMarker = this.history.length;
  }

  /**
   * close the readline (without exit)
   */
  private rlDisconnect(): void {
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

  /**
   * CTRL-C handler on the readline
   */
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
      this.resolve = (chunks: Chunk[]) => {
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

    const raw = text.join(EOL);
    const cmd = text.map(t => t.replace(REG.LF, '')).join(' ');

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

  /**
   * accept rl line input
   * @param line
   */
  private line(line: string) {
    const chunk = line.replace(REG.TRAILSPC, '');
    if (chunk) {
      this.chunk.push(chunk);
      if (chunk && !REG.LF.test(chunk)) { // not new line, resolve
        this.resolve(this.chunk);
      }
    }
  }

  private async post(input: string): Promise<void> {
    const headers = { 'authorization': `Bearer ${this.jwToken}` };
    //
    await this.http.request(this.webhook.href, {
      method: 'POST',
      headers,
      body: { input }
    }).catch(e => this.warn(e));
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
