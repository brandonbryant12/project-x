import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: SpeechRecognitionAlternativeLike | undefined;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike | undefined;
  };
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  addEventListener: {
    (type: 'result', listener: (event: SpeechRecognitionEventLike) => void): void;
    (type: 'error', listener: (event: SpeechRecognitionErrorEventLike) => void): void;
    (type: 'end', listener: () => void): void;
  };
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * Browser Web Speech API dictation hook with graceful fallback when unsupported.
 * Accumulates finalized speech plus live interim text for real-time preview.
 */
export const useVoiceDictation = () => {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Live microphone dictation is not supported in this browser.');
      return;
    }
    setError(null);
    setFinalText('');
    setInterimText('');
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.addEventListener('result', (event) => {
      let finals = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const piece = res?.[0]?.transcript ?? '';
        if (res?.isFinal) finals += `${piece} `;
        else interim += piece;
      }
      if (finals) setFinalText((prev) => `${prev}${finals}`);
      setInterimText(interim);
    });
    rec.addEventListener('error', (event) => {
      setError(
        event.error === 'not-allowed'
          ? 'Microphone permission was denied. Check browser settings or paste a transcript below.'
          : 'Dictation stopped unexpectedly. You can keep editing or paste text below.',
      );
      setListening(false);
    });
    rec.addEventListener('end', () => {
      setListening(false);
      setInterimText('');
    });
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, []);

  useEffect(() => () => recRef.current?.stop(), []);

  const transcript = `${finalText}${interimText}`.trim();
  const clear = useCallback(() => {
    setFinalText('');
    setInterimText('');
    setError(null);
  }, []);

  return { supported, listening, transcript, error, start, stop, clear };
};
