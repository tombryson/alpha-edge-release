export type HelpInline =
    | { type: 'text' | 'code'; text: string }
    | { type: 'strong' | 'em'; children: HelpInline[] }
    | { type: 'link'; href: string; children: HelpInline[] };

export type HelpBlock =
    | { type: 'heading'; text: string; id: string }
    | { type: 'paragraph'; children: HelpInline[] }
    | { type: 'list'; ordered: boolean; items: HelpInline[][] }
    | { type: 'diagram'; id: string; label: string; nodes: string[]; result?: string };

export type HelpSection = {
    id: string;
    label: string;
    title: string;
    body: string;
    blocks: HelpBlock[];
};
