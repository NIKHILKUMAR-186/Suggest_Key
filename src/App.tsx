import { StrictMode } from 'react';
import { AuthProvider } from '@/src/context/AuthContext';
import { ThemeProvider } from '@/src/context/ThemeContext';
import { NavigationProvider } from '@/src/context/NavigationContext';
import { NotificationProvider } from '@/src/context/NotificationContext';
import { AppShell } from '@/src/components/layout/AppShell';
import { Router } from '@/src/routes/Router';

export default function App() {
  return (
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <NotificationProvider>
            <NavigationProvider>
              <AppShell>
                <Router />
              </AppShell>
            </NavigationProvider>
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>
  );
}
