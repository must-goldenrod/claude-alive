import type { ToolAnimation } from './types.js';

const TYPING_TOOLS = new Set(['Write', 'Edit', 'Bash', 'Task', 'NotebookEdit']);
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const SEARCHING_TOOLS = new Set(['WebFetch', 'WebSearch']);
const THINKING_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

export function toolToAnimation(toolName: string): ToolAnimation {
  if (TYPING_TOOLS.has(toolName)) return 'typing';
  if (READING_TOOLS.has(toolName)) return 'reading';
  if (SEARCHING_TOOLS.has(toolName)) return 'searching';
  if (THINKING_TOOLS.has(toolName)) return 'thinking';
  if (toolName.startsWith('mcp__')) return 'running';
  return 'running';
}

export function extractToolDisplayName(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    return parts[parts.length - 1] ?? toolName;
  }
  return toolName;
}
