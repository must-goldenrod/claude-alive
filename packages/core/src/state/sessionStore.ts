import type { AgentInfo, AgentState, CompletedSession, HookEventPayload } from '../events/types.js';
import { transition } from './agentFSM.js';
import { extractToolDisplayName } from '../events/toolMapper.js';

/** Cross-platform basename — handles both / and \ separators */
function pathBasename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

export interface EventLogEntry {
  id: number;
  timestamp: number;
  sessionId: string;
  event: string;
  tool: string | null;
  agentState: AgentState;
}

export class SessionStore {
  private agents = new Map<string, AgentInfo>();
  private eventLog: EventLogEntry[] = [];
  private completedSessions: CompletedSession[] = [];
  private nextLogId = 1;
  private maxLogSize: number;
  private maxCompletedSize: number;

  constructor(maxLogSize = 1000, maxCompletedSize = 50) {
    this.maxLogSize = maxLogSize;
    this.maxCompletedSize = maxCompletedSize;
  }

  processEvent(payload: HookEventPayload): AgentInfo | null {
    const { event, session_id: sessionId, data } = payload;

    if (event === 'SessionStart') {
      return this.createAgent(sessionId, data.cwd ?? '');
    }

    if (event === 'SessionEnd') {
      const agent = this.agents.get(sessionId);
      if (agent) {
        // Record completion if agent was in done state
        if (agent.state === 'done') {
          this.addCompletedSession(agent);
        }
        agent.state = 'despawning';
        agent.lastEvent = event;
        agent.lastEventTime = payload.timestamp;
        this.addLogEntry(payload, agent.state);
        return agent;
      }
      return null;
    }

    if (event === 'SubagentStart' && data.agent_id) {
      return this.createAgent(data.agent_id, data.cwd ?? '', sessionId);
    }

    if (event === 'SubagentStop' && data.agent_id) {
      const agent = this.agents.get(data.agent_id);
      if (agent) {
        agent.state = 'despawning';
        agent.lastEvent = event;
        agent.lastEventTime = payload.timestamp;
        this.addLogEntry(payload, agent.state);
        return agent;
      }
      return null;
    }

    let agent = this.agents.get(sessionId);
    if (!agent) {
      // Auto-create agent for sessions that started before the server
      agent = this.createAgent(sessionId, data.cwd ?? '');
    }

    const toolName = data.tool_name ?? undefined;
    const result = transition(agent.state, event, toolName);

    agent.state = result.newState;
    agent.currentTool = result.toolName ? extractToolDisplayName(result.toolName) : null;
    agent.currentToolAnimation = result.toolAnimation;
    agent.lastEvent = event;
    agent.lastEventTime = payload.timestamp;
    agent.totalEvents++;

    // Capture transcript path if provided
    if (data.transcript_path && !agent.transcriptPath) {
      agent.transcriptPath = data.transcript_path;
    }

    // Capture last user prompt
    if (event === 'UserPromptSubmit' && data.prompt) {
      agent.lastPrompt = data.prompt;
    }

    // Track unique tools used
    if (toolName) {
      const displayName = extractToolDisplayName(toolName);
      if (!agent.toolsUsed.includes(displayName)) {
        agent.toolsUsed.push(displayName);
      }
    }

    // Update cwd if it changed
    if (data.cwd && data.cwd !== agent.cwd) {
      agent.cwd = data.cwd;
      agent.projectName = pathBasename(data.cwd);
    }

    if (event === 'Stop') {
      agent.currentTool = null;
      agent.currentToolAnimation = null;
    }

    this.addLogEntry(payload, agent.state);
    return agent;
  }

  renameAgent(sessionId: string, name: string | null): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    agent.displayName = name;
    return true;
  }

  private createAgent(sessionId: string, cwd: string, parentId?: string): AgentInfo {
    const projectName = pathBasename(cwd);
    const agent: AgentInfo = {
      id: sessionId,
      sessionId,
      state: 'spawning',
      currentTool: null,
      currentToolAnimation: null,
      cwd,
      lastEvent: 'SessionStart',
      lastEventTime: Date.now(),
      parentId: parentId ?? null,
      createdAt: Date.now(),
      displayName: null,
      projectName,
      transcriptPath: null,
      totalEvents: 0,
      lastPrompt: null,
      toolsUsed: [],
    };
    this.agents.set(sessionId, agent);
    this.addLogEntry(
      { event: 'SessionStart', tool: 'system', session_id: sessionId, timestamp: Date.now(), data: {} as HookEventPayload['data'] },
      'spawning',
    );
    return agent;
  }

  removeAgent(sessionId: string): boolean {
    return this.agents.delete(sessionId);
  }

  getAgent(sessionId: string): AgentInfo | undefined {
    return this.agents.get(sessionId);
  }

  getAllAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  getRecentEvents(count = 50): EventLogEntry[] {
    return this.eventLog.slice(-count);
  }

  getCompletedSessions(): CompletedSession[] {
    return [...this.completedSessions];
  }

  private addCompletedSession(agent: AgentInfo): void {
    this.completedSessions.push({
      sessionId: agent.sessionId,
      cwd: agent.cwd,
      projectName: agent.projectName,
      completedAt: Date.now(),
      lastPrompt: agent.lastPrompt,
      displayName: agent.displayName,
    });
    if (this.completedSessions.length > this.maxCompletedSize) {
      this.completedSessions = this.completedSessions.slice(-this.maxCompletedSize);
    }
  }

  private addLogEntry(payload: HookEventPayload, agentState: AgentState): void {
    this.eventLog.push({
      id: this.nextLogId++,
      timestamp: payload.timestamp,
      sessionId: payload.session_id,
      event: payload.event,
      tool: payload.tool !== 'system' ? payload.tool : null,
      agentState,
    });
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }
}
