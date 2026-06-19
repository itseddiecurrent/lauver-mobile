/**
 * Supabase query functions for the Chat feature.
 * All reads go through SECURITY DEFINER RPC functions (Firebase OIDC bypass).
 *
 * DB schema: messages table — see supabase/migrations/20260619_match_schema.sql
 * RPC funcs:  see supabase/migrations/20260619_match_rpc.sql
 */

import { supabase } from './supabase';

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * Returns all messages for a match in chronological order.
 * Verifies the caller is a participant of an active (not unmatched) match.
 */
export async function getMessages(userId, matchId) {
  const { data, error } = await supabase.rpc('get_messages', {
    uid:        userId,
    p_match_id: matchId,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Sends a message. Returns the new message row.
 * Throws if caller is not a participant or match is inactive.
 */
export async function sendMessage(userId, matchId, body) {
  const { data, error } = await supabase.rpc('send_message', {
    uid:        userId,
    p_match_id: matchId,
    p_body:     body.trim(),
  });
  if (error) throw error;
  return data;
}

/**
 * Marks all messages from the other person in this match as read.
 * Called when the user opens the chat screen.
 */
export async function markRead(userId, matchId) {
  const { error } = await supabase.rpc('mark_messages_read', {
    uid:        userId,
    p_match_id: matchId,
  });
  if (error) throw error;
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

/**
 * Subscribes to new messages in a match via Supabase Realtime.
 * Returns the channel — caller must call supabase.removeChannel(channel) on unmount.
 *
 * @param {string} matchId
 * @param {(message: object) => void} onInsert
 */
export function subscribeToMessages(matchId, onInsert) {
  const channel = supabase
    .channel(`messages:${matchId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'messages',
        filter: `match_id=eq.${matchId}`,
      },
      payload => onInsert(payload.new),
    )
    .subscribe();

  return channel;
}

/**
 * Subscribes to UPDATE events on the messages table for a match.
 * Used to detect when the other person marks messages as read (read_at set).
 *
 * @param {string} matchId
 * @param {() => void} onReadUpdate
 */
export function subscribeToReadReceipts(matchId, onReadUpdate) {
  const channel = supabase
    .channel(`messages_read:${matchId}`)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'messages',
        filter: `match_id=eq.${matchId}`,
      },
      () => onReadUpdate(),
    )
    .subscribe();

  return channel;
}
