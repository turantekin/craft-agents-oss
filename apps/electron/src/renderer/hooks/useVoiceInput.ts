/**
 * useVoiceInput - Hook for voice-to-text input using Web Speech API
 *
 * Uses the browser's built-in SpeechRecognition API (available in Chromium/Electron)
 * to convert speech to text in real-time.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

// Web Speech API types (not fully typed in TypeScript)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

// Get the SpeechRecognition constructor (vendor-prefixed in some browsers)
const SpeechRecognition =
  (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ||
  (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition

// Log availability for debugging
console.log('[useVoiceInput] SpeechRecognition available:', !!SpeechRecognition)

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

export interface UseVoiceInputOptions {
  /** Language for speech recognition (default: 'en-US') */
  lang?: string
  /** Whether to return interim (partial) results (default: true) */
  interimResults?: boolean
  /** Callback when transcription is received */
  onTranscript?: (text: string, isFinal: boolean) => void
  /** Callback when an error occurs */
  onError?: (error: string) => void
}

export interface UseVoiceInputReturn {
  /** Whether voice input is supported in this environment */
  isSupported: boolean
  /** Whether currently recording */
  isRecording: boolean
  /** Current transcript (interim + final) */
  transcript: string
  /** Start recording */
  startRecording: () => void
  /** Stop recording */
  stopRecording: () => void
  /** Toggle recording on/off */
  toggleRecording: () => void
  /** Clear the transcript */
  clearTranscript: () => void
  /** Any error that occurred */
  error: string | null
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const {
    lang = 'en-US',
    interimResults = true,
    onTranscript,
    onError,
  } = options

  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const finalTranscriptRef = useRef('')

  const isSupported = !!SpeechRecognition

  // Initialize speech recognition
  const initRecognition = useCallback(() => {
    if (!SpeechRecognition) return null

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = interimResults
    recognition.lang = lang

    recognition.onstart = () => {
      console.log('[useVoiceInput] Recognition started')
      setIsRecording(true)
      setError(null)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.log('[useVoiceInput] Got result:', event.results.length, 'results')
      let interimTranscript = ''
      let finalTranscript = finalTranscriptRef.current

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
          finalTranscriptRef.current = finalTranscript
          onTranscript?.(result[0].transcript, true)
        } else {
          interimTranscript += result[0].transcript
          onTranscript?.(result[0].transcript, false)
        }
      }

      setTranscript(finalTranscript + interimTranscript)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const errorMessage = getErrorMessage(event.error)
      setError(errorMessage)
      onError?.(errorMessage)
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    return recognition
  }, [lang, interimResults, onTranscript, onError])

  // Start recording
  const startRecording = useCallback(() => {
    console.log('[useVoiceInput] startRecording called, isSupported:', isSupported)

    if (!isSupported) {
      const msg = 'Speech recognition is not supported in this browser'
      console.error('[useVoiceInput]', msg)
      setError(msg)
      onError?.(msg)
      return
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort()
    }

    // Reset state
    finalTranscriptRef.current = ''
    setTranscript('')
    setError(null)

    // Create and start new recognition
    const recognition = initRecognition()
    console.log('[useVoiceInput] Recognition instance created:', !!recognition)

    if (recognition) {
      recognitionRef.current = recognition
      try {
        console.log('[useVoiceInput] Starting recognition...')
        recognition.start()
        console.log('[useVoiceInput] recognition.start() called')
      } catch (err) {
        console.error('[useVoiceInput] Failed to start:', err)
        setError('Failed to start voice recognition')
      }
    }
  }, [isSupported, initRecognition, onError])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
  }, [])

  // Toggle recording
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  // Clear transcript
  const clearTranscript = useCallback(() => {
    finalTranscriptRef.current = ''
    setTranscript('')
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
      }
    }
  }, [])

  return {
    isSupported,
    isRecording,
    transcript,
    startRecording,
    stopRecording,
    toggleRecording,
    clearTranscript,
    error,
  }
}

/**
 * Convert speech recognition error codes to user-friendly messages
 */
function getErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'no-speech':
      return 'No speech detected. Please try again.'
    case 'audio-capture':
      return 'No microphone found. Please check your microphone settings.'
    case 'not-allowed':
      return 'Microphone access denied. Please allow microphone access in your browser settings.'
    case 'network':
      return 'Network error. Please check your internet connection.'
    case 'aborted':
      return 'Voice input was cancelled.'
    case 'service-not-allowed':
      return 'Speech recognition service is not allowed.'
    default:
      return `Voice recognition error: ${errorCode}`
  }
}
