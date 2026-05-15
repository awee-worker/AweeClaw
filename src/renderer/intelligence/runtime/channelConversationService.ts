class ChannelConversationService {
  private threadToConversation = new Map<string, string>()
  private conversationToThread = new Map<string, string>()

  register(threadId: string, conversationKey: string): void {
    this.threadToConversation.set(threadId, conversationKey)
    this.conversationToThread.set(conversationKey, threadId)
  }

  getConversationKey(threadId: string): string | undefined {
    return this.threadToConversation.get(threadId)
  }

  getThreadId(conversationKey: string): string | undefined {
    return this.conversationToThread.get(conversationKey)
  }

  unregisterByThread(threadId: string): void {
    const key = this.threadToConversation.get(threadId)
    if (key) {
      this.conversationToThread.delete(key)
    }
    this.threadToConversation.delete(threadId)
  }

  clear(): void {
    this.threadToConversation.clear()
    this.conversationToThread.clear()
  }
}

export const channelConversationService = new ChannelConversationService()
