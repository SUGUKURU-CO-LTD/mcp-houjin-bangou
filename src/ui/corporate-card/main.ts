import { VERSION } from '../../version';
import { bootstrapMcpUiApp } from '../views';
import './styles.css';

await bootstrapMcpUiApp({
  name: 'houjin-bangou-corporate-card',
  version: VERSION,
  defaultMode: 'corporate-card',
});
