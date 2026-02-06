/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - API Connection (opens OnboardingWizard for editing)
 * - About (version, updates)
 *
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { X, Eye, EyeOff, Check } from 'lucide-react'
import { Spinner, FullscreenOverlayBase } from '@craft-agent/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import type { AuthType } from '../../../shared/types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingWizard } from '@/components/onboarding'
import { useAppShellContext } from '@/context/AppShellContext'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { refreshCustomModel } = useAppShellContext()

  // API Connection state (read-only display — editing is done via OnboardingWizard overlay)
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [hasCredential, setHasCredential] = useState(false)
  const [showApiSetup, setShowApiSetup] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // OpenAI API key state (for voice transcription)
  const [openAIKey, setOpenAIKey] = useState('')
  const [openAIKeyInput, setOpenAIKeyInput] = useState('')
  const [showOpenAIKey, setShowOpenAIKey] = useState(false)
  const [openAIKeySaving, setOpenAIKeySaving] = useState(false)
  const [openAIKeySaved, setOpenAIKeySaved] = useState(false)

  // Perplexity API key state (for web search delegation)
  const [perplexityKey, setPerplexityKey] = useState('')
  const [perplexityKeyInput, setPerplexityKeyInput] = useState('')
  const [showPerplexityKey, setShowPerplexityKey] = useState(false)
  const [perplexityKeySaving, setPerplexityKeySaving] = useState(false)
  const [perplexityKeySaved, setPerplexityKeySaved] = useState(false)

  // Gemini API key state (for large context analysis)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [geminiKeySaving, setGeminiKeySaving] = useState(false)
  const [geminiKeySaved, setGeminiKeySaved] = useState(false)

  // fal.ai API key state (for image generation models)
  const [falKey, setFalKey] = useState('')
  const [falKeyInput, setFalKeyInput] = useState('')
  const [showFalKey, setShowFalKey] = useState(false)
  const [falKeySaving, setFalKeySaving] = useState(false)
  const [falKeySaved, setFalKeySaved] = useState(false)

  // Auto-update state
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  // Load current API connection info and notifications on mount
  const loadConnectionInfo = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [billing, notificationsOn, openAIApiKey, perplexityApiKey, geminiApiKey, falApiKey] = await Promise.all([
        window.electronAPI.getApiSetup(),
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getOpenAIKey(),
        window.electronAPI.getPerplexityKey(),
        window.electronAPI.getGeminiKey(),
        window.electronAPI.getFalKey(),
      ])
      setAuthType(billing.authType)
      setHasCredential(billing.hasCredential)
      setNotificationsEnabled(notificationsOn)
      if (openAIApiKey) {
        setOpenAIKey(openAIApiKey)
        setOpenAIKeyInput(openAIApiKey)
      }
      if (perplexityApiKey) {
        setPerplexityKey(perplexityApiKey)
        setPerplexityKeyInput(perplexityApiKey)
      }
      if (geminiApiKey) {
        setGeminiKey(geminiApiKey)
        setGeminiKeyInput(geminiApiKey)
      }
      if (falApiKey) {
        setFalKey(falApiKey)
        setFalKeyInput(falApiKey)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadConnectionInfo()
  }, [])

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback(() => {
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  // OnboardingWizard hook for editing API connection (starts at api-setup step).
  // onConfigSaved fires immediately when billing is persisted, updating the model UI instantly.
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'api-setup',
    onConfigSaved: refreshCustomModel,
    onComplete: () => {
      closeApiSetup()
      loadConnectionInfo()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
  })

  // Called when user completes the wizard (clicks Finish on completion step)
  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    loadConnectionInfo()
    apiSetupOnboarding.reset()
  }, [closeApiSetup, loadConnectionInfo, apiSetupOnboarding])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  // Save OpenAI API key
  const handleSaveOpenAIKey = useCallback(async () => {
    if (!openAIKeyInput.trim()) return
    setOpenAIKeySaving(true)
    try {
      await window.electronAPI.setOpenAIKey(openAIKeyInput.trim())
      setOpenAIKey(openAIKeyInput.trim())
      setOpenAIKeySaved(true)
      setTimeout(() => setOpenAIKeySaved(false), 2000)
    } catch (error) {
      console.error('Failed to save OpenAI key:', error)
    } finally {
      setOpenAIKeySaving(false)
    }
  }, [openAIKeyInput])

  // Delete OpenAI API key
  const handleDeleteOpenAIKey = useCallback(async () => {
    try {
      await window.electronAPI.deleteOpenAIKey()
      setOpenAIKey('')
      setOpenAIKeyInput('')
    } catch (error) {
      console.error('Failed to delete OpenAI key:', error)
    }
  }, [])

  // Save Perplexity API key
  const handleSavePerplexityKey = useCallback(async () => {
    if (!perplexityKeyInput.trim()) return
    setPerplexityKeySaving(true)
    try {
      await window.electronAPI.setPerplexityKey(perplexityKeyInput.trim())
      setPerplexityKey(perplexityKeyInput.trim())
      setPerplexityKeySaved(true)
      setTimeout(() => setPerplexityKeySaved(false), 2000)
    } catch (error) {
      console.error('Failed to save Perplexity key:', error)
    } finally {
      setPerplexityKeySaving(false)
    }
  }, [perplexityKeyInput])

  // Delete Perplexity API key
  const handleDeletePerplexityKey = useCallback(async () => {
    try {
      await window.electronAPI.deletePerplexityKey()
      setPerplexityKey('')
      setPerplexityKeyInput('')
    } catch (error) {
      console.error('Failed to delete Perplexity key:', error)
    }
  }, [])

  // Save Gemini API key
  const handleSaveGeminiKey = useCallback(async () => {
    if (!geminiKeyInput.trim()) return
    setGeminiKeySaving(true)
    try {
      await window.electronAPI.setGeminiKey(geminiKeyInput.trim())
      setGeminiKey(geminiKeyInput.trim())
      setGeminiKeySaved(true)
      setTimeout(() => setGeminiKeySaved(false), 2000)
    } catch (error) {
      console.error('Failed to save Gemini key:', error)
    } finally {
      setGeminiKeySaving(false)
    }
  }, [geminiKeyInput])

  // Delete Gemini API key
  const handleDeleteGeminiKey = useCallback(async () => {
    try {
      await window.electronAPI.deleteGeminiKey()
      setGeminiKey('')
      setGeminiKeyInput('')
    } catch (error) {
      console.error('Failed to delete Gemini key:', error)
    }
  }, [])

  // Save fal.ai API key
  const handleSaveFalKey = useCallback(async () => {
    if (!falKeyInput.trim()) return
    setFalKeySaving(true)
    try {
      await window.electronAPI.setFalKey(falKeyInput.trim())
      setFalKey(falKeyInput.trim())
      setFalKeySaved(true)
      setTimeout(() => setFalKeySaved(false), 2000)
    } catch (error) {
      console.error('Failed to save fal.ai key:', error)
    } finally {
      setFalKeySaving(false)
    }
  }, [falKeyInput])

  // Delete fal.ai API key
  const handleDeleteFalKey = useCallback(async () => {
    try {
      await window.electronAPI.deleteFalKey()
      setFalKey('')
      setFalKeyInput('')
    } catch (error) {
      console.error('Failed to delete fal.ai key:', error)
    }
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="App Settings" actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Notifications */}
            <SettingsSection title="Notifications">
              <SettingsCard>
                <SettingsToggle
                  label="Desktop notifications"
                  description="Get notified when AI finishes working in a chat."
                  checked={notificationsEnabled}
                  onCheckedChange={handleNotificationsEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            {/* API Connection */}
            <SettingsSection title="API Connection" description="How your AI agents connect to language models.">
              <SettingsCard>
                <SettingsRow
                  label="Connection type"
                  description={
                    authType === 'oauth_token' && hasCredential
                      ? 'Claude Pro/Max — using your Claude subscription'
                      : authType === 'api_key' && hasCredential
                        ? 'API Key — Anthropic, OpenRouter, or compatible API'
                        : 'Not configured'
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openApiSetup}
                  >
                    Edit
                  </Button>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>

            {/* Integrations */}
            <SettingsSection title="Integrations" description="Connect external services for additional features.">
              <SettingsCard>
                <SettingsRow
                  label="OpenAI API Key"
                  description="Used for voice-to-text transcription (Whisper). Get your key from platform.openai.com"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type={showOpenAIKey ? 'text' : 'password'}
                        value={openAIKeyInput}
                        onChange={(e) => setOpenAIKeyInput(e.target.value)}
                        placeholder="sk-..."
                        className="w-[280px] pr-8 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showOpenAIKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveOpenAIKey}
                      disabled={!openAIKeyInput.trim() || openAIKeyInput === openAIKey || openAIKeySaving}
                    >
                      {openAIKeySaved ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Saved
                        </>
                      ) : openAIKeySaving ? (
                        <>
                          <Spinner className="mr-1" />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                    {openAIKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeleteOpenAIKey}
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </SettingsRow>

                {/* Perplexity API Key */}
                <SettingsRow
                  label="Perplexity API Key"
                  description="Used for real-time web search with citations. Get your key from perplexity.ai/settings/api"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type={showPerplexityKey ? 'text' : 'password'}
                        value={perplexityKeyInput}
                        onChange={(e) => setPerplexityKeyInput(e.target.value)}
                        placeholder="pplx-..."
                        className="w-[280px] pr-8 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPerplexityKey(!showPerplexityKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPerplexityKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSavePerplexityKey}
                      disabled={!perplexityKeyInput.trim() || perplexityKeyInput === perplexityKey || perplexityKeySaving}
                    >
                      {perplexityKeySaved ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Saved
                        </>
                      ) : perplexityKeySaving ? (
                        <>
                          <Spinner className="mr-1" />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                    {perplexityKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeletePerplexityKey}
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </SettingsRow>

                {/* Gemini API Key */}
                <SettingsRow
                  label="Google Gemini API Key"
                  description="Used for large context analysis (1M+ tokens). Get your key from aistudio.google.com/apikey"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={geminiKeyInput}
                        onChange={(e) => setGeminiKeyInput(e.target.value)}
                        placeholder="AIza..."
                        className="w-[280px] pr-8 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveGeminiKey}
                      disabled={!geminiKeyInput.trim() || geminiKeyInput === geminiKey || geminiKeySaving}
                    >
                      {geminiKeySaved ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Saved
                        </>
                      ) : geminiKeySaving ? (
                        <>
                          <Spinner className="mr-1" />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                    {geminiKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeleteGeminiKey}
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </SettingsRow>

                {/* fal.ai API Key */}
                <SettingsRow
                  label="fal.ai API Key"
                  description="Used for AI image generation (Ideogram, Imagen, Reve). Get your key from fal.ai/dashboard/keys"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type={showFalKey ? 'text' : 'password'}
                        value={falKeyInput}
                        onChange={(e) => setFalKeyInput(e.target.value)}
                        placeholder="fal-..."
                        className="w-[280px] pr-8 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFalKey(!showFalKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showFalKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveFalKey}
                      disabled={!falKeyInput.trim() || falKeyInput === falKey || falKeySaving}
                    >
                      {falKeySaved ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Saved
                        </>
                      ) : falKeySaving ? (
                        <>
                          <Spinner className="mr-1" />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                    {falKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeleteFalKey}
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>

            {/* API Setup Fullscreen Overlay — reuses the OnboardingWizard starting at the api-setup step */}
            <FullscreenOverlayBase
              isOpen={showApiSetup}
              onClose={closeApiSetup}
              className="z-splash flex flex-col bg-foreground-2"
            >
              <OnboardingWizard
                state={apiSetupOnboarding.state}
                onContinue={apiSetupOnboarding.handleContinue}
                onBack={apiSetupOnboarding.handleBack}
                onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                onFinish={handleApiSetupFinish}
                isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                className="h-full"
              />
              {/* Close button — rendered AFTER the wizard so it paints above its titlebar-drag-region */}
              <div
                className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                style={{ zIndex: 'var(--z-fullscreen, 350)' }}
              >
                <button
                  onClick={closeApiSetup}
                  className="p-1.5 rounded-[6px] transition-all bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="Close (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </FullscreenOverlayBase>

            {/* About */}
            <SettingsSection title="About">
              <SettingsCard>
                <SettingsRow label="Version">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {updateChecker.updateInfo?.currentVersion ?? 'Loading...'}
                    </span>
                    {/* Show downloading indicator when update is being downloaded */}
                    {updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Spinner className="w-3 h-3" />
                        <span>Downloading v{updateChecker.updateInfo.latestVersion} ({updateChecker.downloadProgress}%)</span>
                      </div>
                    )}
                  </div>
                </SettingsRow>
                <SettingsRow label="Check for updates">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingForUpdates}
                  >
                    {isCheckingForUpdates ? (
                      <>
                        <Spinner className="mr-1.5" />
                        Checking...
                      </>
                    ) : (
                      'Check Now'
                    )}
                  </Button>
                </SettingsRow>
                {updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                  <SettingsRow label="Update ready">
                    <Button
                      size="sm"
                      onClick={updateChecker.installUpdate}
                    >
                      Restart to Update to v{updateChecker.updateInfo.latestVersion}
                    </Button>
                  </SettingsRow>
                )}
              </SettingsCard>
            </SettingsSection>
          </div>
        </div>
        </ScrollArea>
      </div>
    </div>
  )
}
