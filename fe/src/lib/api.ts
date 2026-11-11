import axios from "axios";
import { BACKEND_URL } from "../../config";
import { supabase } from "./client";
import type { Conversation, ConversationSummary } from "./types";

/**
 * Get the current session's JWT access token.
 */
async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Create an axios instance with auth headers injected.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Fetch the list of conversations for the current user.
 */
export async function fetchConversations(): Promise<ConversationSummary[]> {
  const headers = await authHeaders();
  const { data } = await axios.get<ConversationSummary[]>(
    `${BACKEND_URL}/conversations`,
    { headers },
  );
  return data;
}

/**
 * Fetch a single conversation by ID, including its messages.
 */
export async function fetchConversation(
  conversationId: string,
): Promise<Conversation> {
  const headers = await authHeaders();
  const { data } = await axios.get<Conversation>(
    `${BACKEND_URL}/conversation/${conversationId}`,
    { headers },
  );
  return data;
}

/**
 * Start a new streaming search. Returns the raw Response for streaming.
 */
export async function streamSearch(query: string): Promise<Response> {
  const headers = await authHeaders();
  return fetch(`${BACKEND_URL}/perplexity_ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ query }),
  });
}

/**
 * Send a follow-up query to an existing conversation. Returns raw Response for streaming.
 */
export async function streamFollowUp(
  conversationId: string,
  query: string,
): Promise<Response> {
  const headers = await authHeaders();
  return fetch(`${BACKEND_URL}/purplexity_ask/follow_up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ conversationId, query }),
  });
}
