export type InstructionNode =
  | string
  | {
      tag: string;
      attrs: Record<string, string>;
      children: InstructionNode[];
    };
export interface InstructionArticle {
  slug: string;
  title: string;
  category_id: string;
  description: string;
  body: InstructionNode[];
  text: string;
}
export interface InstructionData {
  schema_version: number;
  source_url: string;
  source_revision: string;
  version_date: string;
  articles: InstructionArticle[];
  groups: { name: string; category: string; url: string }[];
  offices: {
    id: number;
    name: string;
    address: string;
    owner: string;
    phone: string;
    group: string;
  }[];
  contacts: {
    name: string;
    department: string;
    role: string;
    phones: string[];
  }[];
  files: {
    name: string;
    title: string;
    description: string;
    size: number;
    sha256: string;
  }[];
}
