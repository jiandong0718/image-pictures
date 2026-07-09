import { useEffect } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { DEFAULT_IMAGES_MODEL, mergeImportedSettings, normalizeSettings } from './lib/apiProfiles'
import type { ApiProfile, CustomProviderDefinition } from './types'
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
const WORKBENCH_ASYNC_PROVIDER_ID = 'workbench-async'

// 生图请求体（generations / edits 通用），与服务端 full-playground 代理转发给上游的字段一致。
const WORKBENCH_ASYNC_BODY = {
  model: '$profile.model',
  prompt: '$prompt',
  size: '$params.size',
  quality: '$params.quality',
  output_format: '$params.output_format',
  moderation: '$params.moderation',
  output_compression: '$params.output_compression',
  n: '$params.n',
}

// 异步自定义服务商：提交拿 taskId（{taskId}），再轮询 tasks/{task_id}。
// 契约与 server.js 的 /api/full-playground-proxy 逐字对齐——单条请求秒回，彻底绕开 Cloudflare 100s 超时。
const WORKBENCH_ASYNC_PROVIDER: CustomProviderDefinition = {
  id: WORKBENCH_ASYNC_PROVIDER_ID,
  name: '工作台异步',
  template: 'http-image',
  submit: {
    path: 'images/generations',
    method: 'POST',
    contentType: 'json',
    query: { async: 'true' },
    body: WORKBENCH_ASYNC_BODY,
    taskIdPath: 'taskId',
  },
  editSubmit: {
    path: 'images/edits',
    method: 'POST',
    contentType: 'multipart',
    query: { async: 'true' },
    body: WORKBENCH_ASYNC_BODY,
    files: [
      { field: 'image[]', source: 'inputImages', array: true },
      { field: 'mask', source: 'mask' },
    ],
    taskIdPath: 'taskId',
  },
  poll: {
    path: 'tasks/{task_id}',
    method: 'GET',
    intervalSeconds: 3,
    statusPath: 'status',
    successValues: ['done'],
    failureValues: ['error'],
    errorPath: 'error',
    result: { imageUrlPaths: ['result.images.*.url'], b64JsonPaths: [] },
  },
}

function isEmbeddedInWorkbench() {
  return window.parent !== window
}

function normalizeWorkbenchTheme(value: unknown) {
  return value === 'xianxia' ? 'xianxia' : 'tech'
}

function applyWorkbenchTheme(value: unknown) {
  document.documentElement.dataset.workbenchTheme = normalizeWorkbenchTheme(value)
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
  // provider 指向异步自定义服务商 → 走 submit + 轮询，不再单条同步请求撞 100s 超时。
  const profile: ApiProfile = {
    id: WORKBENCH_API_PROFILE_ID,
    name: '工作台全局配置',
    provider: WORKBENCH_ASYNC_PROVIDER_ID,
    baseUrl: config.apiBase || existing?.baseUrl || settings.baseUrl,
    apiKey: config.uploaded ? config.apiKey : '',
    model: config.model || existing?.model || DEFAULT_IMAGES_MODEL,
    timeout: existing?.timeout ?? settings.timeout,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false, // 必须 false：异步任务在开代理时会被 vendor 拒绝
    streamImages: false,
  }

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
    customProviders: [
      WORKBENCH_ASYNC_PROVIDER,
      ...settings.customProviders.filter((item) => item.id !== WORKBENCH_ASYNC_PROVIDER_ID),
    ],
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

    document.documentElement.classList.add('workbench-embed')
    document.documentElement.classList.remove('theme-dark')
    applyWorkbenchTheme('tech')

    let disposed = false
    const syncConfig = async () => {
      const config = await fetchWorkbenchPlaygroundConfig()
      if (!disposed) applyWorkbenchPlaygroundConfig(config)
    }
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type === 'image-workbench:config-changed') {
        void syncConfig()
      } else if (event.data?.type === 'image-workbench:theme-changed') {
        applyWorkbenchTheme(event.data.theme)
      }
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage({ type: 'image-workbench:request-config' }, window.location.origin)
    window.parent.postMessage({ type: 'image-workbench:request-theme' }, window.location.origin)
    void syncConfig()

    return () => {
      disposed = true
      document.documentElement.classList.remove('workbench-embed')
      delete document.documentElement.dataset.workbenchTheme
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
