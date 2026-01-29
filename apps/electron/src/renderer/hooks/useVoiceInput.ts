/**
 * useVoiceInput - Hook for voice-to-text input using OpenAI Whisper API
 *
 * Uses MediaRecorder API to capture audio and sends it to Whisper for transcription.
 * This approach works reliably in Electron without browser microphone permission issues.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

export interface UseVoiceInputOptions {
  /** Callback when transcription is received */
  onTranscript?: (text: string) => void
  /** Callback when an error occurs */
  onError?: (error: string) => void
}

export interface UseVoiceInputReturn {
  /** Whether voice input is supported in this environment */
  isSupported: boolean
  /** Whether currently recording */
  isRecording: boolean
  /** Whether transcription is in progress */
  isTranscribing: boolean
  /** Current transcript */
  transcript: string
  /** Start recording */
  startRecording: () => void
  /** Stop recording and transcribe */
  stopRecording: () => void
  /** Toggle recording on/off */
  toggleRecording: () => void
  /** Clear the transcript */
  clearTranscript: () => void
  /** Any error that occurred */
  error: string | null
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const { onTranscript, onError } = options

  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Check if MediaRecorder is supported
  const isSupported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  // Start recording
  const startRecording = useCallback(async () => {
    console.log('[useVoiceInput] startRecording called, isSupported:', isSupported)

    if (!isSupported) {
      const msg = 'Voice recording is not supported in this browser'
      console.error('[useVoiceInput]', msg)
      setError(msg)
      onError?.(msg)
      return
    }

    // Reset state
    chunksRef.current = []
    setTranscript('')
    setError(null)

    try {
      console.log('[useVoiceInput] Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      console.log('[useVoiceInput] Microphone access granted')

      // Determine the best supported audio format
      let mimeType = 'audio/webm'
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg'
      }
      console.log('[useVoiceInput] Using MIME type:', mimeType)

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        console.log('[useVoiceInput] Data available, size:', event.data.size)
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstart = () => {
        console.log('[useVoiceInput] Recording started')
        setIsRecording(true)
      }

      mediaRecorder.onstop = async () => {
        console.log('[useVoiceInput] Recording stopped, chunks:', chunksRef.current.length)
        setIsRecording(false)

        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null

        if (chunksRef.current.length === 0) {
          const msg = 'No audio recorded'
          setError(msg)
          onError?.(msg)
          return
        }

        // Combine chunks into a single blob
        const audioBlob = new Blob(chunksRef.current, { type: mimeType })
        console.log('[useVoiceInput] Audio blob size:', audioBlob.size)

        // Convert to base64 and send to Whisper
        setIsTranscribing(true)
        try {
          const base64 = await blobToBase64(audioBlob)
          console.log('[useVoiceInput] Sending to Whisper API...')

          const result = await window.electronAPI.voiceTranscribe(base64, mimeType)
          console.log('[useVoiceInput] Whisper result:', result)

          if (result.success && result.text) {
            setTranscript(result.text)
            onTranscript?.(result.text)
          } else {
            const errorMsg = result.error || 'Transcription failed'
            setError(errorMsg)
            onError?.(errorMsg)
          }
        } catch (err) {
          console.error('[useVoiceInput] Transcription error:', err)
          const errorMsg = err instanceof Error ? err.message : 'Transcription failed'
          setError(errorMsg)
          onError?.(errorMsg)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorder.onerror = (event) => {
        console.error('[useVoiceInput] MediaRecorder error:', event)
        setError('Recording error')
        onError?.('Recording error')
        setIsRecording(false)
      }

      // Start recording with timeslice to get data periodically
      mediaRecorder.start(1000)
    } catch (err) {
      console.error('[useVoiceInput] Failed to start recording:', err)
      const errorMsg = getErrorMessage(err)
      setError(errorMsg)
      onError?.(errorMsg)
    }
  }, [isSupported, onError, onTranscript])

  // Stop recording
  const stopRecording = useCallback(() => {
    console.log('[useVoiceInput] stopRecording called')
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    // Also stop stream tracks as backup
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
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
    setTranscript('')
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  return {
    isSupported,
    isRecording,
    isTranscribing,
    transcript,
    startRecording,
    stopRecording,
    toggleRecording,
    clearTranscript,
    error,
  }
}

/**
 * Convert a Blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      } else {
        reject(new Error('Failed to convert blob to base64'))
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert errors to user-friendly messages
 */
function getErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'Microphone access denied. Please allow microphone access in System Preferences > Privacy & Security > Microphone.'
      case 'NotFoundError':
        return 'No microphone found. Please check your microphone settings.'
      case 'NotReadableError':
        return 'Microphone is in use by another application.'
      default:
        return `Microphone error: ${err.message}`
    }
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'Failed to start voice recording'
}
