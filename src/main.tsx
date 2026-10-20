import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './base.css';
import {RootBoundary} from './ErrorBoundary';
import {PlenaryLiveProvider} from './PlenaryLive';
createRoot(document.getElementById('root')!).render(<StrictMode><RootBoundary><PlenaryLiveProvider><App /></PlenaryLiveProvider></RootBoundary></StrictMode>);
