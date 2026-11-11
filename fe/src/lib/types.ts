export interface Source {
  title: string;
  url: string;
  content: string;
  score: number;
  rawContent: string;
}

export interface Message {
  id: string;
  content: string;
  role: "User" | "Assistant";
  conversationId: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  slug: string;
  messages: Message[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  slug: string;
  messages: { content: string; createdAt: string }[];
}

export interface SearchState {
  answer: string;
  sources: Source[];
  followUps: string[];
  conversationId: string | null;
  isSearching: boolean;
  isStreaming: boolean;
  error: string | null;
}
