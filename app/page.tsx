'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
};

export default function HomePage() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  type DocStatus = 'processing' | 'classified' | 'saved';

const DOC_TYPE_LABELS: Record<string, string> = {
  case_study: 'Case Study',
  white_paper: 'White Paper',
  battle_card: 'Battle Card',
  roi_calculator: 'ROI Calculator',
  clinical_summary: 'Clinical Summary',
  regulatory_brief: 'Regulatory Brief',
  email_sequence: 'Email Sequence',
  call_script: 'Call Script',
  objection_handler: 'Objection Handler',
  competitive_analysis: 'Competitive Analysis',
  clinical_study: 'Clinical Study',
  regulatory_filing: 'Regulatory Filing',
  competitive_intel: 'Competitive Intel',
  sales_collateral: 'Sales Collateral',
  general_document: 'General Document',
};

function DocumentCard({ fileName, docType, status }: { fileName?: string; docType?: string; status: DocStatus }) {
  const statusConfig = {
    processing: { color: 'border-yellow-600 bg-yellow-900/20', icon: '⏳', label: 'Processing...' },
    classified: { color: 'border-sky-600 bg-sky-900/20', icon: '📄', label: DOC_TYPE_LABELS[docType || ''] || docType || 'Document' },
    saved: { color: 'border-green-600 bg-green-900/20', icon: '✅', label: 'Saved to KB' },
  };
  const cfg = statusConfig[status];
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm mb-2 ${cfg.color}`}>
      <span>{cfg.icon}</span>
      {fileName && <span className="text-slate-300 font-medium">{fileName}</span>}
      <span className="text-slate-400">—</span>
      <span className="text-slate-200">{cfg.label}</span>
    </div>
  );
}

function parseDocMeta(content: string): { fileName?: string; docType?: string; status: DocStatus } | null {
  if (content.includes('[doc:processing]')) return { status: 'processing' };
  const classifiedMatch = content.match(/\[doc:classified:([\w]+)(?::(.+?))?\]/);
  if (classifiedMatch) return { docType: classifiedMatch[1], fileName: classifiedMatch[2], status: 'classified' };
  const savedMatch = content.match(/\[doc:saved:([\w]+)(?::(.+?))?\]/);
  if (savedMatch) return { docType: savedMatch[1], fileName: savedMatch[2], status: 'saved' };
  return null;
}
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
    const connectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('pathovai-history');
    if (saved) setChatHistory(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('pathovai-history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

    // Close connect menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (connectMenuRef.current && !connectMenuRef.current.contains(event.target as Node)) {
        setShowConnectMenu(false);
      }
    }
    if (showConnectMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showConnectMenu]);

  // Auto-save current chat to history whenever messages change (after assistant replies)
  const saveCurrentChat = useCallback((msgs: ChatMessage[]) => {
    if (msgs.length < 2) return; // Need at least one exchange
    const id = activeChatId || crypto.randomUUID();
    const chatSession: ChatSession = {
      id,
      title: msgs[0].content.slice(0, 40),
      messages: msgs,
      createdAt: Date.now(),
    };
    setChatHistory((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return [chatSession, ...filtered];
    });
    if (!activeChatId) setActiveChatId(id);
  }, [activeChatId]);

  function handleNewChat() {
    // Current chat is already auto-saved, just clear
    setMessages([]);
    setInput('');
    setFiles([]);
    setIsLoading(false);
    setActiveChatId(null);
  }

  function loadChat(chatSession: ChatSession) {
    setMessages(chatSession.messages);
    setActiveChatId(chatSession.id);
    setFiles([]);
  }

  function clearHistory() {
    setChatHistory([]);
    localStorage.removeItem('pathovai-history');
  }

  function downloadAsMarkdown(content: string) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pathovai-document-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;

    // Build message content including file contents
    let messageContent = input.trim();

    if (files.length > 0) {
      const fileContents: string[] = [];
      for (const file of files) {
        try {
          conconst formData = new FormData();
formData.append('file', file);
const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
const { documentId, fileName } = await uploadRes.json();
fileContents.push(`[doc:processing:${fileName}]`);
        } catch {
          fileContents.push(`\n\n---\n📎 File: ${file.name} (could not read file)\n---`);
        }
      }
      messageContent = messageContent + fileContents.join('');
      setFiles([]);
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageContent,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          accessToken: (session as any)?.accessToken,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('Chat error', errorData);
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ Error: ${errorData?.error || errorData?.details || 'Server error. Check Vercel logs.'}`,
        };
        const withError = [...nextMessages, errorMessage];
        setMessages(withError);
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      const replyText = data.reply ?? '';

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: replyText,
      };

      const updatedMessages = [...nextMessages, assistantMessage];
      setMessages(updatedMessages);
      // Auto-save to chat history
      saveCurrentChat(updatedMessages);
    } catch (err) {
      console.error('Network error', err);
    } finally {
      setIsLoading(false);
    }
  }

  const isGmailConnected = !!(session as any)?.accessToken;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <div className="w-56 border-r border-slate-800 p-4 flex flex-col gap-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-300">Chat History</h2>
          {chatHistory.length > 0 && (
            <button onClick={clearHistory} className="text-xs text-slate-500 hover:text-red-400">
              Clear All
            </button>
          )}
        </div>
        {chatHistory.map((s) => (
          <button
            key={s.id}
            onClick={() => loadChat(s)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm truncate ${
              activeChatId === s.id
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {s.title}
          </button>
        ))}
        {chatHistory.length === 0 && (
          <p className="text-xs text-slate-600 mt-2">No previous chats</p>
        )}
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center sticky top-0 z-10 bg-slate-950 justify-between px-6 py-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <img src="/PATHOVA_LOGO1_edited_edited_edited.png" alt="PathovaAI logo" className="h-8 w-8 rounded" />
            <h1 className="text-lg font-bold">PathovaAI</h1>
          </div>
          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-700 hover:bg-slate-800"
          >
            + New Chat
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <p className="text-slate-500 text-center mt-20">
              Name a company, drop a doc, or tell me what we're working on.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-3xl mx-auto ${m.role === 'user' ? 'text-sky-300' : 'text-slate-200'}`}
            >
              <p className="text-xs font-semibold mb-1 text-slate-400">
                {m.role === 'user' ? 'You' : 'PathovaAI'}
              </p>
              {(() => { const docMeta = parseDocMeta(m.content); return docMeta ? <DocumentCard {...docMeta} /> : null; })()}               <p className="whitespace-pre-wrap">{m.content.replace(/\[doc:(processing|classified|saved)(:[\w]+)?(:.+?)?\]/g, '').trim()}</p>
              {m.role === 'assistant' && (
                <button
                  onClick={() => downloadAsMarkdown(m.content)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-300 underline"
                >
                  Download as .md
                </button>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="max-w-3xl mx-auto">
              <p className="text-slate-500 animate-pulse">Thinking...</p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="px-6 py-3 border-t border-slate-800">
          {/* File chips */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {files.map((file, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-xs text-slate-300"
                >
                  📎 {file.name}
                  &nbsp;
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="text-slate-500 hover:text-slate-200"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            {/* Hidden file input */}
            <input
              id="file-upload" ref={fileInputRef}
              type="file"
              multiple
                            style={{ position: 'absolute', opacity: 0, width: '1px', height: '1px', overflow: 'hidden' }}
              onChange={(e) => {
                const newFiles = Array.from(e.target.files || []); if (newFiles.length > 0) { setFiles((prev) => [...prev, ...newFiles]); } setTimeout(() => { e.target.value = ''; }, 0);
                
              }}
            />

            {/* Attach button */}
                        <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900 text-sm hover:bg-slate-800 cursor-pointer"
              title="Attach files"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                        </button>

            {/* Connect integrations + button */}
            <div ref={connectMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setShowConnectMenu(!showConnectMenu)}
                className={`px-3 py-2 rounded-md border text-sm font-bold ${
                  isGmailConnected
                    ? 'border-green-600 bg-green-900/30 text-green-400 hover:bg-green-900/50'
                    : 'border-slate-700 bg-slate-900 hover:bg-slate-800'
                }`}
                title="Connect integrations"
              >
                {isGmailConnected ? '✉️ ✓' : '+'}
              </button>
              {showConnectMenu && (
                <div className="absolute bottom-full left-0 mb-1 w-56 rounded-md border border-slate-700 bg-slate-900 shadow-lg z-10">
                  <button
                    type="button"
                    onClick={() => {
                      if (isGmailConnected) { signOut(); } else { signIn('google'); }
                      setShowConnectMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-700 flex items-center gap-3"
                  >
                    ✉️ {isGmailConnected ? 'Disconnect Gmail' : 'Connect Gmail'}
                    {isGmailConnected && (
                      <span className="ml-auto text-green-400 text-xs font-semibold">Connected</span>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Gmail connected badge */}
            {isGmailConnected && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                Gmail
              </span>
            )}

            {/* Text input */}
<textarea
  className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500 resize-none overflow-auto"
  style={{ minHeight: '4lh', maxHeight: '200px' }}
  rows={4}
  value={input}
  onChange={(e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  }}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }}
  placeholder="Let's make some money. What's on tap..."
/>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-md bg-sky-600 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
