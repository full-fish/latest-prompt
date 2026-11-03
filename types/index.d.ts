export type LatestPrompt = string | null
// The question for what each surface's transcript viewport shows, by surface.
export type InView = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'latest-prompt': { text: LatestPrompt; isOpen: boolean; inView: InView }
  }
}
