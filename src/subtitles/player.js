let youtubeIframeApiPromise = null;

export function loadYoutubeIframeApi() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('目前無法載入 YouTube 播放器'));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;
  const promise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const handleReady = () => {
      if (window.onYouTubeIframeAPIReady === handleReady) window.onYouTubeIframeAPIReady = previousReady;
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube 播放器初始化失敗'));
    };
    window.onYouTubeIframeAPIReady = handleReady;
    let script = document.querySelector('script[data-youtube-iframe-api]');
    let shouldAppend = false;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeIframeApi = 'true';
      shouldAppend = true;
    }
    script.addEventListener('error', () => {
      if (youtubeIframeApiPromise === promise) youtubeIframeApiPromise = null;
      if (window.onYouTubeIframeAPIReady === handleReady) window.onYouTubeIframeAPIReady = previousReady;
      script.remove();
      reject(new Error('YouTube 播放器載入失敗'));
    }, { once: true });
    if (shouldAppend) document.head.appendChild(script);
  });
  youtubeIframeApiPromise = promise;
  return youtubeIframeApiPromise;
}

export function subtitleTimeLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
