export interface Category {
  id: string;
  name: string;
  emoji: string;
  retention_days: number | null;
}
export interface Link {
  type: string;
  url: string;
  label?: string;
}
export interface DateEntry {
  id: string;
  kind: "event" | "deadline";
  start: string;
  end?: string;
  label?: string;
  allDay?: boolean;
  recurrence?: {
    frequency: string;
    weekdays: number[];
    until?: string;
    occurrence_links?: { occurrence_date: string; url: string }[];
  };
  occurrence_date?: string;
  cancelled?: boolean;
  meeting_url?: string;
  post_id?: string;
}
export interface FileEntry {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  ref: ObjectRef;
  permanent_template?: boolean;
}
export interface ObjectRef {
  path: string;
  sha256: string;
  object_id: string;
}
export interface Post {
  id: string;
  type?: "post" | "reference";
  category_id: string;
  title: string;
  body: string;
  source: string;
  priority: string;
  pinned: boolean;
  author: { id: string; display_name: string };
  created_at: string;
  updated_at: string;
  state: string;
  closed_at?: string;
  expires_at?: string;
  dates: DateEntry[];
  links: Link[];
  attachments: FileEntry[];
  expected_attachments: { label: string }[];
  history: { id: string; at: string; text: string; type: string; by: string }[];
  reminded_at: { id: string; at: string }[];
  related: string[];
}
export interface Snapshot {
  schema_version: number;
  period: { from: string; to: string };
  generated_at: string;
  posts: Post[];
  categories: Category[];
  birthdays: { name: string; date: string }[];
}
export interface Config {
  dataSources: string[];
  feedbackUrl: string;
  dailyTaskUrl: string;
  dailyTaskHome: string;
}
export interface Filters {
  q: string;
  categories: string[];
  period: string;
  dateKind: string;
  status: string;
  important: boolean;
  files: boolean;
  favorites: boolean;
  from: string;
  to: string;
}
