import { Command, BaseCommand } from '@jib/cli';

import { EOL } from 'os';
import * as url from 'url';

import { ChildPromise, child } from '../lib/child';
import { HttpClient } from '../lib/http';
import { REG } from '../lib/constants';
import { CONTROLS } from '../lib/controls';
import { TeletyAuth } from '../lib/auth';
import { Prompt, Chunk, PromptResult } from '../lib/prompt';

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
  mock: boolean;
}

@Command({
  description: 'Create TTY session piping stdin to a channel webhook',
  options: [
    { flag: '-t, --auth-token <token>', description: 'telety.io authentication token' },
    { flag: '-p, --prompt-text <text>', description: 'customize host prompt text', default: 'telety' },
    { flag: '-M, --mock', description: 'enable mock mode', hidden: true },
  ],
  args: [
    { name: 'webhookURL', description: 'telety.io webhook URL', optional: false }
  ],
})
export class HostCommand extends BaseCommand {
  private options: HostOptions;
  private webhook: url.Url;
  // http
  private http = new HttpClient();
  // prompting
  private io: Prompt;
  // execution
  private child: child.ChildProcess;
  private succeeded: boolean = null;

  public help(): void {
    // no extra help yet
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
   * initialize the runtime
   */
  private async init() {
    const { mock } = this.options;
    const { dim } = this.ui.color;
    process.on('SIGINT', async () => await this._teardown(0));

    if (!mock) {
      // obtain token & configure http
      const token = await TeletyAuth(this.webhook, this.options.authToken);
      this.http.configure({
        headers: { authorization: `Bearer ${token}` },
      });
    }

    // print controls
    this.ui.outputSection(dim('telety.controls'), this.ui.grid([
      [dim(CONTROLS.QUIT.join('|')), dim('Signal end of transmission: EOT')],
      [dim(CONTROLS.COMMENT + ' <comment>'), dim('Add comment to the most recent input')],
    ])).output(dim('------------------')).output();
  }

  /**
   * get the readline interface
   */
  private prompt(): Prompt {
    if (!this.io) {
      this.io = Prompt.init({
        prompt: this.getPromptText(),
        historyExclusions: [ REG.COMMENT ],
      });
      this.io.interface()
        .on('close', () => this.ioClosed());
    }
    return this.io;
  }

  /**
   * exit the prompt altogether
   */
  private exitPrompt(): void {
    this.io.close();
    this.io = null;
  }

  /**
   * handle 'close' and CTRL-D for prompt
   * 1. check if the prompt is open
   * 2. noop if closed manually, teardown otherwise
   */
  private ioClosed(): any {
    return this.io.isActive() && this._teardown(0);
  }

  /**
   * get the readline prompt string
   */
  private getPromptText(): string {
    const { red, green, yellow, dim } = this.ui.color;
    const p: string[] = [yellow(this.options.promptText)];
    if (null != this.succeeded) {
      p.push(dim(this.succeeded ? green(' ✔') : red(' ✘')));
    }
    p.push(dim('> '));
    return p.join('');
  }

  /**
   * next prompt
   */
  private async next(): Promise<void> {
    // prompt
    const text: Chunk[] = await this.prompt().multiline().catch(e => null);
    // process
    await this.processInput(text);
    this.next();
  }

  /**
   * process input text
   * @param chunks
   */
  private async processInput(chunks: Chunk[]): Promise<void> {
    const { mock } = this.options;

    const raw = chunks.join(EOL); // raw input (with \EOL)
    const input = chunks.map(t => t.replace(REG.LF, '')).join(' '); // executable

    // handle input controls
    if (CONTROLS.QUIT.indexOf(input) > -1) { // quit
      return this._teardown(0);
    } else if (REG.COMMENT.test(input)) { // comment
      this.appendComment(input);
      return;
    }

    // disconnect prompt to allow inherit stdio
    this.exitPrompt();

    // execute command from `input`
    this.child = child.spawn(input, {
      stdio: 'inherit',
      shell: true,
    });

    // post to webhook
    this.callWebhook(WebhookType.MESSAGE, { input: raw })
      .then(res => res && (Prompt.last().id = res.id)); // assign messageId result to history object

    await ChildPromise
      .resolve(this.child)
      .then(() => this.succeeded = true) // success
      .catch(e => this.succeeded = false); // error

    this.child = null;
  }

  /**
   * append message with comment
   * @param input prompt input
   */
  private async appendComment(input: string) {
    const comment = input.replace(REG.COMMENT, '');
    const last = Prompt.last();
    if (!last) {
      return this.warn('Input must be submitted before a comment can be added');
    }
    return this.callWebhook(WebhookType.COMMENT, { id: last.id, comment });
  }

  /**
   * invoke the webhook
   * @param type
   * @param payload
   */
  private async callWebhook<T extends WebhookType>(type: T, payload: WebhookPayload[T] ): Promise<WebhookResponse> {
    const { mock } = this.options;
    // post to webhook
    return !mock && await this.http.request(this.webhook.href, {
      method: 'POST',
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
