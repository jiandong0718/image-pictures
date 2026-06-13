import { useEffect } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { createDefaultOpenAIProfile, DEFAULT_IMAGES_MODEL, mergeImportedSettings, normalizeSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import AgentWorkspace from './components/AgentWorkspace'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'

let customProviderConfigUrlImportStarted = false
const WORKBENCH_API_PROFILE_ID = 'workbench-global'

function isEmbeddedInWorkbench() {
  return window.parent !== window
}

async function fetchWorkbenchPlaygroundConfig() {
  const response = await fetch('/api/playground-config', { cache: 'no-store' })
  if (!response.ok) return null
  const data = await response.json().catch(() => null)
  const config = data?.config
  if (!config || typeof config !== 'object') return null

  return {
    uploaded: Boolean(config.uploaded),
    apiBase: typeof config.apiBase === 'string' ? config.apiBase : '',
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    model: typeof config.model === 'string' && config.model.trim() ? config.model : DEFAULT_IMAGES_MODEL,
  }
}

function applyWorkbenchPlaygroundConfig(config: Awaited<ReturnType<typeof fetchWorkbenchPlaygroundConfig>>) {
  if (!config) return

  const state = useStore.getState()
  const settings = normalizeSettings(state.settings)
  const existing = settings.profiles.find((profile) => profile.id === WORKBENCH_API_PROFILE_ID)
  const profile = createDefaultOpenAIProfile({
    id: WORKBENCH_API_PROFILE_ID,
    name: '工作台全局配置',
    baseUrl: config.apiBase || existing?.baseUrl || settings.baseUrl,
    apiKey: config.uploaded ? config.apiKey : '',
    model: config.model || existing?.model || DEFAULT_IMAGES_MODEL,
    timeout: existing?.timeout ?? settings.timeout,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    streamImages: false,
  })

  state.setSettings(normalizeSettings({
    ...settings,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    streamImages: profile.streamImages,
    profiles: [
      profile,
      ...settings.profiles.filter((item) => item.id !== WORKBENCH_API_PROFILE_ID),
    ],
    activeProfileId: WORKBENCH_API_PROFILE_ID,
  }))
}

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    const customProviderConfigUrl = getCustomProviderConfigUrl()
    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    if (!isEmbeddedInWorkbench()) return

    let disposed = false
    const syncConfig = async () => {
      const config = await fetchWorkbenchPlaygroundConfig()
      if (!disposed) applyWorkbenchPlaygroundConfig(config)
    }
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type === 'image-workbench:config-changed') {
        void syncConfig()
      }
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage({ type: 'image-workbench:request-config' }, window.location.origin)
    void syncConfig()

    return () => {
      disposed = true
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <Header />
      {appMode === 'agent' ? (
        <AgentWorkspace />
      ) : (
        <main data-home-main data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
          </div>
        </main>
      )}
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <SupportPromptModal />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
