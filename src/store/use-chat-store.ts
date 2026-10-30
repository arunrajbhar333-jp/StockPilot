import { create } from "zustand";

interface ChatStore {
  isOpen: boolean;
  prefilledPrompt: string | null;
  openChat: (prompt: string) => void;
  closeChat: () => void;
  clearPrompt: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  isOpen: false,
  prefilledPrompt: null,
  openChat: (prompt) =>
    set({
      isOpen: true,
      prefilledPrompt: prompt.trim() || null,
    }),
  closeChat: () =>
    set({
      isOpen: false,
      prefilledPrompt: null,
    }),
  clearPrompt: () => set({ prefilledPrompt: null }),
}));
