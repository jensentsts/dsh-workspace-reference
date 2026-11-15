export interface WorkspaceMention { query: string; raw: string; start: number; end: number; quoted: boolean }
export function extractWorkspaceMentions(text: string, options?: { maxMentions?: number; maxChars?: number }): { mentions: WorkspaceMention[]; truncated: boolean };
