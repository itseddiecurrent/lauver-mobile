import { View, Text, StyleSheet } from 'react-native';

// TODO: implement name, email, password sign up
export default function SignupScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      <Text style={styles.hint} onPress={() => navigation.navigate('Login')}>
        Already have an account? Sign in
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title:     { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  hint:      { color: '#888' },
});
