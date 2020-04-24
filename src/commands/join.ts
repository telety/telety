import * as url from 'url';
import { Command } from '@jib/cli';
import { TeletyCommand, TokenOption, WebhookArg, TeletyCommandOptions, TextOption } from '../base/command';
import { SocketClient, MSG_TYPE, SocketMessage } from '../lib/socket';
import { Message, messageIdHash } from '../lib/messages';
import { Prompt, Chunk } from '../lib/prompt';
import { CONTROLS } from '../lib/controls';

export interface JoinOptions extends TeletyCommandOptions {
  printHistory: boolean;
}

@Command({
  description: 'Join a telety channel with a TTY interface',
  options: [
    TokenOption,
    TextOption,
    { flag: '-P, --print-history', description: 'output all channel history' },
  ],
  args: [
    WebhookArg,
  ],
})
export class JoinCommand extends TeletyCommand<JoinOptions> {
  private socket: SocketClient;
  private webhook: url.Url;
  private channel: string;
  private tty: Promise<any>;

  constructor() {
    super();
    this.receiver = this.receiver.bind(this);
  }

  public help(): void {
    // print additional help here
  }

  public async run(options: JoinOptions, webhook: string) {
    this.options = options;
    this.webhook = url.parse(webhook);
    this.channel = this.webhook.path.split('/').slice(-2).shift(); // channel id
    await this._authenticate(webhook);
    await this.init();
  }

  public async init() {
    const { endpoint } = this.auth;
    // init messages
    await this.initMessages();

    const wsUrl = endpoint.replace(/^http/, 'ws') + '/client'; // TODO: dynamic
    // connect socket with same auth headers as http client
    this.socket = new SocketClient(wsUrl);
    this.socket.connect({
      headers: this.http.getHeaders() as any,
      rejectUnauthorized: true,
    })
    .ready(() => this.socket.send(MSG_TYPE.CHFOCUS, this.channel)) // connect channel
    .ready(() => this.begin()) // start prompt once ready
    .subscribe(this.receiver); // handle messages
  }

  /* ### PROMPTING ### */

  public async begin() {
    if (!this.tty) {
      const { dim } = this.ui.color;
      // print controls
      this.printControls([
        [dim(CONTROLS.QUIT.join('|')), dim('Signal end of transmission: EOT')],
        [dim(CONTROLS.UPDOWN.join(' ')), dim('Navigate channel messages')],
      ]);
      // open prompt
      this.next();
    }
  }

  /**
   * prompt loop
   */
  public async next(): Promise<void> {
    this._ioClose();
    const tty = this.tty = this.prompt().multiline();
    const input: Chunk[] = await tty;
    await this.process(Prompt.toSingle(input));
    this.next();
  }

  /**
   * process prompt input
   * @param input user inputs
   */
  public async process(input: Chunk): Promise<void> {
    // handle input controls
    if (CONTROLS.QUIT.indexOf(input) > -1) { // quit
      return this._teardown(0);
    }

    // execute
    await this.spawn(input);
  }

  /* ### MESSAGES ### */

  /**
   * websocket receiver
   * @param msg
   */
  private async receiver<T extends MSG_TYPE>(msg: SocketMessage[T]) {
    try {
      await this._deferredExec(); // wait for [child process] to complete
      // TODO: resume prompt
      switch (msg.type) {
        case MSG_TYPE.MSG:
          // 1. fetch the message
          // 2. add to prompt history
          // 3. open prompt
          const m = await this.getMessage(msg.data.message);
          this.prompt().addHistory(m.input);
          this.printMessage(m);
          this.prompt().interface().prompt();
          break;
      }
    } catch (e) {
      this._warn(e);
    }
  }

  /**
   * output the telety message
   * @param msg
   */
  private printMessage(msg: Message) {
    const { dim } = this.ui.color;
    this.ui.output();
    this._sep();
    this.ui
      .output(dim(`# ${messageIdHash(msg)}`))
      .output(msg.input);
    if (msg.meta) {
      this.ui.output(dim(`> ${msg.meta}`));
    }
  }

  /**
   * resolve api endpoint
   * @param uri
   */
  private endpoint(uri: string = ''): string {
    uri = uri ? `/${uri.replace(/^\//, '')}` : '';
    return `${this.auth.endpoint}/channel/${this.channel}/message${uri}`;
  }

  /**
   * load messages in channel to Prompt history
   */
  private async initMessages(): Promise<void> {
    const { printHistory } = this.options;
    const list = await this.http.request<Message[]>(this.endpoint())
      .then(r => r.data);
    // output
    list.forEach(msg => {
      this.prompt().addHistory(msg.input);
      return printHistory && this.printMessage(msg);
    });
  }

  /**
   * get the message by id
   * @param id message id
   */
  private getMessage(id: string): Promise<Message> {
    return this.http.request<Message>(this.endpoint(id))
      .then(r => r.data);
  }

}
