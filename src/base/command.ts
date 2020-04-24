import { BaseCommand, UI } from '@jib/cli';
import { ICommandOption, ICommandArgument } from '@jib/cli/build/command';
import { HttpClient } from '../lib/http';
import { Prompt, PromptOptions } from '../lib/prompt';
import { child, ChildPromise } from '../lib/child';
import { TeletyAuth, AuthUrl, AuthnToken, AuthResult } from '../lib/auth';
import { TELETY } from '../lib/constants';

export const TokenOption: ICommandOption = { flag: '-t, --auth-token <token>', description: 'telety.io authentication token' };
export const TextOption: ICommandOption = { flag: '-p, --prompt-text <text>', description: 'customize host prompt text', default: TELETY };
export const WebhookArg: ICommandArgument = { name: 'webhookURL', description: 'telety.io webhook URL', optional: false };

export interface TeletyCommandOptions {
  authToken?: string;
  promptText?: string;
}

export abstract class TeletyCommand<T extends TeletyCommandOptions> extends BaseCommand {
  protected options: T;
  // http
  protected readonly http = new HttpClient();
  protected auth: AuthResult;
  // prompting
  protected io: Prompt;
  protected readonly ioOptions: Partial<PromptOptions>;

  // execution
  protected child: child.ChildProcess;
  protected succeeded: boolean = null;

  constructor() {
    super();
    process.on('SIGINT', async () => await this._teardown(0));
    this._ioClosed = this._ioClosed.bind(this);
  }

  /**
   * authenticate the http client
   * @param url
   * @param token
   */
  protected async _authenticate(url: AuthUrl, token?: AuthnToken) {
    // obtain token & configure http
    const authz = this.auth = await TeletyAuth(url, token);
    this.http.configure({
      headers: { authorization: `Bearer ${authz.token}` },
    });
  }

  protected printControls(controls: UI.IOutputGrid): void {
    const { dim } = this.ui.color;
    this.ui
      .outputSection(dim(`${TELETY}.controls`), this.ui.grid(controls))
      .output();
  }

  /* ### Prompting ### */

  /**
   * get the prompt interface
   */
  public prompt(): Prompt {
    if (!this.io) {
      this.io = Prompt.init({
        prompt: this._getIoText(),
        ...(this.ioOptions || {}),
      });
      this.io.interface()
        .on('close', this._ioClosed);
    }
    return this.io;
  }

  /**
   * exit the prompt programmatically
   */
  protected _ioClose(): void {
    if (this.io) {
      this.io.close();
    }
    this.io = null;
  }

  /**
   * handle 'close' and CTRL-D for prompt
   * 1. check if the prompt is open
   * 2. noop if closed manually, teardown otherwise
   */
  protected _ioClosed(): any {
    return this.io.isActive() && this._teardown(0);
  }

  /**
   * get the readline prompt string
   */
  protected _getIoText(): string {
    const { red, green, yellow, dim } = this.ui.color;
    const txt = this.options.promptText || TELETY;
    const p: string[] = [yellow(txt)];
    if (null != this.succeeded) {
      p.push(dim(this.succeeded ? green(' ✔') : red(' ✘')));
    }
    p.push(dim('> '));
    return p.join('');
  }

  /* ### Child process ### */

  /**
   * spawn child process
   * @param command
   */
  public spawn(command: string): Promise<void> {
    // disconnect prompt to allow inherit stdio
    this._ioClose();

    // execute command from `input`
    this.child = child.spawn(command, {
      stdio: 'inherit',
      shell: true,
    });

    // promisify
    return ChildPromise.resolve(this.child)
      .then(() => this.succeeded = true, () => this.succeeded = false)
      .then(() => this.child = null);
  }

  protected async _deferredExec(): Promise<void> {
    return this.child && ChildPromise.resolve(this.child).catch(() => null);
  }

  /* ### UI and process features ### */

  protected _sep(): void {
    const { dim } = this.ui.color;
    const col: number = process.stdout.columns;
    this.ui.output(dim([...Array(col + 1)].join('-')));
  }

  /**
   * print warning message
   * @param msg
   */
  protected _warn(msg: string): void {
    const { red, dim } = this.ui.color;
    this.ui.output(red(`${TELETY}.warn:`), dim(msg));
  }

  /**
   * process completion
   * @param code exit code
   */
  protected async _teardown(code: number): Promise<never> {
    const { dim } = this.ui.color;
    if (this.child) {
      this.child.kill(code);
      this.child = null;
      return;
    }
    this.ui.output();
    this.ui.output(dim(`${TELETY}.disconnected`));
    process.exit(code);
  }

}
