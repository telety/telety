
import * as url from 'url';
import { UI as _UI_ } from '@jib/cli';
import { REG, HEADERS } from './constants';
import { Prompt } from './prompt';
import { HttpClient } from './http';

export type AuthnToken = string;
export type AuthzToken = string;

const UI = new _UI_.Writer();
const HTTP = new HttpClient();

/**
 * get a telety authorization token
 * @param apiUrl a telety api endpoint
 * @param authn telety user auth token
 */
export async function TeletyAuth(apiUrl: string | url.Url, authn?: AuthnToken): Promise<AuthzToken> {
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
  const tokenURL = `${u.protocol}//${u.host}/auth/token`;
  UI.append(dim(`telety.connecting...`));
  try {
    const auth = await HTTP.request(tokenURL, {
      method: 'POST',
      headers: { [HEADERS.XAUTH]: ant },
    });
    UI.append(green('✔'));
    return auth.headers[HEADERS.XAUTH.toLowerCase()] as string;
  } catch (e) {
    UI.append(red('✘')).output();
    throw (e);
  }
}
