import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, SafeAreaView, Image, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useMemo, useRef, useEffect } from 'react';
import { useChat } from '../../hooks/useChat';
import { unmatch } from '../../lib/match';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../hooks/useAuth';

function avatarColor(name = '') {
  const colors = ['#E8602C', '#5a9e6f', '#7b5ea7', '#3a7ec8', '#c07a3a'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatScreen({ route, navigation }) {
  const { matchId, matchedWith } = route.params;
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const { messages, loading, sending, inputText, setInputText, send } = useChat(matchId, matchedWith?.id);

  const flatRef = useRef(null);

  // scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  function confirmUnmatch() {
    Alert.alert(
      'Unmatch',
      `Are you sure you want to unmatch ${matchedWith?.name ?? 'this person'}? You won't be able to message each other anymore.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            await unmatch(uid, matchId);
            navigation.goBack();
          },
        },
      ],
    );
  }

  function renderMessage({ item }) {
    const mine = item.sender_id === uid;
    const isOptimistic = item.id?.startsWith('opt-');
    const readStr = !mine && item.read_at ? `Read ${formatTime(item.read_at)}` : null;

    return (
      <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, isOptimistic && styles.bubbleOptimistic]}>
          <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
            {item.body}
          </Text>
        </View>
        <View style={[styles.msgMeta, mine ? styles.msgMetaMine : styles.msgMetaOther]}>
          <Text style={styles.metaTime}>{formatTime(item.sent_at)}</Text>
          {mine && item.read_at && <Text style={styles.metaRead}>✓✓</Text>}
          {mine && !item.read_at && !isOptimistic && <Text style={styles.metaSent}>✓</Text>}
        </View>
      </View>
    );
  }

  const name  = matchedWith?.name  ?? 'Athlete';
  const photo = matchedWith?.photo ?? null;

  return (
    <SafeAreaView style={styles.root}>
      {/* header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>

        {photo ? (
          <Image source={{ uri: photo }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, { backgroundColor: avatarColor(name), justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <Text style={styles.headerName}>{name}</Text>

        <TouchableOpacity onPress={confirmUnmatch} style={styles.unmatchBtn} activeOpacity={0.7}>
          <Text style={styles.unmatchIcon}>···</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={c.ORANGE} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={flatRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>You matched! Say something 👋</Text>
              </View>
            }
          />

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message..."
              placeholderTextColor={c.TEXT_FAINT}
              multiline
              maxLength={1000}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!inputText.trim() || sending}
              activeOpacity={0.8}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.sendBtnText}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    root:        { flex: 1, backgroundColor: c.BG },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: c.DIVIDER,
      gap: 10,
    },
    backBtn:      { padding: 4 },
    backIcon:     { fontSize: 28, color: c.TEXT, lineHeight: 30 },
    headerAvatar: { width: 38, height: 38, borderRadius: 19 },
    headerName:   { flex: 1, fontSize: 16, fontWeight: '800', color: c.TEXT },
    unmatchBtn:   { padding: 8 },
    unmatchIcon:  { fontSize: 20, color: c.TEXT_MUTED, letterSpacing: 2 },

    listContent: { padding: 12, paddingBottom: 8, flexGrow: 1, justifyContent: 'flex-end' },

    msgRow:      { marginBottom: 6 },
    msgRowMine:  { alignItems: 'flex-end' },
    msgRowOther: { alignItems: 'flex-start' },

    bubble:          { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
    bubbleMine:      { backgroundColor: c.ORANGE, borderBottomRightRadius: 4 },
    bubbleOther:     { backgroundColor: c.CARD_BG, borderBottomLeftRadius: 4 },
    bubbleOptimistic:{ opacity: 0.7 },
    bubbleText:      { fontSize: 15, lineHeight: 21 },
    bubbleTextMine:  { color: '#fff' },
    bubbleTextOther: { color: c.TEXT },

    msgMeta:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, paddingHorizontal: 4 },
    msgMetaMine:  { justifyContent: 'flex-end' },
    msgMetaOther: { justifyContent: 'flex-start' },
    metaTime:     { fontSize: 10, color: c.TEXT_FAINT },
    metaRead:     { fontSize: 10, color: c.ORANGE, fontWeight: '700' },
    metaSent:     { fontSize: 10, color: c.TEXT_FAINT },

    emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
    emptyText: { fontSize: 14, color: c.TEXT_MUTED, textAlign: 'center' },

    inputRow: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: 12, paddingVertical: 10,
      borderTopWidth: 1, borderTopColor: c.DIVIDER,
      gap: 8,
    },
    input: {
      flex: 1,
      backgroundColor: c.CARD_BG,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontSize: 15,
      color: c.TEXT,
      maxHeight: 120,
    },
    sendBtn:         { width: 44, height: 44, borderRadius: 22, backgroundColor: c.ORANGE, justifyContent: 'center', alignItems: 'center' },
    sendBtnDisabled: { backgroundColor: c.DIVIDER },
    sendBtnText:     { fontSize: 20, color: '#fff', fontWeight: '900' },
  });
}
