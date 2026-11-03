export type LatestPrompt = string | null

declare module 'claude-code' {
  interface PluginState {
    'latest-prompt': { text: LatestPrompt; isOpen: boolean }
  }
}
