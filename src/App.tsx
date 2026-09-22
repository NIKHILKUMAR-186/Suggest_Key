import { StrictMode } from 'react';
import { AuthProvider } from '@/src/context/AuthContext';
import { NavigationProvider } from '@/src/context/NavigationContext';
import { NotificationProvider } from '@/src/context/NotificationContext';
import { AppShell } from '@/src/components/layout/AppShell';
import { Router } from '@/src/routes/Router';

export default function App() {
  return (
    <StrictMode>
      <AuthProvider>
        <NotificationProvider>
          <NavigationProvider>
            <AppShell>
              <Router />
            </AppShell>
          </NavigationProvider>
        </NotificationProvider>
      </AuthProvider>
    </StrictMode>
  );
}
