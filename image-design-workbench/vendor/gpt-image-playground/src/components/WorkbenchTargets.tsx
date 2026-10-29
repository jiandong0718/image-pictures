import { useEffect, useRef } from 'react'

// 使用宿主提供的同一套节点选择器，避免底部输入区维护第二套模型目录。
export default function WorkbenchTargets() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false
    let control: { configured: boolean; value: () => { endpointId: string; model: string } } | undefined
    const send = () => {
      if (!disposed && control) window.dispatchEvent(new CustomEvent('image-workbench:local-target', { detail: { ...control.value(), configured: control.configured } }))
    }
    window.addEventListener('image-workbench:request-local-target', send)
    const start = async () => {
      const moduleUrl = '/shared/image-target.js'
      const runtime = await import(/* @vite-ignore */ moduleUrl)
      const response = await fetch('/api/auth/me')
      if (!response.ok) throw new Error('请重新登录')
      const data = await response.json()
      if (disposed || !host.current) return
      control = await runtime.mountImageTarget(host.current, { storageKey: `imageStudio:target:${data.user.id}:full-playground`, onChange: send })
      send()
    }
    void start().catch(() => { if (!disposed && host.current) host.current.textContent = '节点加载失败，请刷新重试。' })
    return () => { disposed = true; window.removeEventListener('image-workbench:request-local-target', send) }
  }, [])
  return <div className="workbench-targets" ref={host} />
}
