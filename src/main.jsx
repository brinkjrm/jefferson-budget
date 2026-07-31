import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import LegalPage from './components/LegalPage.jsx'
import OwnerAccessGate from './components/OwnerAccessGate.jsx'
import SharedProjectPage from './components/SharedProjectPage.jsx'
import { ProjectProvider } from './context/ProjectContext.jsx'

function decodeToken(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function Root() {
  const path = window.location.pathname.replace(/\/$/, '')
  if (path === '/privacy') return <LegalPage page="privacy" />
  if (path === '/terms') return <LegalPage page="terms" />

  const sharedProject = window.location.pathname.match(/^\/shared-project\/([^/]+)\/?$/)
  if (sharedProject) return <SharedProjectPage token={decodeToken(sharedProject[1])} />

  const sharedPlans = window.location.pathname.match(/^\/shared-plans\/([^/]+)\/?$/)
  if (sharedPlans) return <SharedProjectPage token={decodeToken(sharedPlans[1])} initialTab="Plans" />

  return (
    <OwnerAccessGate>
      <ProjectProvider>
        <App />
      </ProjectProvider>
    </OwnerAccessGate>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
