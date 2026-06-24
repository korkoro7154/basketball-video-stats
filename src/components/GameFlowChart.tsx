import type { StatsEvent } from '../types';
import { formatTime, getPoints } from '../utils/statsHelper';
import { TrendingUp } from 'lucide-react';

interface GameFlowChartProps {
  events: StatsEvent[];
  duration: number;
  onJumpToTime: (time: number) => void;
}

interface ScorePoint {
  time: number;
  homeScore: number;
  awayScore: number;
  event?: StatsEvent; // その得点をもたらしたイベント
}

export const GameFlowChart: React.FC<GameFlowChartProps> = ({ events, duration, onJumpToTime }) => {
  // 得点イベントのみを抽出し、タイムスタンプ昇順でソート
  const scoreEvents = events
    .filter(e => ['3P_MADE', '2P_MADE', 'FT_MADE'].includes(e.type))
    .sort((a, b) => a.timestamp - b.timestamp);

  // 時系列の累積得点ポイントリストを作成
  const points: ScorePoint[] = [{ time: 0, homeScore: 0, awayScore: 0 }];
  let currentHome = 0;
  let currentAway = 0;

  scoreEvents.forEach(e => {
    const pts = getPoints(e.type);
    if (e.team === 'home') {
      currentHome += pts;
    } else {
      currentAway += pts;
    }
    points.push({
      time: e.timestamp,
      homeScore: currentHome,
      awayScore: currentAway,
      event: e
    });
  });

  // 最後のデータとして、現在の最大時間での得点を入れて線を引く
  const maxTime = duration > 0 ? duration : Math.max(...points.map(p => p.time), 10);
  if (points[points.length - 1].time < maxTime) {
    points.push({
      time: maxTime,
      homeScore: currentHome,
      awayScore: currentAway
    });
  }

  // SVG描画用のサイズ定義
  const width = 600;
  const height = 180;
  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // 最大スコアの決定
  const maxScore = Math.max(
    ...points.map(p => Math.max(p.homeScore, p.awayScore)),
    10 // 最低でもY軸は10点分とる
  );

  // 座標変換関数
  const getX = (time: number) => {
    return paddingLeft + (time / maxTime) * chartWidth;
  };

  const getY = (score: number) => {
    return paddingTop + chartHeight - (score / maxScore) * chartHeight;
  };

  // 折れ線のパスを生成
  let homePath = '';
  let awayPath = '';

  points.forEach((p, idx) => {
    const x = getX(p.time);
    const yHome = getY(p.homeScore);
    const yAway = getY(p.awayScore);

    if (idx === 0) {
      homePath = `M ${x} ${yHome}`;
      awayPath = `M ${x} ${yAway}`;
    } else {
      // 階段状（ステップ）の線にするか、直線にするか
      // バスケのスコア推移は階段状（得点が入った瞬間にステップアップする）なので、階段状で描画すると正確
      const prevYHome = getY(points[idx - 1].homeScore);
      const prevYAway = getY(points[idx - 1].awayScore);

      homePath += ` L ${x} ${prevYHome} L ${x} ${yHome}`;
      awayPath += ` L ${x} ${prevYAway} L ${x} ${yAway}`;
    }
  });

  // Y軸の目盛り値
  const yTicks = [];
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push(Math.round((maxScore / tickCount) * i));
  }

  // X軸の目盛り値（4等分）
  const xTicks = [];
  for (let i = 0; i <= 4; i++) {
    xTicks.push((maxTime / 4) * i);
  }

  return (
    <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TrendingUp size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>スコア推移（ゲームフロー）</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '3px', background: 'var(--accent-color)', borderRadius: '2px' }} />
            <span>自チーム: {currentHome}点</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '3px', background: 'var(--color-danger)', borderRadius: '2px' }} />
            <span>相手チーム: {currentAway}点</span>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
        {events.length === 0 ? (
          <div style={{ height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '0.9rem' }}>
            得点が記録されるとグラフが表示されます
          </div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', minWidth: '500px', display: 'block' }}>
            {/* 横グリッド線 */}
            {yTicks.map(val => (
              <g key={val}>
                <line
                  x1={paddingLeft}
                  y1={getY(val)}
                  x2={width - paddingRight}
                  y2={getY(val)}
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={getY(val) + 4}
                  fill="#777"
                  fontSize="9px"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            ))}

            {/* X軸の目盛り */}
            {xTicks.map(val => (
              <g key={val}>
                <line
                  x1={getX(val)}
                  y1={paddingTop}
                  x2={getX(val)}
                  y2={paddingTop + chartHeight}
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeWidth="1"
                />
                <text
                  x={getX(val)}
                  y={paddingTop + chartHeight + 16}
                  fill="#777"
                  fontSize="9px"
                  textAnchor="middle"
                >
                  {formatTime(val)}
                </text>
              </g>
            ))}

            {/* 相手チーム折れ線パス */}
            <path
              d={awayPath}
              fill="none"
              stroke="var(--color-danger)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />

            {/* 自チーム折れ線パス */}
            <path
              d={homePath}
              fill="none"
              stroke="var(--accent-color)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0px 2px 4px rgba(255,107,0,0.2))' }}
            />

            {/* インタラクティブな得点マーカー (自チームの得点イベントの丸点) */}
            {points.map((p, idx) => {
              // 0点と最後の延長点は描画しない、自チームまたは相手チームの得点イベントがあるポイントのみ
              if (idx === 0 || !p.event) return null;

              const isHome = p.event.team === 'home';
              const cx = getX(p.time);
              const cy = getY(isHome ? p.homeScore : p.awayScore);
              const color = isHome ? 'var(--accent-color)' : 'var(--color-danger)';

              return (
                <g key={p.event.id} style={{ cursor: 'pointer' }} onClick={() => onJumpToTime(p.time)}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r="4"
                    fill={color}
                    stroke="#0b0c10"
                    strokeWidth="1.5"
                    className="chart-dot"
                    style={{ transition: 'all 0.1s' }}
                  />
                  <title>
                    {`${formatTime(p.time)} - ${isHome ? '自チーム' : '相手チーム'} 得点 (+${getPoints(p.event.type)}点) -> ${isHome ? p.homeScore : p.awayScore}点`}
                  </title>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};
