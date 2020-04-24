import { CONTROLS } from './controls';

export const TELETY = 'telety';

export const REG = {
  LF: /\\$/,
  TRAILSPC: /\s+$/g,
  GUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  COMMENT: new RegExp(`^${CONTROLS.COMMENT}\\s*`),
};

export const HEADERS = {
  XAUTH: 'X-Auth-Token',
}