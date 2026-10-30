import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation via the browser's built-in SpeechRecognition.
 *
 * Nothing is uploaded by us: the transcript lands in the composer as a draft and
 * the user still has to send it, so a misheard word never becomes a message. No
 * API key, no server, and it degrades to "unsupported" without the API.
 */
export function useSpeechCompose({ onTranscript, onError } = {}) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  const supported = typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      onError?.('Dictation is not supported in this browser.');
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) onTranscript?.(transcript.trim());
    };
    recognition.onerror = (event) => {
      setListening(false);
      // "aborted" is the user stopping it; not worth surfacing.
      if (event?.error && event.error !== 'aborted') onError?.(`Dictation error: ${event.error}`);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      onError?.('Could not start dictation.');
    }
  }, [onError, onTranscript, supported]);

  // Never leave the microphone open after the composer unmounts.
  useEffect(() => () => {
    try {
      recognitionRef.current?.abort();
    } catch {
      /* nothing to abort */
    }
  }, []);

  return { start, stop, listening, supported };
}

export default useSpeechCompose;
