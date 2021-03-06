import * as URL from 'url';
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';


export type HttpOptions = (http.RequestOptions | https.RequestOptions) & {
  body?: any,
  query?: any,
}

export interface HttpResponse<T = any> {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  data: T;
}

/**
 * Simple http client for API requests
 */
export class HttpClient {

  private readonly _defaults: Partial<HttpOptions> = {};
  /**
   * Configure client
   */
  constructor() {
  }

  public configure(options: Partial<HttpOptions>): this {
    const { headers = {} } = this._defaults;
    Object.assign(this._defaults, options);
    Object.assign(headers, options.headers || {});
    return this;
  }

  public getHeaders(): http.OutgoingHttpHeaders {
    return this._defaults.headers || {};
  }

  /**
   * Make an signed API request
   * @param {string} url - Https API URL
   * @param {HttpOptions} [options] - https request options @see https://nodejs.org/api/https.html#https_https_request_url_options_callback
   * @returns {Promise<HttpResponse>}
   */
  public request<T = any>(url: string, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
      // process options
      options = {
        ...this._defaults,
        ...options,
      };
      let { body } = options;
      const { query } = options;

      // setup request url
      const u = URL.parse(url);
      const lib = u.protocol === 'https:' ? https : http;
      if (typeof query === 'object') {
        url = `${u.protocol}//${u.host}${u.path}?${querystring.stringify(Object.assign(query, u.query || {}))}`;
      }

      // start request
      const request = lib.request(url, options, response => {
        let data = '';
        // handle response
        response
          .on('data', chunk => data += chunk)
          .on('end', () => {
            const { headers, statusCode } = response;
            // parse json
            if (~headers['content-type'].indexOf('application/json')) {
              data = JSON.parse(data);
            }
            const res: HttpResponse = { statusCode, headers, data };
            // handle Promise resolution
            if (/^2/.test('' + statusCode)) {
              resolve(res);
            } else {
              const err: any = new Error(`${response.statusCode}: ${response.statusMessage}`);
              err.response = res;
              reject(err);
            }
          })
      }).on('error', reject);
      // handle body
      if (body) {
        if (typeof body === 'object') {
          body = JSON.stringify(body);
          request.setHeader('content-type', 'application/json');
        }
        request.setHeader('content-length', body.length);
      }

      // send
      request.end(body || undefined);
    });
  }
}
