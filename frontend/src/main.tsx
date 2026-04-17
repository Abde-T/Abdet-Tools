import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import { store } from '../timeline-editor/redux/store'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
      <Toaster position="top-right" richColors />
    </Provider>
  </React.StrictMode>,
)
