import type { RoleCard } from '@shared/types'
import { pipelineBus } from './pipelineBus'

let activeRoleCard: RoleCard | null = null

export function setActiveRoleCard(card: RoleCard): void {
  if (activeRoleCard && activeRoleCard.id !== card.id) pipelineBus.emit('pipeline:abort', undefined)
  activeRoleCard = card
}

export function getActiveRoleCard(): RoleCard | null {
  return activeRoleCard
}
