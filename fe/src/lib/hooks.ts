import { useState, useEffect, useCallback, useRef } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import {
  fetchConversations,
  streamSearch,
  streamFollowUp,
} from "./api";
import type { ConversationSummary, Source, SearchState } from "./types";

// ─── Separators used in streaming response ───────────────────────────────────
const SOURCES_SEPARATOR = "\n\n---------------- SOURCES ----------------\n";
const CONVERSATION_SEPARATOR =
  "\n\n---------------- CONVERSATION ----------------\n";

// ─── XML Parsing helpers ─────────────────────────────────────────────────────

/** Extract text between <ANSWER>...</ANSWER> tags. */
function parseAnswer(text: string): string {
  const match = text.match(/<ANSWER>([\s\S]*?)<\/ANSWER>/);
  return match ? match[1].trim() : text;
}

/** Extract all <question>...</question> values inside <FOLLOW_UPS>. */
function parseFollowUps(text: string): string[] {
  const block = text.match(/<FOLLOW_UPS>([\s\S]*?)<\/FOLLOW_UPS>/);
  if (!block) return [];
  const questions: string[] = [];
  const re = /<question>([\s\S]*?)<\/question>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1])) !== null) {
    const q = m[1].trim();
    if (q) questions.push(q);
  }
  return questions;
}

// ─── useAuth ─────────────────────────────────────────────────────────────────

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get the initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  return { user, session, loading, signOut };
}

// ─── useConversations ────────────────────────────────────────────────────────

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { conversations, loading, refetch };
}

// ─── useStreamingSearch ──────────────────────────────────────────────────────

const INITIAL_STATE: SearchState = {
  answer: "",
  sources: [],
  followUps: [],
  conversationId: null,
  isSearching: false,
  isStreaming: false,
  error: null,
};

export function useStreamingSearch() {
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Process a streaming Response, parsing chunks in real-time.
   */
  const processStream = useCallback(async (response: Response) => {
    if (!response.ok) {
      setState((prev) => ({
        ...prev,
        isSearching: false,
        isStreaming: false,
        error: `Request failed: ${response.status} ${response.statusText}`,
      }));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setState((prev) => ({
        ...prev,
        isSearching: false,
        isStreaming: false,
        error: "No response body",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      isSearching: false,
      isStreaming: true,
    }));

    const decoder = new TextDecoder();
    let fullText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fullText += decoder.decode(value, { stream: true });

        // Check for SOURCES separator to determine where the LLM text ends
        const sourcesIdx = fullText.indexOf(SOURCES_SEPARATOR);
        const conversationIdx = fullText.indexOf(CONVERSATION_SEPARATOR);

        let llmText: string;
        let sources: Source[] = [];
        let conversationId: string | null = null;

        if (sourcesIdx === -1) {
          // Still receiving LLM text
          llmText = fullText;
        } else {
          // LLM text is everything before the sources separator
          llmText = fullText.substring(0, sourcesIdx);

          // Parse sources (between SOURCES and CONVERSATION separators)
          const sourcesStart = sourcesIdx + SOURCES_SEPARATOR.length;
          const sourcesEnd =
            conversationIdx !== -1 ? conversationIdx : fullText.length;
          const sourcesText = fullText.substring(sourcesStart, sourcesEnd).trim();

          if (sourcesText) {
            sources = sourcesText
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => {
                try {
                  return JSON.parse(line) as Source;
                } catch {
                  return null;
                }
              })
              .filter((s): s is Source => s !== null);
          }

          // Parse conversation ID
          if (conversationIdx !== -1) {
            const convText = fullText
              .substring(conversationIdx + CONVERSATION_SEPARATOR.length)
              .trim();
            if (convText) {
              try {
                const parsed = JSON.parse(convText);
                conversationId = parsed.conversationId ?? null;
              } catch {
                // Still receiving conversation data
              }
            }
          }
        }

        // Parse XML tags from the LLM text
        const answer = parseAnswer(llmText);
        const followUps = parseFollowUps(llmText);

        setState((prev) => ({
          ...prev,
          answer,
          sources,
          followUps,
          conversationId: conversationId ?? prev.conversationId,
        }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState((prev) => ({
          ...prev,
          error: (err as Error).message,
        }));
      }
    } finally {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
      }));
    }
  }, []);

  /**
   * Start a new search.
   */
  const search = useCallback(
    async (query: string) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setState({
        ...INITIAL_STATE,
        isSearching: true,
      });

      try {
        const response = await streamSearch(query);
        await processStream(response);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState((prev) => ({
            ...prev,
            isSearching: false,
            isStreaming: false,
            error: (err as Error).message,
          }));
        }
      }
    },
    [processStream],
  );

  /**
   * Send a follow-up question to an existing conversation.
   */
  const followUp = useCallback(
    async (conversationId: string, query: string) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setState((prev) => ({
        ...INITIAL_STATE,
        conversationId: prev.conversationId,
        isSearching: true,
      }));

      try {
        const response = await streamFollowUp(conversationId, query);
        await processStream(response);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState((prev) => ({
            ...prev,
            isSearching: false,
            isStreaming: false,
            error: (err as Error).message,
          }));
        }
      }
    },
    [processStream],
  );

  return {
    ...state,
    search,
    followUp,
  };
}
