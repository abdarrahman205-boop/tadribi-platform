import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { isPhoneDevice } from './lib/deviceMode';

// Phones get a fixed, app-like screen: no pinch or double-tap zoom.
if (isPhoneDevice()) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover');
}

createRoot(document.getElementById('root')!).render(<App />);
