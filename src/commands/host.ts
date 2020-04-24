import * as url from 'url';
import { EOL } from 'os';
import { Command } from '@jib/cli';
import { TeletyCommand, TokenOption, WebhookArg, TeletyCommandOptions, TextOption } from '../base/command';

import { REG } from '../lib/constants';
import { CONTROLS } from '../lib/controls';
import { Prompt, Chunk } from '../lib/prompt';
import { Message } from '../lib/messages';

enum WebhookType {
  MESSAGE = 'message',
  COMMENT = 'comment',
};
interface WebhookPayload extends Record<WebhookType, any> {
  [WebhookType.MESSAGE]: Pick<Message, 'input'>;
  [WebhookType.COMMENT]: { id: string, comment: string };
}
interface WebhookResponse {
  id: string;
  channel: string;
}

export interface HostOptions extends TeletyCommandOptions {
  mock: boolean;
}

@Command({
  description: 'Create TTY session piping stdin to a channel webhook',
  options: [
    TokenOption,
    TextOption,
    { flag: '-M, --mock', description: 'enable mock mode', hidden: true },
  ],
  args: [
    WebhookArg,
  ],
})
export class HostCommand extends TeletyCommand<HostOptions> {
  private webhook: url.Url;
  protected readonly ioOptions = { historyExclusions: [REG.COMMENT] };

  public help(): void {
    // output extra help
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
    const { mock, authToken } = this.options;
    const { dim } = this.ui.color;

    if (!mock) {
      await this._authenticate(this.webhook, authToken);
    }

    // print controls
    this.printControls([
      [dim(CONTROLS.QUIT.join('|')), dim('Signal end of transmission: EOT')],
      [dim(CONTROLS.COMMENT + ' <comment>'), dim('Add comment to the most recent input')],
    ]);
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
    const raw = chunks.join(EOL); // raw input (with \EOL)
    const input = Prompt.toSingle(chunks); // executable

    // handle input controls
    if (CONTROLS.QUIT.indexOf(input) > -1) { // quit
      return this._teardown(0);
    } else if (REG.COMMENT.test(input)) { // comment
      this.appendComment(input);
      return;
    }

    // execute the command
    const exec = this.spawn(input);

    // post to webhook (simultaneously)
    this.callWebhook(WebhookType.MESSAGE, { input: raw })
      .then(res => res && (Prompt.last().id = res.id)); // assign messageId result to history object

    await exec;
  }

  /**
   * append message with comment
   * @param input prompt input
   */
  private async appendComment(input: string) {
    const comment = input.replace(REG.COMMENT, '');
    const last = Prompt.last();
    if (!last) {
      return this._warn('Input must be submitted before a comment can be added');
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
    .catch(e => this._warn(e));
  }
}
