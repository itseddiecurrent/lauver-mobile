import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import {
  getMessages,
  sendMessage,
  markRead,
  subscribeToMessages,
  subscribeToReadReceipts,
} from '../lib/chat';

/**
 * Manages the message state for a single chat session.
 *
 * @param {string} matchId   - UUID of the match row
 * @param {string} otherId   - Firebase UID of the other participant (for read receipts)
 */
export function useChat(matchId, otherId) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [messages,   setMessages]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [inputText,  setInputText]  = useState('');

  const msgChannel    = useRef(null);
  const readChannel   = useRef(null);
  const knownIds      = useRef(new Set());

  // ── load history + mark read + subscribe ──────────────────────────────────
  useEffect(() => {
    if (!uid || !matchId) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const history = await getMessages(uid, matchId);
        if (cancelled) return;
        history.forEach(m => knownIds.current.add(m.id));
        setMessages(history);
        await markRead(uid, matchId).catch(() => {});
      } catch {
        // leave messages empty on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // new messages
    msgChannel.current = subscribeToMessages(matchId, (newMsg) => {
      if (knownIds.current.has(newMsg.id)) return;
      knownIds.current.add(newMsg.id);
      setMessages(prev => [...prev, newMsg]);
      // mark read immediately if we're looking at the chat
      if (newMsg.sender_id !== uid) {
        markRead(uid, matchId).catch(() => {});
      }
    });

    // read receipts — refresh messages so read_at timestamps update
    readChannel.current = subscribeToReadReceipts(matchId, () => {
      getMessages(uid, matchId)
        .then(updated => setMessages(updated))
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      if (msgChannel.current)  { supabase.removeChannel(msgChannel.current);  msgChannel.current  = null; }
      if (readChannel.current) { supabase.removeChannel(readChannel.current); readChannel.current = null; }
    };
  }, [uid, matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── send ──────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !uid || sending) return;

    setInputText('');
    setSending(true);

    // optimistic message
    const optimistic = {
      id:        `opt-${Date.now()}`,
      match_id:  matchId,
      sender_id: uid,
      body:      text,
      sent_at:   new Date().toISOString(),
      read_at:   null,
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const saved = await sendMessage(uid, matchId, text);
      // replace optimistic with real row
      setMessages(prev => prev.map(m => m.id === optimistic.id ? saved : m));
      knownIds.current.add(saved.id);
    } catch {
      // rollback
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInputText(text);
    } finally {
      setSending(false);
    }
  }, [uid, matchId, inputText, sending]);

  return {
    messages,
    loading,
    sending,
    inputText,
    setInputText,
    send,
  };
}

