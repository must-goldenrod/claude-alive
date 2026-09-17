import '@claude-alive/i18n';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadTerminalFont } from './services/terminalFonts.ts'
import { getFontFamily, getSettings } from './services/settings.ts'
import App from './App.tsx'
import { adoptUrlToken, installAuthFetch } from './lib/auth.ts'
import { TokenGate } from './components/TokenGate.tsx'
import { installAppearance } from './services/appearance.ts'

// Before the first render, and before any view fetches: `claude-alive start`
// hands the dashboard its token in the URL once, and every request from here on
// carries whatever token we hold. A local-only server issues none, in which
// case this is a no-op and nothing about the app changes.
adoptUrlToken()
installAuthFetch()
installAppearance()
// Start fetching the chosen terminal face before the first terminal measures its grid.
void loadTerminalFont(getFontFamily(getSettings().terminal.fontFamilyId), getSettings().terminal.fontSize)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TokenGate />
  </StrictMode>,
)
