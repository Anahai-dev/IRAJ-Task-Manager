import { useEffect, useRef, useState } from "react";
import { apiGet, apiPut } from "../lib/api";
import { DEFAULT_BOARD_COLUMNS, type BoardColumn } from "../lib/board";

function parseColumnsPayload(data: unknown): BoardColumn[] | null {
  if (Array.isArray(data) && data.length > 0) return data as BoardColumn[];
  if (data && typeof data === "object" && "columns" in data) {
    const cols = (data as { columns?: unknown }).columns;
    if (Array.isArray(cols) && cols.length > 0) return cols as BoardColumn[];
  }
  return null;
}

export function useBoardColumns(projectId: string | null, token: string | null) {
  const [columns, setColumns] = useState<BoardColumn[]>(() => {
    try {
      const saved = localStorage.getItem(`board-columns-${projectId || "all"}`);
      return saved ? JSON.parse(saved) : DEFAULT_BOARD_COLUMNS;
    } catch {
      return DEFAULT_BOARD_COLUMNS;
    }
  });

  const currentProjectIdRef = useRef(projectId);

  useEffect(() => {
    let isMounted = true;
    const loadColumns = async () => {
      if (projectId && token) {
        try {
          const data = await apiGet<unknown>(`/api/projects/${projectId}/columns`);
          const serverCols = parseColumnsPayload(data);
          if (serverCols && isMounted) {
            setColumns(serverCols);
            localStorage.setItem(`board-columns-${projectId}`, JSON.stringify(serverCols));
            currentProjectIdRef.current = projectId;
            return;
          }
        } catch (e) {
          console.error("Failed to load server columns:", e);
        }
      }
      try {
        const saved = localStorage.getItem(`board-columns-${projectId || "all"}`);
        if (isMounted) {
          setColumns(saved ? JSON.parse(saved) : DEFAULT_BOARD_COLUMNS);
        }
      } catch {
        if (isMounted) setColumns(DEFAULT_BOARD_COLUMNS);
      }
      currentProjectIdRef.current = projectId;
    };
    void loadColumns();
    return () => {
      isMounted = false;
    };
  }, [projectId, token]);

  useEffect(() => {
    if (currentProjectIdRef.current !== projectId) return;
    localStorage.setItem(`board-columns-${projectId || "all"}`, JSON.stringify(columns));
    if (!projectId || !token) return;
    const timer = setTimeout(() => {
      void apiPut(`/api/projects/${projectId}/columns`, { columns }).catch((err) =>
        console.error("Failed to save project columns:", err)
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [columns, projectId, token]);

  return { columns, setColumns };
}
