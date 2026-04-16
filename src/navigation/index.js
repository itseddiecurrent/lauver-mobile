import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../hooks/useAuth';

import LoginScreen          from '../screens/auth/LoginScreen';
import DashboardScreen      from '../screens/dashboard/DashboardScreen';
import ActivitiesScreen     from '../screens/activities/ActivitiesScreen';
import ActivityDetailScreen from '../screens/activities/ActivityDetailScreen';
import CommunityScreen      from '../screens/community/CommunityScreen';
import MatchScreen          from '../screens/match/MatchScreen';
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
  return (
    <Tab.Navigator>
      <Tab.Screen name="Dashboard"  component={DashboardScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Activities" component={ActivitiesStack} options={{ headerShown: false }} />
      <Tab.Screen name="Community"  component={CommunityScreen} />
      <Tab.Screen name="Match"      component={MatchScreen}     />
      <Tab.Screen name="Profile"    component={ProfileScreen}   />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F5F2' }}>
        <ActivityIndicator size="large" color="#E8602C" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        {user
          ? <Stack.Screen name="Main"  component={MainTabs}   />
          : <Stack.Screen name="Login" component={LoginScreen} />
        }
      </Stack.Navigator>
    </NavigationContainer>
  );
}
