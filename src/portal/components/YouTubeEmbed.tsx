import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Play, Pause, Link2, RotateCcw, FastForward, PlayCircle } from 'lucide-react';
import { formatSeconds } from '../utils/youtube';

export interface YouTubeEmbedHandle {
  seekTo: (seconds: number) => void;
  reset: () => void;
}

interface YouTubeEmbedProps {
  videoId: string;
  title: string;
  subtitle?: string;
  playerRef?: Ref<YouTubeEmbedHandle>;
  onReplaceUrl?: (url: string) => void;
}

export function YouTubeEmbed({
  videoId,
  title,
  subtitle,
  playerRef,
  onReplaceUrl,
}: YouTubeEmbedProps) {
  const isDemo = !videoId || videoId.startsWith('demo_');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const jumpTimerRef = useRef<number | null>(null);

  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoTime, setDemoTime] = useState(0);
  const demoDuration = 300;

  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    return () => {
      if (jumpTimerRef.current !== null) {
        window.clearTimeout(jumpTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!demoPlaying || !isDemo) return;
    const id = window.setInterval(() => {
      setDemoTime((prev) => {
        if (prev >= demoDuration) {
          setDemoPlaying(false);
          return demoDuration;
        }
        return prev + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [demoPlaying, isDemo]);

  useImperativeHandle(
    playerRef,
    () => ({
      seekTo(seconds: number) {
        const targetSec = Math.max(0, Math.floor(seconds));
        setJumpNotice(`▶ ${formatSeconds(targetSec)} にジャンプしました`);

        if (isDemo) {
          setDemoTime(Math.min(demoDuration, targetSec));
          setDemoPlaying(true);
        } else if (iframeRef.current?.contentWindow) {
          const win = iframeRef.current.contentWindow;
          win.postMessage(
            JSON.stringify({ event: 'command', func: 'seekTo', args: [targetSec, true] }),
            '*'
          );
          win.postMessage(
            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
            '*'
          );
        }

        if (jumpTimerRef.current !== null) {
          window.clearTimeout(jumpTimerRef.current);
        }
        jumpTimerRef.current = window.setTimeout(() => {
          setJumpNotice(null);
          jumpTimerRef.current = null;
        }, 2600);
      },
      reset() {
        setDemoPlaying(false);
        setDemoTime(0);
        setJumpNotice(null);
        if (jumpTimerRef.current !== null) {
          window.clearTimeout(jumpTimerRef.current);
          jumpTimerRef.current = null;
        }
      },
    }),
    [isDemo]
  );

  const handleApplyUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || !onReplaceUrl) return;
    onReplaceUrl(urlInput.trim());
    setUrlInput('');
    setShowUrlForm(false);
  };

  return (
    <div className="yt-player-shell">
      <div className="yt-aspect-box">
        {!isDemo ? (
          <iframe
            ref={iframeRef}
            key={videoId}
            className="yt-iframe"
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&playsinline=1&modestbranding=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <div className="yt-demo-stage">
            <div className="yt-demo-court-lines" />
            <div className="yt-demo-top-row">
              <span className="yt-demo-badge">
                <PlayCircle size={14} /> 試作プレビュー動画
              </span>
              {subtitle && <span className="yt-demo-sub">{subtitle}</span>}
            </div>

            <div className="yt-demo-center">
              <button
                type="button"
                className="yt-demo-play-btn"
                onClick={() => setDemoPlaying((p) => !p)}
                aria-label={demoPlaying ? '一時停止' : '再生'}
              >
                {demoPlaying ? <Pause size={26} /> : <Play size={26} fill="currentColor" />}
              </button>
              <div className="yt-demo-title">{title}</div>
              <div className="yt-demo-hint">
                スタッツや時刻をタップするとここに再生位置が連動します
              </div>
            </div>

            <div className="yt-demo-controls">
              <button
                type="button"
                className="yt-demo-skip"
                onClick={() => setDemoTime((t) => Math.max(0, t - 5))}
                title="5秒戻す"
              >
                <RotateCcw size={13} /> 5s
              </button>
              <input
                type="range"
                min={0}
                max={demoDuration}
                value={demoTime}
                onChange={(e) => setDemoTime(Number(e.target.value))}
                className="yt-demo-seek"
                aria-label="再生位置"
              />
              <button
                type="button"
                className="yt-demo-skip"
                onClick={() => setDemoTime((t) => Math.min(demoDuration, t + 5))}
                title="5秒進む"
              >
                5s <FastForward size={13} />
              </button>
              <span className="yt-demo-clock">
                {formatSeconds(demoTime)} / {formatSeconds(demoDuration)}
              </span>
            </div>
          </div>
        )}

        {jumpNotice && <div className="yt-jump-toast">{jumpNotice}</div>}
      </div>

      {onReplaceUrl && (
        <div className="yt-replace-bar">
          {!showUrlForm ? (
            <button
              type="button"
              className="yt-replace-toggle"
              onClick={() => setShowUrlForm(true)}
            >
              <Link2 size={14} />
              {isDemo
                ? '実際のYouTube URLを貼って再生を試す'
                : '別のYouTube URLに差し替える'}
            </button>
          ) : (
            <form onSubmit={handleApplyUrl} className="yt-replace-form">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="portal-input"
              />
              <button type="submit" className="btn-accent btn-sm">
                反映
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setShowUrlForm(false)}
              >
                閉じる
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
