import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { UnitsProvider } from './src/context/UnitsContext';
import RootNavigator from './src/navigation';

function AppContent() {
  const { isDark } = useTheme();
  return (
    <>
      <RootNavigator />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UnitsProvider>
        <AppContent />
      </UnitsProvider>
    </ThemeProvider>
  );
}
