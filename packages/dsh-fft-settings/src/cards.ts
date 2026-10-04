/** Browser registration list. Host modules must never be imported here. */
import { apiKeyCard } from './modules/api-key/card.js'
import { appVersionCard } from './modules/app-version/card.js'
export const settingsCards = [appVersionCard, apiKeyCard] as const
