import 'styled-components';
import type { AppTheme } from './theme';

/**
 * Makes `props.theme` fully typed inside every styled component, so a typo in
 * a token name is a build failure rather than a silent `undefined` that
 * renders as a transparent colour.
 */
declare module 'styled-components' {
  // The empty body is the point: this interface exists purely to merge
  // AppTheme into styled-components' DefaultTheme.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefaultTheme extends AppTheme {}
}
