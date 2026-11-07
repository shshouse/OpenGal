/** 运行时事件端口，供薄客户端订阅。 */
export type RuntimeEvent =
  | { type: 'turn.delta'; at: number; sessionId: string; delta: string }
  | { type: 'turn.done'; at: number; sessionId: string; turnId: string }
  | { type: 'turn.error'; at: number; sessionId: string; message: string }
  | { type: 'memory.changed'; at: number; roleId: string }
  | { type: 'state.changed'; at: number; roleId: string }
  | { type: 'role.changed'; at: number; roleId: string }

export interface RuntimeEvents {
  emit(event: RuntimeEvent): void
  subscribe(listener: (event: RuntimeEvent) => void): () => void
}
