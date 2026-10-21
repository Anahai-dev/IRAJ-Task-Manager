export interface BoardColumn {
  id: string;
  title: string;
}

export const DEFAULT_BOARD_COLUMNS: BoardColumn[] = [
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];
