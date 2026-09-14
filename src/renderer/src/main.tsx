import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PetView from './components/pet/PetView'
import './styles/globals.css'

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[renderer] 未捕获渲染错误:', error.stack ?? error.message)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm">
          <span className="text-destructive">页面出错了</span>
          <pre className="max-w-[80%] overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// 桌宠窗加载 #pet 路由，挂载精简视图而非完整 App（不起管线/侧栏/设置）
const isPet = window.location.hash === '#pet'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>{isPet ? <PetView /> : <App />}</RootErrorBoundary>
  </React.StrictMode>
)
