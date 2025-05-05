import { useStorage } from '#imports'

interface DiscordStatus {
  status: 'initializing' | 'up' | 'down' | 'error'
  message?: string
}

const storage = useStorage('discord')
const statusKey = 'status'

export async function setDiscordStatus(newStatus: DiscordStatus): Promise<void> {
  // Log the status change
  const logMessage = `Discord Status Change: ${newStatus.status}${newStatus.message ? ` - ${newStatus.message}` : ''}`
  if (newStatus.status === 'error') {
    console.error(logMessage)
  } else {
    console.log(logMessage)
  }

  await storage.setItem(statusKey, newStatus)
}

export async function getDiscordStatus(): Promise<DiscordStatus> {
  const status = await storage.getItem<DiscordStatus>(statusKey)
  // Return a default status if nothing is set yet
  return status ?? { status: 'initializing', message: 'Status not yet determined.' }
}

// Set initial status without logging during module load
storage.setItem(statusKey, { status: 'initializing' }) 