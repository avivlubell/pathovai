import Anthropic from '@anthropic-ai/sdk';
import { executeTool, humanizeToolCall } from '../tool-executor';
import { RESEARCH_MANAGER } from './research';
import { CRM_MANAGER } from './crm';
import { QUALIFICATION_MANAGER } from './qualification';
import { OUTREACH_MANAGER } from './outreach';
import { KB_MANAGER } from './kb';
import type { ManagerType, TaskPacket, ManagerConfig } from './types';

interface ToolCallRecord {
  name: string;
  result: string;
}

const WRITE_TOOLS = new Set([
  'log_outreach_sequence',
  'log_outreach_touch',
  'mark_touch_sent',
  'cancel_queued_touches',
  'create_account',
  'create_contact',
  'update_account',
]);

const WRITE_KEYWORDS = ['create', 'add', 'update', 'save', 'log', 'queue', 'mark sent', 'mark as sent', 'cancel touches'];

function taskAuthorizedWrite(packet: TaskPacket): boolean {
  const haystack = `${packet.task} ${packet.user_intent ?? ''}`.toLowerCase();
  return WRITE_KEYWORDS.some(kw => haystack.includes(kw));
}

const MANAGER_CONFIGS: Record<ManagerType, ManagerConfig> = {
  research: RESEARCH_MANAGER,
  crm: CRM_MANAGER,
  qualification: QUALIFICATION_MANAGER,
  outreach: OUTREACH_MANAGER,
  kb: KB_MANAGER,
};

function buildTaskMessage(packet: TaskPacket): string {
  const parts: string[] = [
    `Task: ${packet.task}`,
    `User intent: ${packet.user_intent}`,
  ];
  if (packet.company_name) parts.push(`Target company: ${packet.company_name}`);
  if (packet.established_facts?.length) {
    parts.push(
      'Already established this session:\n' +
      packet.established_facts.map(f => `- ${f}`).join('\n')
    );
  }
  if (packet.focus_areas?.length) {
    parts.push('Focus on: ' + packet.focus_areas.join(', '));
  }
  return parts.join('\n\n');
}

export async function runManager(
  type: ManagerType,
  packet: TaskPacket,
  gmailAccessToken: string | undefined,
  send: (event: string, data: unknown) => void,
  stepCounterRef: { value: number },
  turnToolCalls: ToolCallRecord[],
  anthropic: Anthropic
): Promise<string> {
  const config = MANAGER_CONFIGS[type];
  const maxRounds = config.maxRounds ?? 10;
  const effectiveGmailToken = type === 'crm' ? gmailAccessToken : undefined;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildTaskMessage(packet) },
  ];

  let round = 0;
  const seenCalls = new Map<string, string>();

  while (round < maxRounds) {
    round++;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: config.systemPrompt,
      tools: config.tools as Anthropic.Tool[],
      tool_choice: { type: 'auto' },
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      const textBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'text' } => b.type === 'text'
      );
      const text = textBlocks.map(b => b.text).join('\n');
      if (!text.trim()) {
        console.warn(`[runManager:${type}] round ${round} ended with no text blocks — returning fallback`);
        return `[${type} manager completed tool calls but produced no summary]`;
      }
      return text;
    }

    messages.push({ role: 'assistant', content: response.content as any });

    const toolResults: any[] = [];

    for (const toolBlock of toolUseBlocks) {
      const toolInput = toolBlock.input as Record<string, unknown>;
      const stepId = `s${++stepCounterRef.value}`;
      const label = `[${type}] ${humanizeToolCall(toolBlock.name, toolInput)}`;
      const startedAt = Date.now();

      send('trace', {
        id: stepId,
        phase: 'start',
        tool: toolBlock.name,
        label,
      });

      const callKey = `${toolBlock.name}:${JSON.stringify(toolInput)}`;
      const cached = seenCalls.get(callKey);

      let result: string;
      if (WRITE_TOOLS.has(toolBlock.name) && !taskAuthorizedWrite(packet)) {
        result = JSON.stringify({ error: `[WRITE GUARD] ${toolBlock.name} rejected — task packet does not authorize writes. The task must explicitly contain words like "log", "save", "create", "update", or "cancel" to call write tools.` });
        console.warn(`[runManager:${type}] write guard blocked ${toolBlock.name}`);
      } else if (cached !== undefined) {
        result = `[LOOP GUARD] This exact call was already made earlier in this task. Do not repeat it — use the cached result below or choose a different approach.\n\nCached result: ${cached}`;
        console.warn(`[runManager:${type}] dedup hit on ${toolBlock.name} round ${round}`);
      } else {
        result = await executeTool(toolBlock.name, toolInput, effectiveGmailToken);
        seenCalls.set(callKey, result);
      }

      send('trace', {
        id: stepId,
        phase: 'end',
        tool: toolBlock.name,
        durationMs: Date.now() - startedAt,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      });

      turnToolCalls.push({ name: toolBlock.name, result });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return `[${type} manager reached maximum rounds (${maxRounds})]`;
}
