import { createClient } from "@/lib/client";
import type { User } from "@supabase/supabase-js";
import {
  ArrowRight,
  BookOpen,
  Compass,
  Home,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BACKEND_URL } from "../../config";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConversationSummary {
  id: string;
  title: string;
  slug: string;
  messages: { content: string; createdAt: string }[];
}

interface Source {
  title: string;
  url: string;
  content: string;
}

interface ThreadTurn {
  query: string;
  answer: string;
  sources: Source[];
  isStreaming?: boolean;
}

interface ActiveConversation {
  id: string;
  title: string;
  turns: ThreadTurn[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const supabase = createClient();

async function getJwt(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function getFavicon(url: string): string {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return "";
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Very lightweight markdown → HTML renderer (no external deps)
function renderMarkdown(md: string, sources: Source[] = []): string {
  // Build a URL→index map for citation linking
  const sourceIndexMap = new Map<string, number>();
  sources.forEach((s, i) => sourceIndexMap.set(s.url, i + 1));

  return md
    // fenced code blocks
    .replace(
      /```(\w*)\n?([\s\S]*?)```/g,
      (_m, _lang, code) =>
        `<pre class="bg-[#161818] rounded-lg p-4 overflow-x-auto text-sm my-3 text-emerald-200"><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`
    )
    // inline code
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-[#2a2c2c] text-emerald-300 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>'
    )
    // citation markers like [1], [2] — make them superscript badges
    .replace(
      /\[(\d+)\]/g,
      '<sup><a href="#source-$1" class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#2a3a3a] hover:bg-teal-700 text-[9px] font-bold text-teal-300 hover:text-white no-underline transition-colors cursor-pointer ml-0.5" style="text-decoration:none">$1</a></sup>'
    )
    // bold
    .replace(/\*\*(.+?)\*\*/g, "<strong class=\"font-semibold text-zinc-100\">$1</strong>")
    // italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // headings
    .replace(
      /^#{3}\s(.+)$/gm,
      '<h3 class="text-base font-semibold text-zinc-100 mt-5 mb-2">$1</h3>'
    )
    .replace(
      /^#{2}\s(.+)$/gm,
      '<h2 class="text-lg font-semibold text-zinc-100 mt-6 mb-2">$1</h2>'
    )
    .replace(
      /^#{1}\s(.+)$/gm,
      '<h1 class="text-xl font-bold text-zinc-100 mt-6 mb-2">$1</h1>'
    )
    // unordered list items
    .replace(
      /^[-*]\s(.+)$/gm,
      '<li class="ml-4 list-disc text-zinc-300 leading-7">$1</li>'
    )
    // ordered list items
    .replace(
      /^\d+\.\s(.+)$/gm,
      '<li class="ml-4 list-decimal text-zinc-300 leading-7">$1</li>'
    )
    // wrap adjacent <li> tags
    .replace(/((<li[^>]*>.*?<\/li>\n?)+)/g, '<ul class="my-3 space-y-1.5 pl-1">$1</ul>')
    // paragraph breaks
    .replace(/\n{2,}/g, "</p><p class=\"text-zinc-300 leading-7 mt-3\">")
    // line breaks
    .replace(/\n/g, "<br/>")
    // wrap in paragraph
    .replace(
      /^(.)/,
      '<p class="text-zinc-300 leading-7">$1'
    )
    .concat("</p>");
}

// Parse the chunked stream into { answer, sources, conversationId }
async function parseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => void,
  onSources: (sources: Source[]) => void,
  onConversationId: (id: string) => void
) {
  const decoder = new TextDecoder();
  const SOURCE_DELIM = "---------------- SOURCES ----------------";
  const CONV_DELIM = "---------------- CONVERSATION ----------------";

  let buffer = "";
  let phase: "answer" | "sources" | "conversation" = "answer";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    if (phase === "answer") {
      const delimIdx = buffer.indexOf(SOURCE_DELIM);
      if (delimIdx !== -1) {
        // flush everything before the delimiter as answer text
        const answerPart = buffer.slice(0, delimIdx).replace(/\n\n$/, "");
        if (answerPart) onChunk(answerPart);
        buffer = buffer.slice(delimIdx + SOURCE_DELIM.length);
        phase = "sources";
      } else {
        // Stream answer text in real-time (keep last partial line in buffer)
        const lastNl = buffer.lastIndexOf("\n");
        if (lastNl !== -1) {
          onChunk(buffer.slice(0, lastNl + 1));
          buffer = buffer.slice(lastNl + 1);
        }
      }
    }

    if (phase === "sources") {
      const delimIdx = buffer.indexOf(CONV_DELIM);
      const sourcePart = delimIdx !== -1 ? buffer.slice(0, delimIdx) : buffer;

      const lines = sourcePart.split("\n").filter((l) => l.trim());
      const sources: Source[] = [];
      for (const line of lines) {
        try {
          sources.push(JSON.parse(line));
        } catch {
          /* skip malformed */
        }
      }
      if (sources.length) onSources(sources);

      if (delimIdx !== -1) {
        buffer = buffer.slice(delimIdx + CONV_DELIM.length);
        phase = "conversation";
      } else {
        buffer = "";
      }
    }

    if (phase === "conversation" && buffer.trim()) {
      try {
        const json = JSON.parse(buffer.trim());
        if (json.conversationId) onConversationId(json.conversationId);
        buffer = "";
      } catch {
        /* wait for more data */
      }
    }
  }

  // Final flush for sources-only streams (follow-up has no CONVERSATION block)
  if (phase === "sources" && buffer.trim()) {
    const lines = buffer.split("\n").filter((l) => l.trim());
    const sources: Source[] = [];
    for (const line of lines) {
      try {
        sources.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    if (sources.length) onSources(sources);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceCard({ source, index }: { source: Source; index: number }) {
  const favicon = getFavicon(source.url);
  const domain = getDomain(source.url);
  return (
    <a
      id={`source-${index}`}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-2 p-3 rounded-xl bg-[#1e2020] border border-[#2d2f2f] hover:border-teal-700/50 hover:bg-[#222424] transition-all group cursor-pointer"
    >
      {/* Top row: index badge + domain */}
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#2a3535] text-teal-400 text-[10px] font-bold flex items-center justify-center">
          {index}
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          {favicon && (
            <img
              src={favicon}
              alt=""
              className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <span className="text-[10px] text-zinc-500 truncate group-hover:text-teal-500 transition-colors">{domain}</span>
        </div>
      </div>
      {/* Title */}
      <p className="text-xs text-zinc-300 font-medium line-clamp-2 group-hover:text-zinc-100 transition-colors leading-4">
        {source.title}
      </p>
      {/* Snippet */}
      {source.content && (
        <p className="text-[10px] text-zinc-500 line-clamp-2 leading-3.5 mt-auto">
          {source.content.slice(0, 120)}…
        </p>
      )}
    </a>
  );
}

function AnswerBlock({ html, isStreaming }: { html: string; isStreaming?: boolean }) {
  return (
    <div className="relative">
      <div
        className="prose-custom text-zinc-300 text-sm leading-7"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isStreaming && (
        <span className="inline-block w-1.5 h-4 bg-teal-400 rounded-sm animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  );
}

function TurnView({ turn }: { turn: ThreadTurn }) {
  const hasSources = turn.sources.length > 0;
  const showSourceSkeletons = turn.isStreaming && !hasSources;

  return (
    <div className="flex flex-col gap-7 py-8 border-b border-[#242626] last:border-0">
      {/* ── User Query ── */}
      <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight leading-snug">
        {turn.query}
      </h2>

      {/* ── Sources Section ── */}
      {(hasSources || showSourceSkeletons) && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            <BookOpen size={12} />
            Sources
          </div>

          {hasSources ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {turn.sources.slice(0, 6).map((s, i) => (
                <SourceCard key={i} source={s} index={i + 1} />
              ))}
              {turn.sources.length > 6 && (
                <div className="flex items-center justify-center rounded-xl bg-[#1e2020] border border-[#2d2f2f] text-xs text-zinc-500 p-3 font-medium">
                  +{turn.sources.length - 6} more
                </div>
              )}
            </div>
          ) : (
            /* Skeleton placeholders while streaming */
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-xl bg-[#1e2020] border border-[#2d2f2f] animate-pulse"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AI Answer Section ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          <Sparkles size={12} className="text-teal-400" />
          <span>Answer</span>
        </div>

        {turn.answer ? (
          <div className="border-l-2 border-teal-700/40 pl-4">
            <AnswerBlock
              html={renderMarkdown(turn.answer, turn.sources)}
              isStreaming={turn.isStreaming}
            />
          </div>
        ) : turn.isStreaming ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 pl-4">
            <Loader2 size={14} className="animate-spin text-teal-400" />
            Searching the web…
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Auto-resize textarea hook ────────────────────────────────────────────────

function useAutoResize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);
  return ref;
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConv, setActiveConv] = useState<ActiveConversation | null>(null);
  const [activeNav, setActiveNav] = useState<"home" | "discover" | "library">("home");

  const [homeInput, setHomeInput] = useState("");
  const [followUpInput, setFollowUpInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const homeTextareaRef = useAutoResize(homeInput);
  const followUpTextareaRef = useAutoResize(followUpInput);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── Auth & initial load ──────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUser(data.user);
      } else {
        navigate("/auth");
      }
    })();
  }, [navigate]);

  const fetchConversations = useCallback(async () => {
    const jwt = await getJwt();
    if (!jwt) return;
    try {
      const res = await fetch(`${BACKEND_URL}/conversations`, {
        headers: { Authorization: jwt },
      });
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  }, []);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user, fetchConversations]);

  // ── Scroll thread to bottom ──────────────────────────────────────────────

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.turns]);

  // ── Load a conversation from sidebar ────────────────────────────────────

  const loadConversation = async (id: string) => {
    const jwt = await getJwt();
    if (!jwt) return;
    try {
      const res = await fetch(`${BACKEND_URL}/conversation/${id}`, {
        headers: { Authorization: jwt },
      });
      const data = await res.json();
      const conv = data.conversation;
      if (!conv) return;

      // Group messages into pairs (User + optional following Assistant)
      const msgs = conv.messages as Array<{ role: "User" | "Assistant"; content: string }>;
      const rebuiltTurns: ThreadTurn[] = [];
      for (let i = 0; i < msgs.length; ) {
        const current = msgs[i];
        if (!current) { i++; continue; }
        if (current.role === "User") {
          const next = msgs[i + 1];
          const a = next?.role === "Assistant" ? next.content : "";
          rebuiltTurns.push({ query: current.content, answer: a, sources: [] });
          i += a ? 2 : 1;
        } else {
          i++;
        }
      }

      setActiveConv({ id: conv.id, title: conv.title, turns: rebuiltTurns });
    } catch (err) {
      console.error("Failed to load conversation:", err);
    }
  };

  // ── Stream a new question ────────────────────────────────────────────────

  const handleNewQuestion = async () => {
    const query = homeInput.trim();
    if (!query || isStreaming) return;

    const jwt = await getJwt();
    if (!jwt) return;

    setIsStreaming(true);
    setHomeInput("");

    // Optimistically add turn
    const newTurn: ThreadTurn = { query, answer: "", sources: [], isStreaming: true };
    const tempConv: ActiveConversation = { id: "", title: query, turns: [newTurn] };
    setActiveConv(tempConv);

    try {
      const res = await fetch(`${BACKEND_URL}/perplexity_ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: jwt },
        body: JSON.stringify({ query }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();

      let convId = "";

      await parseStream(
        reader,
        // onChunk – append answer text
        (text) => {
          setActiveConv((prev) => {
            if (!prev) return prev;
            const turns = [...prev.turns];
            const lastIdx = turns.length - 1;
            const lastTurn = turns[lastIdx];
            if (!lastTurn) return prev;
            turns[lastIdx] = { ...lastTurn, answer: lastTurn.answer + text, isStreaming: true };
            return { ...prev, turns };
          });
        },
        // onSources
        (sources) => {
          setActiveConv((prev) => {
            if (!prev) return prev;
            const turns = [...prev.turns];
            const lastIdx = turns.length - 1;
            const lastTurn = turns[lastIdx];
            if (!lastTurn) return prev;
            turns[lastIdx] = { ...lastTurn, sources };
            return { ...prev, turns };
          });
        },
        // onConversationId
        (id) => {
          convId = id;
          setActiveConv((prev) => (prev ? { ...prev, id } : prev));
        }
      );

      // Mark streaming done
      setActiveConv((prev) => {
        if (!prev) return prev;
        const turns = [...prev.turns];
        const lastIdx = turns.length - 1;
        const lastTurn = turns[lastIdx];
        if (!lastTurn) return prev;
        turns[lastIdx] = { ...lastTurn, isStreaming: false };
        return { ...prev, turns };
      });

      // Refresh sidebar
      if (convId) await fetchConversations();
    } catch (err) {
      console.error("Stream error:", err);
      setActiveConv((prev) => {
        if (!prev) return prev;
        const turns = [...prev.turns];
        const lastIdx = turns.length - 1;
        const lastTurn = turns[lastIdx];
        if (!lastTurn) return prev;
        turns[lastIdx] = { ...lastTurn, isStreaming: false, answer: lastTurn.answer || "An error occurred." };
        return { ...prev, turns };
      });
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Stream a follow-up ───────────────────────────────────────────────────

  const handleFollowUp = async () => {
    const query = followUpInput.trim();
    if (!query || isStreaming || !activeConv?.id) return;

    const jwt = await getJwt();
    if (!jwt) return;

    setIsStreaming(true);
    setFollowUpInput("");

    const newTurn: ThreadTurn = { query, answer: "", sources: [], isStreaming: true };
    setActiveConv((prev) =>
      prev ? { ...prev, turns: [...prev.turns, newTurn] } : prev
    );

    try {
      const res = await fetch(`${BACKEND_URL}/purplexity_ask/follow_up`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: jwt },
        body: JSON.stringify({ conversationId: activeConv.id, query }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();

      await parseStream(
        reader,
        (text) => {
          setActiveConv((prev) => {
            if (!prev) return prev;
            const turns = [...prev.turns];
            const lastIdx = turns.length - 1;
            const lastTurn = turns[lastIdx];
            if (!lastTurn) return prev;
            turns[lastIdx] = { ...lastTurn, answer: lastTurn.answer + text, isStreaming: true };
            return { ...prev, turns };
          });
        },
        (sources) => {
          setActiveConv((prev) => {
            if (!prev) return prev;
            const turns = [...prev.turns];
            const lastIdx = turns.length - 1;
            const lastTurn = turns[lastIdx];
            if (!lastTurn) return prev;
            turns[lastIdx] = { ...lastTurn, sources };
            return { ...prev, turns };
          });
        },
        () => {} // follow-up doesn't send conversationId
      );

      setActiveConv((prev) => {
        if (!prev) return prev;
        const turns = [...prev.turns];
        const lastIdx = turns.length - 1;
        const lastTurn = turns[lastIdx];
        if (!lastTurn) return prev;
        turns[lastIdx] = { ...lastTurn, isStreaming: false };
        return { ...prev, turns };
      });
    } catch (err) {
      console.error("Follow-up stream error:", err);
      setActiveConv((prev) => {
        if (!prev) return prev;
        const turns = [...prev.turns];
        const lastIdx = turns.length - 1;
        const lastTurn = turns[lastIdx];
        if (!lastTurn) return prev;
        turns[lastIdx] = { ...lastTurn, isStreaming: false };
        return { ...prev, turns };
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const resetToHome = () => {
    setActiveConv(null);
    setActiveNav("home");
    setHomeInput("");
    setFollowUpInput("");
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen bg-[#191a1a] text-[#e8e8e6] antialiased overflow-hidden font-sans">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-60 border-r border-[#2d2f2f] bg-[#141515] flex flex-col py-3 select-none flex-shrink-0">
        {/* Brand + New Thread */}
        <div className="px-3 pb-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1 pt-1">
            {/* Perplexity-style logo circle */}
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center flex-shrink-0">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="font-semibold tracking-wide text-sm text-zinc-100">
              Perplexity
            </span>
          </div>

          <button
            onClick={resetToHome}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium rounded-xl border border-[#2d2f2f] hover:bg-[#202222] transition-colors text-zinc-300 group"
          >
            <Plus size={14} className="text-zinc-400 group-hover:text-teal-400 transition-colors" />
            <span>New Thread</span>
            <span className="ml-auto text-[10px] bg-[#252727] px-1.5 py-0.5 rounded text-zinc-500 font-mono">
              Ctrl K
            </span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5 px-2 text-sm">
          {(
            [
              { id: "home", label: "Home", icon: Home },
              { id: "discover", label: "Discover", icon: Compass },
              { id: "library", label: "Library", icon: BookOpen },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setActiveNav(id); if (id === "home") resetToHome(); }}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
                activeNav === id
                  ? "bg-[#202222] text-zinc-100"
                  : "text-zinc-400 hover:bg-[#1c1e1e] hover:text-zinc-200"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        {/* Recents */}
        <div className="mt-4 flex flex-col flex-1 overflow-hidden px-2">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest px-3 mb-2">
            Recents
          </span>
          <div className="flex flex-col gap-0.5 overflow-y-auto flex-1 pr-1">
            {conversations.length === 0 ? (
              <span className="text-xs text-zinc-600 px-3 py-1 italic">
                No conversations yet
              </span>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => loadConversation(c.id)}
                  className={`truncate text-left text-xs px-3 py-2 rounded-lg transition ${
                    activeConv?.id === c.id
                      ? "bg-[#242626] text-zinc-100"
                      : "text-zinc-400 hover:bg-[#1c1e1e] hover:text-zinc-200"
                  }`}
                >
                  {c.title || "Untitled"}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#2d2f2f] mt-2 pt-3 px-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#2a2c2c] flex items-center justify-center text-xs text-zinc-300 font-semibold flex-shrink-0">
            {user?.email?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs text-zinc-300 truncate leading-tight">
              {user?.email}
            </span>
            <span className="text-[10px] text-zinc-600">Free Plan</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-[10px] px-2 py-1 rounded-md bg-[#252727] hover:bg-rose-900/40 text-zinc-400 hover:text-rose-400 border border-transparent hover:border-rose-800/50 transition flex-shrink-0"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main Area ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {!activeConv ? (
          /* ── Home / Empty State ──────────────────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-2xl flex flex-col items-center gap-8">
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center mb-1 shadow-lg shadow-teal-900/30">
                  <Sparkles size={18} className="text-white" />
                </div>
                <h1 className="text-3xl font-semibold text-zinc-100 tracking-tight">
                  What do you want to know?
                </h1>
              </div>

              {/* Omnibar */}
              <div className="w-full bg-[#202222] border border-[#333636] focus-within:border-zinc-500 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 transition-colors">
                <textarea
                  ref={homeTextareaRef}
                  rows={1}
                  value={homeInput}
                  onChange={(e) => setHomeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleNewQuestion();
                    }
                  }}
                  placeholder="Ask anything..."
                  className="w-full bg-transparent resize-none text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none min-h-[24px] max-h-48 overflow-y-auto leading-6"
                />

                <div className="flex items-center justify-between pt-1 border-t border-[#2a2c2c]">
                  <div className="flex items-center gap-1.5">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#2a2c2c] hover:bg-[#343737] transition text-xs text-zinc-400 hover:text-zinc-200">
                      <Search size={11} />
                      Search
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#2a2c2c] hover:bg-[#343737] transition text-xs text-zinc-400 hover:text-zinc-200">
                      <Compass size={11} />
                      Focus
                    </button>
                  </div>

                  <button
                    onClick={handleNewQuestion}
                    disabled={!homeInput.trim() || isStreaming}
                    className="p-2 rounded-full bg-teal-600 hover:bg-teal-500 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-teal-600 text-white transition shadow-md"
                  >
                    {isStreaming ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <ArrowRight size={15} />
                    )}
                  </button>
                </div>
              </div>

              {/* Suggestion chips */}
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  "Latest AI breakthroughs",
                  "How does RAG work?",
                  "Best TypeScript practices",
                  "Explain quantum computing",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setHomeInput(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-[#2d2f2f] text-zinc-400 hover:text-zinc-200 hover:border-[#3d4040] hover:bg-[#1e2020] transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Active Thread View ──────────────────────────────────────── */
          <>
            {/* Scrollable thread area */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 py-10">
                {activeConv.turns.map((turn, i) => (
                  <TurnView key={i} turn={turn} />
                ))}
                <div ref={threadEndRef} />
              </div>
            </div>

            {/* Fixed follow-up bar */}
            <div className="border-t border-[#2d2f2f] bg-[#191a1a]/90 backdrop-blur-sm px-4 py-3">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-end gap-3 bg-[#202222] border border-[#333636] focus-within:border-zinc-600 rounded-2xl px-4 py-3 transition-colors">
                  <textarea
                    ref={followUpTextareaRef}
                    rows={1}
                    value={followUpInput}
                    onChange={(e) => setFollowUpInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleFollowUp();
                      }
                    }}
                    placeholder="Ask a follow-up…"
                    disabled={isStreaming || !activeConv.id}
                    className="flex-1 bg-transparent resize-none text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none min-h-[22px] max-h-40 overflow-y-auto leading-6 disabled:opacity-50"
                  />
                  <button
                    onClick={handleFollowUp}
                    disabled={!followUpInput.trim() || isStreaming || !activeConv.id}
                    className="p-2 rounded-full bg-teal-600 hover:bg-teal-500 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-teal-600 text-white transition flex-shrink-0 self-end mb-0.5"
                  >
                    {isStreaming ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                  </button>
                </div>
                {!activeConv.id && isStreaming && (
                  <p className="text-[10px] text-zinc-600 text-center mt-1">
                    Follow-up available after the answer completes
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
