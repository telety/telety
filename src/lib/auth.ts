
import * as url from 'url';
import { UI as _UI_ } from '@jib/cli';
import { REG, HEADERS } from './constants';
import { Prompt } from './prompt';
import { HttpClient } from './http';

export type AuthnToken = string;
export type AuthzToken = string;
export type AuthUrl = string | url.Url;
export interface AuthResult {
  endpoint: string;
  token: AuthzToken;
}

const UI = new _UI_.Writer();
const HTTP = new HttpClient();

/**
 * get a telety authorization token
 * @param apiUrl a telety api endpoint
 * @param authn telety user auth token
 */
export async function TeletyAuth(apiUrl: AuthUrl, authn?: AuthnToken): Promise<AuthResult> {
  const { TELETY_TOKEN } = process.env;
  const { cyan, yellow, red, green, bold, dim } = UI.color;
  let ant = authn;
  if (ant) { // from flag
    UI.output(red('telety.warn') + ':', `Use ${yellow('TELETY_TOKEN')} environment variable for improved security`);
  } else if (TELETY_TOKEN) { // from env
    ant = TELETY_TOKEN;
  } else { // prompt
    const prompt = Prompt.secure();
    ant = await prompt.question(bold(cyan('Enter auth token: ')));
    prompt.close();
    UI.output();
  }
  // verify guid
  if (!REG.GUID.test(ant || '')) {
    throw new Error('Invalid auth token');
  }

  // request JWT
  const u = typeof apiUrl === 'object' ? apiUrl : url.parse(apiUrl);
  const endpoint = `${u.protocol}//${u.host}`; // TODO: handle API version component
  const tokenURL = `${endpoint}/auth/token`;
  UI.append(dim(`telety.connecting...`));
  try {
    const auth = await HTTP.request(tokenURL, {
      method: 'POST',
      headers: { [HEADERS.XAUTH]: ant },
    });
    UI.output(green('✔'));
    const token = auth.headers[HEADERS.XAUTH.toLowerCase()] as AuthzToken;
    return {
      token,
      endpoint,
    };
  } catch (e) {
    UI.output(red('✘'));
    throw (e);
  }
}
