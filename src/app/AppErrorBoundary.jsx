import React from 'react';

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('頁面顯示失敗', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" className="app-error-fallback">
        <h1>頁面暫時無法顯示</h1>
        <p>操作未完成。請返回上一頁，或重新載入後再試。</p>
        <div className="app-error-actions">
          {this.props.onBack && <button type="button" onClick={this.props.onBack}>返回上一頁</button>}
          <button type="button" onClick={() => window.location.reload()}>重新載入</button>
        </div>
        <details>
          <summary>錯誤資訊</summary>
          <pre>{this.state.error.message || String(this.state.error)}</pre>
        </details>
      </main>
    );
  }
}
