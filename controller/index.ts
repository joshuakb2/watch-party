import { render } from 'solid-js/web';
import { App } from './App';

const root = document.querySelector('#root');
if (!root) throw new Error('No root div!!!');

render(App, root);
