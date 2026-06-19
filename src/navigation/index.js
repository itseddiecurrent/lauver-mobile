import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';

import LoginScreen          from '../screens/auth/LoginScreen';
import DashboardScreen      from '../screens/dashboard/DashboardScreen';
import ActivitiesScreen     from '../screens/activities/ActivitiesScreen';
import ActivityDetailScreen from '../screens/activities/ActivityDetailScreen';
import LogActivityScreen    from '../screens/activities/LogActivityScreen';
import CommunityScreen      from '../screens/community/CommunityScreen';
import MatchScreen          from '../screens/match/MatchScreen';
import ChatScreen           from '../screens/match/ChatScreen';
import ProfileScreen        from '../screens/profile/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function ActivitiesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ActivitiesList" component={ActivitiesScreen}     options={{ title: 'Activities' }} />
      <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} options={{ title: 'Activity' }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  const { colors: c } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle:             { backgroundColor: c.BG, borderTopColor: c.DIVIDER },
        tabBarActiveTintColor:   c.ORANGE,
        tabBarInactiveTintColor: c.TEXT_MUTED,
        headerStyle:             { backgroundColor: c.BG },
        headerTintColor:         c.TEXT,
        headerShadowVisible:     false,
      }}
    >
      <Tab.Screen name="Dashboard"  component={DashboardScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Activities" component={ActivitiesStack} options={{ headerShown: false }} />
      <Tab.Screen name="Community"  component={CommunityScreen} />
      <Tab.Screen name="Match"      component={MatchScreen}     />
      <Tab.Screen name="Profile"    component={ProfileScreen}   />
    </Tab.Navigator>
  );
}

// LogActivity is a modal at the MainApp level so both Dashboard and Activities can reach it.
function MainApp() {
  const { colors: c } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={MainTabs} />
      <Stack.Screen
        name="LogActivity"
        component={LogActivityScreen}
        options={{
          headerShown:  false,
          presentation: 'modal',
          animation:    'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();
  const { colors: c, isDark } = useTheme();

  const navTheme = isDark
    ? { ...DarkTheme,    colors: { ...DarkTheme.colors,    background: c.BG, card: c.BG, border: c.DIVIDER, text: c.TEXT } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: c.BG, card: c.BG, border: c.DIVIDER, text: c.TEXT } };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.BG }}>
        <ActivityIndicator size="large" color="#E8602C" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        {user
          ? <Stack.Screen name="Main"  component={MainApp}    />
          : <Stack.Screen name="Login" component={LoginScreen} />
        }
      </Stack.Navigator>
    </NavigationContainer>
  );
}
