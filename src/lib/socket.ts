import * as WebSocket from 'ws';
import { UI } from '@jib/cli';
import { TELETY } from './constants';

function heartbeat() {
  clearTimeout(this.ptimeout);
  this.ptimeout = setTimeout(() => {
    this.terminate();
  }, 3e4 + 2e3 ) // server ping + 2s
}

export enum MSG_TYPE {
  // channel
  CHFOCUS =  'channel:focus',
  CHBLUR  =  'channel:blur',
  // messages
  MSG =      'message',
  MSGDEL =   'message:delete',
};

export type BaseMessage<T = any> = {
  type: MSG_TYPE;
  data: T;
};

export interface SocketMessage extends Record<MSG_TYPE, BaseMessage> {
  [MSG_TYPE.MSG]: BaseMessage<{message: string}>;
  [MSG_TYPE.MSGDEL]: BaseMessage<{message: string}>;
}

export type SocketListener<T extends MSG_TYPE = MSG_TYPE.MSG> = (msg: SocketMessage[T]) => void;

export class SocketClient {
  private ws: WebSocket;
  private cbs = new Set<any>();
  private subs = new Set<SocketListener>();
  private ui = new UI.Writer();
  private _ready: Promise<this>;
  constructor(public readonly url: string) {
    process.on('SIGINT', () => this._shutdown());
  }

  public interface(): WebSocket {
    return this.ws;
  }

  public connect(options?: WebSocket.ClientOptions): this {
    const self = this;
    const { red, green } = this.ui.color;
    const recon = () => setTimeout(() => this.connect(options), 2e3);
    this.ws = new WebSocket(this.url, options);
    this.ws
      .on('open', heartbeat)
      .on('ping', heartbeat)
      .on('open', function open() {
        // self._status(green('OPEN'));
        self.subs.forEach(s => this.on('message', s)); // add subscriptions
        self.cbs.forEach(cb => cb()); // trigger ready callbacks
      })
      // .on('error', e => self._status(red('ERROR'), e.message))
      .on('close', function clear() {
        self._status(red('CLOSED'));
        clearTimeout((this as any).ptimeout);
        recon();
      });
    return this;
  }

  public subscribe<T extends MSG_TYPE = any>(listener: SocketListener<T>): this {
    this.subs.add(msg => listener(this._postCondition(msg as any)));
    return this;
  }

  public ready(cb: SocketListener): this {
    this.cbs.add(cb);
    return this;
  }

  public send(type: MSG_TYPE, data: any = ''): void {
    return this.ws.send(JSON.stringify({ type, data }));
  }

  private _postCondition<T extends MSG_TYPE>(msg: string): SocketMessage[T] {
    try {
      return JSON.parse(msg);
    } catch (e) {
      return msg as any;
    }
  }

  private _status(...status: string[]): void {
    const { dim } = this.ui.color;
    this.ui.output(dim(`${TELETY}.socket`), ...status);
  }

  private _shutdown(): void {
    return this.ws && this.ws.terminate();
  }
}
