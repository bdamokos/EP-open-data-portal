import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './base.css';
import {RootBoundary} from './ErrorBoundary';
createRoot(document.getElementById('root')!).render(<StrictMode><RootBoundary><App /></RootBoundary></StrictMode>);
