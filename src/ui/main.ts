import { VERSION } from '../version';
import { bootstrapMcpUiApp, type DefaultUiMode } from './views';
import './styles.css';

const modeAttr = document.documentElement.dataset['defaultMode'];
const defaultMode: DefaultUiMode =
  modeAttr === 'search-results' ? 'search-results' : 'corporate-card';

await bootstrapMcpUiApp({
  name:
    defaultMode === 'search-results'
      ? 'houjin-bangou-search-results'
      : 'houjin-bangou-corporate-card',
  version: VERSION,
  defaultMode,
});
