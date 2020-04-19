import { Command, BaseCommand } from '@jib/cli';

import { EOL } from 'os';
import { Writable } from 'stream';
import * as url from 'url';
import * as readline from 'readline';

import { ChildPromise, child } from '../lib/child';
import { HttpClient } from '../lib/http';


const CONTROLS = {
  QUIT: ['ctrl-d', 'quit', 'exit'],
  COMMENT: '#',
};

const REG = {
  LF: /\\$/,
  TRAILSPC: /\s+$/g,
  GUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  COMMENT: new RegExp(`^${CONTROLS.COMMENT}\\s*`),
};

const CONST = {
  XAUTH: 'X-Auth-Token',
}

type Chunk = string;

interface PromptResult {
  id?: string;
  input: Chunk;
}

enum WebhookType {
  MESSAGE = 'message',
  COMMENT = 'comment',
};
interface WebhookPayload extends Record<WebhookType, any> {
  [WebhookType.MESSAGE]: { input: string },
  [WebhookType.COMMENT]: { id: string, comment: string },
}

interface WebhookResponse {
  id: string;
  channel: string;
}

export interface HostOptions {
  // define invocation option types here
  authToken?: string;
  promptText: string;
}

@Command({
  description: 'Create TTY session piping stdin to a channel webhook',
  options: [
    { flag: '-t, --auth-token <token>', description: 'telety.io authentication token' },
    { flag: '-p, --prompt-text <text>', description: 'customize host prompt text', default: 'telety'},
  ],
  args: [
    { name: 'webhookURL', description: 'telety.io webhook URL', optional: false }
  ],
})
export class HostCommand extends BaseCommand {
  private options: HostOptions;
  // http
  private http = new HttpClient();
  private jwToken: string;
  private webhook: url.Url;
  // prompting
  private readonly history: PromptResult[] = [];
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
  public async run(options: HostOptions, webhook: string) {
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
  private async getToken(options: HostOptions): Promise<void> {
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
    this.ui.append(dim(`telety.connecting...`));
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
    this.ui.outputSection(dim('telety.controls'), this.ui.grid([
      [dim(CONTROLS.QUIT.join('|')), dim('Signal end of transmission: EOT')],
      [dim(CONTROLS.COMMENT + ' <comment>'), dim('Add comment to the most recent input')],
    ])).output();

    this.ui.output(dim('------------------'));

    // handle up/down
    process.stdin.on('keypress', (c, k) => {
      if (this.rl) {
        if (['up', 'down'].indexOf(k.name) > -1) {
          this.hMarker += (k.name === 'up' ? -1 : 1);
          // clamp to bounds
          this.hMarker = Math.min(Math.max(this.hMarker, 0), this.history.length);
          this.clearRl();
          const entry = this.history[this.hMarker];
          const line = entry ? entry.input : '';
          this.rl.write(line);
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
    const p: string[] = [yellow(this.options.promptText)];
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

    const raw = text.join(EOL); // raw input (with \EOL)
    const input = text.map(t => t.replace(REG.LF, '')).join(' ');

    // handle controls
    if (CONTROLS.QUIT.indexOf(input) > -1) { // quit
      return this._teardown(0);
    } else if (REG.COMMENT.test(input)) { // comment
      this.appendComment(input);
      return;
    }

    // disconnect readline to allow inherit stdio
    this.rlDisconnect();

    // execute command from `text`
    this.child = child.spawn(input, {
      stdio: 'inherit',
      shell: true,
    });

    // push history record
    const hist: PromptResult = { input };
    this.history.push(hist);

    // post to webhook
    this.callWebhook(WebhookType.MESSAGE, { input: raw })
      .then(res => res && (hist.id = res.id)); // assign messageId result to history object

    await ChildPromise
      .resolve(this.child)
      .then(() => this.succeeded = true) // success
      .catch(e => this.succeeded = false); // error

    this.child = null;
  }

  private async appendComment(input: string) {
    const comment = input.replace(REG.COMMENT, '');
    const last = this.history[this.history.length - 1];
    if (!last) {
      return this.warn('Input must be submitted before a comment can be added');
    }
    return this.callWebhook(WebhookType.COMMENT, { id: last.id, comment });
  }

  private async callWebhook<T extends WebhookType>(type: T, payload: WebhookPayload[T] ): Promise<WebhookResponse> {
    const headers = { 'authorization': `Bearer ${this.jwToken}` };
    // post to webhook
    return await this.http.request(this.webhook.href, {
      method: 'POST',
      headers,
      body: { type, payload },
    })
    .then(r => r.data)
    .catch(e => this.warn(e));
  }

  /**
   * print warning message
   */
  private warn(msg: string): void {
    const { red, dim } = this.ui.color;
    this.ui.output(red('telety.warn:'), dim(msg));
  }

  /**
   * process completion
   * @param code exit code
   */
  private async _teardown(code: number): Promise<never> {
    const { dim } = this.ui.color;
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
