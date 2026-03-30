export interface EntityContext {
  entity: string;
  intent: string | null;
  contextReason: string | null;
  establishedAt: number;
}

export class ConversationState {
  private entities: Map<string, EntityContext> = new Map();

  setEntity(entity: string, intent?: string, contextReason?: string) {
    const normalized = entity.toLowerCase().trim();
    this.entities.set(normalized, {
      entity: normalized,
      intent: intent || null,
      contextReason: contextReason || null,
      establishedAt: Date.now(),
    });
  }

  getEntity(entity: string): EntityContext | undefined {
    return this.entities.get(entity.toLowerCase().trim());
  }

  hasIntent(entity: string): boolean {
    const ctx = this.getEntity(entity);
    return ctx !== null && ctx !== undefined && ctx.intent !== null;
  }

  toSystemContext(): string {
    if (this.entities.size === 0) return '';
    const lines = Array.from(this.entities.values())
      .filter((e) => e.intent)
      .map((e) => `- ${e.entity}: intent="${e.intent}"${e.contextReason ? `, context="${e.contextReason}"` : ''}`)
      .join('\n');
    if (!lines) return '';
    return `\n\n## ESTABLISHED CONTEXT (do not re-ask intent for these)\n${lines}`;
  }
}
