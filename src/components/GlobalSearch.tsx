import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  FolderKanban,
  KanbanSquare,
  FileText,
  User as UserIcon,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { cn } from "../lib/utils";
import { apiGet } from "../lib/api";
import { motion, AnimatePresence } from "motion/react";

interface SearchResult {
  id: string;
  title: string;
  description?: string;
  type: "project" | "task" | "document" | "user";
  projectId?: string;
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<{
    projects: SearchResult[];
    tasks: SearchResult[];
    documents: SearchResult[];
    users: SearchResult[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    const fetchResults = async () => {
      setIsLoading(true);
      try {
        const data = await apiGet<{
          projects: SearchResult[];
          tasks: SearchResult[];
          documents: SearchResult[];
          users: SearchResult[];
        }>(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, {
          headers: {
            "X-Silent-Fetch": "true",
          },
        });
        setResults(data);
      } catch (e) {
        console.error("Search error", e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [debouncedQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (item: SearchResult) => {
    setIsOpen(false);
    setQuery("");

    switch (item.type) {
      case "project":
        navigate(`/projects?projectId=${item.id}`);
        break;
      case "task":
        navigate(
          `/board${item.projectId ? `?projectId=${item.projectId}` : ""}`,
        );
        break;
      case "document":
        navigate(
          `/documents${item.projectId ? `?projectId=${item.projectId}` : ""}`,
        );
        break;
      case "user":
        navigate(`/admin/users`);
        break;
    }
  };

  const hasResults =
    results &&
    (results.projects.length > 0 ||
      results.tasks.length > 0 ||
      results.documents.length > 0 ||
      results.users.length > 0);

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-md mx-auto z-50 flex items-center"
    >
      <div className="relative flex items-center w-full h-10 rounded-full bg-surface-dim border border-border-subtle hover:border-border-strong focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all overflow-hidden pl-3">
        <Search className="w-4 h-4 text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search projects, tasks, documents..."
          className="flex-1 bg-transparent border-none focus:outline-none text-sm px-3 text-strong placeholder-muted h-full w-full min-w-0"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="mr-2 text-muted hover:text-strong transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        )}
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 h-full rounded-r-full transition-colors shrink-0"
        >
          Search
        </button>
      </div>

      <AnimatePresence>
        {isOpen && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="absolute top-12 left-0 right-0 max-h-[400px] overflow-y-auto bg-surface border border-border-strong rounded-lg shadow-xl py-2 z-50"
          >
            {isLoading && !results ? (
              <div className="flex items-center justify-center p-8">
                <span className="text-xs text-subtle font-bold uppercase tracking-widest animate-pulse">
                  Searching...
                </span>
              </div>
            ) : hasResults ? (
              <div className="flex flex-col">
                {results?.projects.length > 0 && (
                  <div className="mb-2">
                    <div className="px-3 py-1 text-xs font-semibold text-muted uppercase tracking-wider">
                      Projects
                    </div>
                    {results.projects.map((item) => (
                      <button
                        key={`project-${item.id}`}
                        onClick={() => handleSelect(item)}
                        className="w-full text-left px-3 py-2 flex items-center hover:bg-surface-accent transition-colors"
                      >
                        <FolderKanban className="w-4 h-4 text-blue-500 mr-3 shrink-0" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-medium text-strong truncate">
                            {item.title}
                          </span>
                          {item.description && (
                            <span className="text-xs text-muted truncate">
                              {item.description}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {results?.tasks.length > 0 && (
                  <div className="mb-2">
                    <div className="px-3 py-1 text-xs font-semibold text-muted uppercase tracking-wider">
                      Tasks
                    </div>
                    {results.tasks.map((item) => (
                      <button
                        key={`task-${item.id}`}
                        onClick={() => handleSelect(item)}
                        className="w-full text-left px-3 py-2 flex items-center hover:bg-surface-accent transition-colors"
                      >
                        <KanbanSquare className="w-4 h-4 text-orange-500 mr-3 shrink-0" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-medium text-strong truncate">
                            {item.title}
                          </span>
                          <span className="text-xs text-muted truncate">
                            Go to Task Board
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {results?.documents.length > 0 && (
                  <div className="mb-2">
                    <div className="px-3 py-1 text-xs font-semibold text-muted uppercase tracking-wider">
                      Documents
                    </div>
                    {results.documents.map((item) => (
                      <button
                        key={`doc-${item.id}`}
                        onClick={() => handleSelect(item)}
                        className="w-full text-left px-3 py-2 flex items-center hover:bg-surface-accent transition-colors"
                      >
                        <FileText className="w-4 h-4 text-green-500 mr-3 shrink-0" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-medium text-strong truncate">
                            {item.title}
                          </span>
                          <span className="text-xs text-muted truncate">
                            Go to Documents
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {results?.users.length > 0 && (
                  <div>
                    <div className="px-3 py-1 text-xs font-semibold text-muted uppercase tracking-wider">
                      Users
                    </div>
                    {results.users.map((item) => (
                      <button
                        key={`user-${item.id}`}
                        onClick={() => handleSelect(item)}
                        className="w-full text-left px-3 py-2 flex items-center hover:bg-surface-accent transition-colors"
                      >
                        <UserIcon className="w-4 h-4 text-purple-500 mr-3 shrink-0" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-medium text-strong truncate">
                            {item.title}
                          </span>
                          {item.description && (
                            <span className="text-xs text-muted truncate">
                              {item.description}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-muted">
                No results found for "{query}"
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
