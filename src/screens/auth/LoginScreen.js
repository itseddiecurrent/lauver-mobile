import { View, Text, StyleSheet } from 'react-native';

// TODO: implement email/password sign in + Google OAuth
export default function LoginScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.hint} onPress={() => navigation.navigate('Signup')}>
        No account? Sign up
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title:     { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  hint:      { color: '#888' },
});
