import { VERSION } from '../../version';
import { bootstrapMcpUiApp } from '../views';
import './styles.css';

await bootstrapMcpUiApp({
  name: 'houjin-bangou-search-results',
  version: VERSION,
  defaultMode: 'search-results',
});
