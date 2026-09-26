import { useSyncExternalStore } from 'react';
import { voice, type VoiceSnapshot } from './voice';

export function useVoice(): VoiceSnapshot {
  return useSyncExternalStore(voice.subscribe, voice.getSnapshot);
}
