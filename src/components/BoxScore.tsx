import { useState, useEffect, useRef } from 'react';
import type { Player, StatsEvent, StatType, Quarter } from '../types';
import { calculateBoxScore, calculateTeamStats, formatTime } from '../utils/statsHelper';
import { calculateLineupStats, calculateDuoChemistry } from '../utils/lineupHelper';
import { Play, X, Activity, FolderHeart, Target, Users, BarChart3, FileText, Sparkles, Bot, Send, Key } from 'lucide-react';

interface BoxScoreProps {
  events: StatsEvent[];
  players: Player[];
  onJumpToTime: (time: number) => void;
  appMode: 'game' | 'practice';
  scoutingMode: boolean;
  playingTimes: Record<string, number>;
  // 新規追加
  startingPlayers: Record<Quarter, string[]>;
  quarterDurations: Record<Quarter, number>;
  livePeriodLength: number;
  // プレイリスト連続再生
  isPlaylistPlaying: boolean;
  currentPlayIndex: number;
  playlist: StatsEvent[];
  onStartPlaylist: (events: StatsEvent[]) => void;
  onStopPlaylist: () => void;
}

const getCompactEventLabel = (type: StatType): string => {
  switch (type) {
    case '3P_MADE': return '3Pin';
    case '3P_MISS': return '3Pout';
    case '2P_MADE': return '2Pin';
    case '2P_MISS': return '2Pout';
    case 'FT_MADE': return 'FTin';
    case 'FT_MISS': return 'FTout';
    case 'AST': return 'AST';
    case 'OREB': return 'OREB';
    case 'DREB': return 'DREB';
    case 'STL': return 'STL';
    case 'BLK': return 'BLK';
    case 'TO': return 'TO';
    case 'PF': return 'Foul';
    default: return type;
  }
};

interface ClipSelector {
  playerName: string;
  statLabel: string;
  filteredEvents: StatsEvent[];
}

export const BoxScore: React.FC<BoxScoreProps> = ({
  events,
  players,
  onJumpToTime,
  appMode,
  scoutingMode,
  playingTimes,
  startingPlayers,
  quarterDurations,
  livePeriodLength,
  isPlaylistPlaying,
  currentPlayIndex,
  playlist,
  onStartPlaylist,
  onStopPlaylist
}) => {
  const [selectedClips, setSelectedClips] = useState<ClipSelector | null>(null);
  
  // 練習モードでのトグルオープンされているタグ
  const [expandedPracticeTag, setExpandedPracticeTag] = useState<string | null>(null);

  // ショットチャート表示対象の選手ID / チーム
  const [selectedChartPlayerId, setSelectedChartPlayerId] = useState<string>('all-home');

  // 新設：タブ状態 (試合・ライブモード用)
  const [activeTab, setActiveTab] = useState<'box-score' | 'shot-chart' | 'lineups' | 'ai-coach'>('box-score');

  // AI アシスタント（コーチ）用状態
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('courtvision_gemini_api_key') || '');
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => localStorage.getItem('courtvision_ai_demo_mode') === 'true');
  const [modelName, setModelName] = useState<string>(() => localStorage.getItem('courtvision_gemini_model_name') || 'gemini-3.5-flash');
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string; timestamp: Date }>>([
    {
      sender: 'ai',
      text: '🤖 こんにちは！CourtVision AIコーチです。今日の試合のスタッツやイベントログが私の手元にあります。\n「今日の試合のサマリーは？」「最も得点効率の良かったメンバーは？」「ファウルやターンオーバーが発生したシーンを映像で見せて」など、何でも質問してください。APIキーを設定していない場合は、下のクイック質問からデモモードをお試しいただけます！',
      timestamp: new Date()
    }
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // 新設：ラインナップ分析のソート状態
  const [lineupSortField, setLineupSortField] = useState<'duration' | 'plusMinus' | 'ppm'>('duration');
  const [lineupSortAsc, setLineupSortAsc] = useState<boolean>(false);

  // 新設：デュオ相性分析の選択選手ID
  const homePlayersOnly = players.filter(p => p.team === 'home');
  const [selectedDuoPlayerId, setSelectedDuoPlayerId] = useState<string>(() => {
    return homePlayersOnly.length > 0 ? homePlayersOnly[0].id : '';
  });

  // ラインナップ統計の計算 (試合 / ライブモードのみ)
  const lineups = appMode !== 'practice' ? calculateLineupStats(
    events,
    players,
    startingPlayers,
    quarterDurations,
    appMode,
    livePeriodLength
  ) : [];

  // 選択された選手のデュオ相性
  const activeDuoPlayerId = selectedDuoPlayerId || (homePlayersOnly.length > 0 ? homePlayersOnly[0].id : '');
  const duoChemistryList = activeDuoPlayerId
    ? calculateDuoChemistry(activeDuoPlayerId, lineups, players)
    : [];

  // 試合モードのスタッツ集計
  const getPlayerPlusMinus = (playerId: string) => {
    if (appMode === 'practice') return 0;
    return lineups
      .filter(l => l.playerIds.includes(playerId))
      .reduce((sum, l) => sum + l.plusMinus, 0);
  };

  const homePlayerStats = calculateBoxScore(events, players, 'home', playingTimes).map(stat => ({
    ...stat,
    plusMinus: getPlayerPlusMinus(stat.playerId)
  }));
  const awayPlayerStats = calculateBoxScore(events, players, 'away'); // 相手チームは出場時間は表示しない

  const homeTeamStats = calculateTeamStats(events, 'home');
  const awayTeamStats = calculateTeamStats(events, 'away');

  const renderChatMessageText = (text: string) => {
    const lines = text.split('\n');

    return lines.map((line, lineIdx) => {
      let cleanLine = line.trim();
      if (!cleanLine) {
        return <div key={lineIdx} style={{ height: '8px' }} />;
      }

      // Check if it's a header line (e.g., #, ##, ###)
      const headerMatch = cleanLine.match(/^(#{1,6})\s+(.*)$/);
      let isHeader = false;
      let headerLevel = 0;
      if (headerMatch) {
        isHeader = true;
        headerLevel = headerMatch[1].length;
        cleanLine = headerMatch[2];
      }

      // Check if it's a bullet point (e.g., - item or * item)
      const bulletMatch = cleanLine.match(/^[-*+]\s+(.*)$/);
      let isBullet = false;
      if (bulletMatch) {
        isBullet = true;
        cleanLine = bulletMatch[1];
      }

      // Parse inline elements (Bold **text** and Time Links [MM:SS])
      const parseInlineElements = (textStr: string) => {
        const combinedRegex = /(\*\*(.*?)\*\*|\[(\d{1,3}):(\d{2})\])/g;
        const inlineParts: React.ReactNode[] = [];
        let lastIdx = 0;
        let match;

        while ((match = combinedRegex.exec(textStr)) !== null) {
          const matchIndex = match.index;
          if (matchIndex > lastIdx) {
            inlineParts.push(textStr.substring(lastIdx, matchIndex));
          }

          if (match[2] !== undefined) {
            // Bold text
            inlineParts.push(
              <strong key={`b-${matchIndex}`} style={{ color: 'var(--accent-color)', fontWeight: 700 }}>
                {match[2]}
              </strong>
            );
          } else if (match[3] !== undefined && match[4] !== undefined) {
            // Time link button
            const minutes = parseInt(match[3], 10);
            const seconds = parseInt(match[4], 10);
            const totalSeconds = minutes * 60 + seconds;
            const timestampText = match[0];

            inlineParts.push(
              <button
                key={`t-${matchIndex}`}
                onClick={() => onJumpToTime(totalSeconds)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 6px',
                  margin: '0 4px',
                  background: 'rgba(255, 107, 0, 0.15)',
                  border: '1px solid rgba(255, 107, 0, 0.3)',
                  borderRadius: '4px',
                  color: 'var(--accent-color)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85em',
                  verticalAlign: 'middle',
                  transition: 'all 0.15s'
                }}
                className="time-jump-btn"
                title={`${minutes}分${seconds}秒にジャンプ`}
              >
                <Play size={10} fill="var(--accent-color)" />
                {timestampText}
              </button>
            );
          }

          lastIdx = combinedRegex.lastIndex;
        }

        if (lastIdx < textStr.length) {
          inlineParts.push(textStr.substring(lastIdx));
        }

        return inlineParts.length > 0 ? inlineParts : textStr;
      };

      // Render line based on block type
      if (isHeader) {
        const fontSize = headerLevel === 1 ? '1.25rem' : (headerLevel === 2 ? '1.15rem' : '1.05rem');
        return (
          <h4 key={lineIdx} style={{
            fontSize,
            fontWeight: 700,
            margin: '14px 0 6px 0',
            color: '#fff',
            borderBottom: headerLevel <= 2 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            paddingBottom: headerLevel <= 2 ? '6px' : '0'
          }}>
            {parseInlineElements(cleanLine)}
          </h4>
        );
      }

      if (isBullet) {
        return (
          <div key={lineIdx} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            margin: '4px 0',
            paddingLeft: '12px',
            lineHeight: 1.5
          }}>
            <span style={{ color: 'var(--accent-color)', fontSize: '0.85rem', marginTop: '2px' }}>•</span>
            <span style={{ flex: 1 }}>{parseInlineElements(cleanLine)}</span>
          </div>
        );
      }

      // Default line
      return (
        <p key={lineIdx} style={{ margin: '6px 0', lineHeight: 1.6 }}>
          {parseInlineElements(line)}
        </p>
      );
    });
  };

  const getDemoResponse = (promptText: string): string => {
    const text = promptText.trim();
    
    // Calculate first and last score events
    const scoreEvents = events.filter(e => e.type.includes('MADE'));
    const firstScoreStr = scoreEvents.length > 0 ? `[${formatTime(scoreEvents[0].timestamp)}]` : '[00:10]';
    const lastScoreStr = scoreEvents.length > 0 ? `[${formatTime(scoreEvents[scoreEvents.length - 1].timestamp)}]` : '[08:00]';

    // Find top scorers
    const sortedHomePlayers = [...homePlayerStats].sort((a, b) => b.pts - a.pts);
    const topScorersStr = sortedHomePlayers.length > 0 
      ? sortedHomePlayers.slice(0, 2).map(p => `#${p.number} ${p.name} (${p.pts}得点, eFG%: ${p.efgPercent.toFixed(1)}%)`).join('、')
      : 'なし';

    // Find team stats
    const diff = homeTeamStats.pts - awayTeamStats.pts;
    const outcomeStr = diff > 0 ? `自チームが ${diff} 点差で勝利しました。` : (diff < 0 ? `自チームが ${Math.abs(diff)} 点差で敗北しました。` : '引き分けでした。');

    if (text.includes('サマリー') || text.includes('総括') || text.includes('summary')) {
      return `🏀 **試合戦術サマリー (AI Coach Analysis - Demo Mode)**

本日の試合は、最終スコア **自チーム ${homeTeamStats.pts} - ${awayTeamStats.pts} 相手チーム** で、${outcomeStr}

**【オフェンス効率】**
- 自チームの実質シュート成功率（eFG%）は **${homeTeamStats.efgPercent.toFixed(1)}%**、フリースローを含めた得点効率（TS%）は **${homeTeamStats.tsPercent.toFixed(1)}%** でした。
- 対する相手チームは eFG%: **${awayTeamStats.efgPercent.toFixed(1)}%**、TS%: **${awayTeamStats.tsPercent.toFixed(1)}%** となっています。
- チーム得点を牽引した主な選手は、${topScorersStr} です。

**【試合のキーモーメント】**
- 試合開始直後の最初のシュート成功は ${firstScoreStr} でした。ここから試合の流れが生まれました。
- 最終盤のゲーム決定打、または最後の得点シーンは ${lastScoreStr} に記録されています。

**【AIコーチの提言】**
本日のオフェンス効率は良好ですが、さらにポゼッションを増やすためにディフェンスリバウンドの徹底と、トランジションのスピードアップが必要です。APIキーを設定していただくと、Gemini APIがより深く、対話型で戦術プランを作成します！`;
    }

    if (text.includes('ターンオーバー') || text.includes('TO') || text.includes('turnover')) {
      const homeToEvents = events.filter(e => e.team === 'home' && e.type === 'TO');
      
      let toListStr = '';
      if (homeToEvents.length > 0) {
        toListStr = homeToEvents.map(e => {
          const p = players.find(player => player.id === e.playerId);
          const name = p ? p.name : 'チーム';
          const notes = e.notes ? ` (${e.notes})` : '';
          return `- [${formatTime(e.timestamp)}] #${p?.number || ''} ${name}: ターンオーバー${notes}`;
        }).join('\n');
      } else {
        toListStr = '自チームのターンオーバーは記録されていません。素晴らしいボールセーフティです！';
      }

      return `⚠️ **ターンオーバー分析・シーン一覧 (Demo Mode)**

この試合で自チームが記録したターンオーバーは計 **${homeTeamStats.to}** 個です。
ターンオーバーの削減は、相手へのイージーポイントを減らす最重要課題です。

**【ターンオーバー発生シーン一覧】**
${toListStr}

*(※ 上記のタイムスタンプをクリックすると、そのターンオーバーが発生した動画再生位置に直接ジャンプできます)*

**【AIコーチの戦術指導】**
特にプレッシャーを受けた場面でのスペーシングの崩れや、無理なパスが散見されます。動画でミス発生時の周りの選手のサポート位置（レシーブアングル）を確認し、次の練習でボールハンドラーを助ける「エスケープルート」の確保を連動させましょう。`;
    }

    if (text.includes('ラインナップ') || text.includes('相性') || text.includes('lineup')) {
      const sortedLineups = [...lineups].sort((a, b) => b.plusMinus - a.plusMinus);
      
      let bestLineupStr = 'データが不足しています。';
      if (sortedLineups.length > 0) {
        const best = sortedLineups[0];
        const names = best.playerIds.map(id => players.find(p => p.id === id)?.name || id).join(', ');
        const segmentStr = best.segments.length > 0 
          ? `[${formatTime(best.segments[0].start)}]` 
          : '';
        bestLineupStr = `**メンバー:** ${names}
- **同時出場時間:** ${formatTime(best.duration)}
- **得失点差 (+/-):** +${best.plusMinus} (1分あたり得失点: ${best.ppm.toFixed(2)})
- **出場開始シーン:** ${segmentStr} （クリックで出場時間にジャンプ）`;
      }

      let worstLineupStr = 'データが不足しています。';
      if (sortedLineups.length > 1) {
        const worst = sortedLineups[sortedLineups.length - 1];
        const names = worst.playerIds.map(id => players.find(p => p.id === id)?.name || id).join(', ');
        const segmentStr = worst.segments.length > 0 
          ? `[${formatTime(worst.segments[0].start)}]` 
          : '';
        worstLineupStr = `**メンバー:** ${names}
- **同時出場時間:** ${formatTime(worst.duration)}
- **得失点差 (+/-):** ${worst.plusMinus} (1分あたり得失点: ${worst.ppm.toFixed(2)})
- **出場開始シーン:** ${segmentStr} （クリックで出場時間にジャンプ）`;
      }

      return `👥 **ラインナップ相性・オンコート分析 (Demo Mode)**

5人の組み合わせごとの時間帯別スタッツから、本日のベスト/ワーストのラインナップを分析します。

**【本日のベストラインナップ】**
${bestLineupStr}

**【本日の改善ラインナップ】**
${worstLineupStr}

**【AIコーチの戦術指導】**
ベストラインナップ稼働時は、ボールが停滞せずペイントタッチから外へのキックアウトが機能していました。一方で改善ラインナップ時は、ディフェンスリバウンド後の速攻を許す割合が高くなっています。メンバー構成によるディフェンス強度とリバウンド意識のギャップに注意を払う必要があります。`;
    }

    if (text.includes('効率') || text.includes('得点効率') || text.includes('スタッツ') || text.includes('efg') || text.includes('ts')) {
      const topTsPlayer = [...homePlayerStats]
        .filter(p => p.fga > 0)
        .sort((a, b) => b.tsPercent - a.tsPercent)[0];

      const topPmPlayer = [...homePlayerStats].sort((a, b) => b.plusMinus - a.plusMinus)[0];

      return `⚡ **得点効率（アドバンスド・スタッツ）分析 (Demo Mode)**

本日は、シュート成功率（FG%）だけでなく、3Pの付加価値を考慮した **eFG%** 、さらにフリースローの効率も加味した **TS%** に焦点を当てます。

**【効率トッププレイヤー】**
${topTsPlayer ? `- **TS% 第1位:** #${topTsPlayer.number} ${topTsPlayer.name} (TS%: **${topTsPlayer.tsPercent.toFixed(1)}%**, 得点: ${topTsPlayer.pts})` : 'なし'}
${topPmPlayer ? `- **+/- (得失点差) 第1位:** #${topPmPlayer.number} ${topPmPlayer.name} (+/-: **+${topPmPlayer.plusMinus}**)` : 'なし'}

*(※ TS%は 55%〜60% 以上がエリートシューターの指標です)*

**【AIコーチの戦術指導】**
高効率な選手にボールを集めるオフェンスセット（例：ホーンズセットやハイピック＆ロール）を導入することで、ポゼッションあたりの得点期待値（PPP）をさらに最大化できます。
APIキーを設定すると、Gemini APIが対話形式で具体的なオフェンスセットメニューを構築します！`;
    }

    // デフォルト応答
    return `🤖 **ご質問ありがとうございます！ (Demo Mode)**

入力された質問: 「${text}」

デモモードでは、事前に設定された特定のキーワードを含む質問（**「サマリー」「ターンオーバー」「ラインナップ」「効率」**）に対して、実際の試合データから詳細なスタッツやクリック可能な動画ジャンプリンク（例：${firstScoreStr}）を解析して回答を作成します。

ぜひ、右上の「API設定」または下のクイックボタンから上記の質問をお試しいただくか、Google Gemini APIキーを入力して自由な対話形式による本格AI分析をご体験ください！`;
  };

  const handleSendChatMessage = async (promptOverride?: string) => {
    const textToSend = promptOverride || chatInput;
    if (!textToSend.trim()) return;

    // Add user message
    const userMsg = {
      sender: 'user' as const,
      text: textToSend,
      timestamp: new Date()
    };
    
    setChatMessages(prev => [...prev, userMsg]);
    if (!promptOverride) {
      setChatInput('');
    }
    setIsChatLoading(true);

    const currentApiKey = apiKey.trim();
    const useDemo = isDemoMode || !currentApiKey;

    if (useDemo) {
      // Simulate think delay
      setTimeout(() => {
        const demoReply = getDemoResponse(textToSend);
        setChatMessages(prev => [
          ...prev,
          {
            sender: 'ai' as const,
            text: demoReply,
            timestamp: new Date()
          }
        ]);
        setIsChatLoading(false);
      }, 1000);
    } else {
      // Gemini API call
      try {
        const systemPrompt = `
あなたはバスケットボールのプロコーチ兼データアナリストです。
提供されたコンパクトな試合データを絶対的な根拠として質問に答えてください。
回答には具体的な数値（得点、成功率、eFG%、TS%、+/- など）や選手名を交え、戦術的・建設的なフィードバックを行ってください。

【最重要ルール】
- 回答内で動画の特定のシーンを指す際は、必ず \`[MM:SS]\`（例: \`[02:15]\`）という形式で時間を含めてください。このタイムスタンプはクリック可能な動画再生リンクになります。
- 根拠のない事実の捏造は避け、データ（Event Log）の事実のみを述べてください。

【記号凡例 (Legend)】
H: 自チーム (Home), A: 相手チーム (Away)
3PM/3PX: 3P成功/失敗, 2PM/2PX: 2P成功/失敗, FTM/FTX: FT成功/失敗
AST: アシスト, OR/DR: オフェンス/ディフェンスリバウンド, REB: 総リバウンド
STL: スチール, BLK: ブロック, TO: ターンオーバー, PF: 個人ファウル
IN/OUT: 交代入/交代出, TOUT: タイムアウト

【試合データ】
■ 自チーム合計: PTS:${homeTeamStats.pts}, AST:${homeTeamStats.ast}, REB:${homeTeamStats.reb}(OR:${homeTeamStats.oreb}/DR:${homeTeamStats.dreb}), STL:${homeTeamStats.stl}, BLK:${homeTeamStats.blk}, TO:${homeTeamStats.to}, PF:${homeTeamStats.pf}, eFG:${homeTeamStats.efgPercent.toFixed(1)}%, TS:${homeTeamStats.tsPercent.toFixed(1)}%
■ 相手チーム合計: PTS:${awayTeamStats.pts}, AST:${awayTeamStats.ast}, REB:${awayTeamStats.reb}(OR:${awayTeamStats.oreb}/DR:${awayTeamStats.dreb}), STL:${awayTeamStats.stl}, BLK:${awayTeamStats.blk}, TO:${awayTeamStats.to}, PF:${awayTeamStats.pf}, eFG:${awayTeamStats.efgPercent.toFixed(1)}%, TS:${awayTeamStats.tsPercent.toFixed(1)}%

■ 自チーム選手別:
${homePlayerStats.map(p => `#${p.number}${p.name}: PTS:${p.pts}, AST:${p.ast}, REB:${p.reb}(OR:${p.oreb}/DR:${p.dreb}), STL:${p.stl}, BLK:${p.blk}, TO:${p.to}, +/-:${p.plusMinus}, eFG:${p.efgPercent.toFixed(1)}%, TS:${p.tsPercent.toFixed(1)}%, MIN:${formatTime(p.playingTime)}`).join('\n')}

■ 相手チーム選手別:
${awayPlayerStats.map(p => `#${p.number}${p.name}: PTS:${p.pts}, AST:${p.ast}, REB:${p.reb}(OR:${p.oreb}/DR:${p.dreb}), STL:${p.stl}, BLK:${p.blk}, TO:${p.to}, TS:${p.tsPercent.toFixed(1)}%`).join('\n')}

■ 主要ラインナップ (L1〜L5):
${lineups.slice(0, 5).map((l, i) => `L${i+1} [${l.playerIds.map(id => players.find(pl => pl.id === id)?.name || id).join(',')}]: MIN:${formatTime(l.duration)}, PTS:${l.ptsFor}-${l.ptsAgainst}, +/-:${l.plusMinus}, PPM:${l.ppm.toFixed(2)}, Segs:${l.segments.map(s => `[${formatTime(s.start)}-${formatTime(s.end)}]`).join(',')}`).join('\n')}

■ イベントログ (時系列):
${events.map(e => {
  const p = players.find(pl => pl.id === e.playerId);
  const pName = p ? `#${p.number}${p.name}` : 'TEAM';
  const team = e.team === 'home' ? 'H' : 'A';
  
  // Map type to short code
  let typeCode: string = e.type;
  if (e.type === '3P_MADE') typeCode = '3PM';
  else if (e.type === '3P_MISS') typeCode = '3PX';
  else if (e.type === '2P_MADE') typeCode = '2PM';
  else if (e.type === '2P_MISS') typeCode = '2PX';
  else if (e.type === 'FT_MADE') typeCode = 'FTM';
  else if (e.type === 'FT_MISS') typeCode = 'FTX';
  else if (e.type === 'OREB') typeCode = 'OR';
  else if (e.type === 'DREB') typeCode = 'DR';
  else if (e.type === 'SUB_IN') typeCode = 'IN';
  else if (e.type === 'SUB_OUT') typeCode = 'OUT';
  else if (e.type === 'TIMEOUT') typeCode = 'TOUT';
  
  return `[${formatTime(e.timestamp)}] ${team} ${pName} ${typeCode}${e.notes ? `(${e.notes})` : ''}`;
}).join('\n')}
`;

        // Map chat messages to Gemini content format (history)
        const mappedContents = chatMessages.map(m => ({
          role: m.sender === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }]
        }));

        // Skip the initial welcome message from the AI which would cause sequence error
        if (mappedContents.length > 0 && mappedContents[0].role === 'model') {
          mappedContents.shift();
        }

        // Limit history to the last 10 messages
        let finalContents = mappedContents.slice(-10);

        // Ensure the sequence starts with 'user'
        while (finalContents.length > 0 && finalContents[0].role === 'model') {
          finalContents.shift();
        }

        // Append the current message being sent
        finalContents.push({
          role: 'user',
          parts: [{ text: textToSend }]
        });

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${currentApiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: finalContents,
              systemInstruction: {
                parts: [
                  { text: systemPrompt }
                ]
              }
            })
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status}`;
          throw new Error(errMsg);
        }

        const data = await response.json();
        const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。AIからの応答を取得できませんでした。';

        setChatMessages(prev => [
          ...prev,
          {
            sender: 'ai' as const,
            text: replyText,
            timestamp: new Date()
          }
        ]);
      } catch (err: any) {
        console.error('Gemini API Error:', err);
        setChatMessages(prev => [
          ...prev,
          {
            sender: 'ai' as const,
            text: `⚠️ エラーが発生しました。APIキーが正しくないか、通信エラーが発生しました。\nエラー詳細: ${err.message || err}\n\n※ APIキーをお持ちでない場合は、右上の設定から「デモモード」に切り替えることで動作をお試しいただけます。`,
            timestamp: new Date()
          }
        ]);
      } finally {
        setIsChatLoading(false);
      }
    }
  };

  // 特定のスタッツ・特定選手のクリップジャンプ用
  const handleStatClick = (
    playerId: string | null,
    playerName: string,
    types: StatType[],
    statLabel: string,
    team: 'home' | 'away'
  ) => {
    const filtered = events.filter(e => {
      const isTeamMatch = e.team === team;
      const isPlayerMatch = playerId === null ? true : e.playerId === playerId;
      return isTeamMatch && isPlayerMatch && types.includes(e.type);
    });

    if (filtered.length === 0) return;

    setSelectedClips({
      playerName,
      statLabel,
      filteredEvents: filtered.sort((a, b) => a.timestamp - b.timestamp)
    });
  };

  const renderClickableCell = (
    value: number,
    playerId: string | null,
    playerName: string,
    types: StatType[],
    statLabel: string,
    team: 'home' | 'away',
    textDisplay: string = value.toString()
  ) => {
    const isClickable = value > 0;
    return (
      <td
        onClick={() => isClickable && handleStatClick(playerId, playerName, types, statLabel, team)}
        style={{
          textAlign: 'center',
          cursor: isClickable ? 'pointer' : 'default',
          color: isClickable ? (team === 'home' ? 'var(--accent-color)' : 'var(--color-danger)') : '#aaa',
          fontWeight: isClickable ? 700 : 400,
          background: isClickable ? 'rgba(255, 107, 0, 0.01)' : 'transparent',
          transition: 'all 0.15s'
        }}
        className={isClickable ? 'hover-cell' : ''}
        title={isClickable ? `クリックして ${playerName} の ${statLabel} 動画シーンを表示` : ''}
      >
        {textDisplay}
      </td>
    );
  };

  // --- 練習モード時のビュー ---
  if (appMode === 'practice') {
    // 練習モードでは、登録されている練習タグごとに集計
    // イベントからユニークなタグ一覧と、そのカウントを取得
    const practiceEvents = events.filter(e => e.type === 'PRACTICE_TAG' && e.practiceTag);
    const tagCounts: Record<string, number> = {};
    
    practiceEvents.forEach(e => {
      const tag = e.practiceTag!;
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });

    const uniqueTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);

    const handlePracticeTagClick = (tag: string) => {
      setExpandedPracticeTag(expandedPracticeTag === tag ? null : tag);
    };

    const currentTagClips = expandedPracticeTag 
      ? practiceEvents.filter(e => e.practiceTag === expandedPracticeTag).sort((a, b) => a.timestamp - b.timestamp)
      : [];

    return (
      <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          <FolderHeart size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>練習メニュー別クリップ集計 ({practiceEvents.length}件)</h2>
        </div>

        {uniqueTags.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#666', padding: '30px 0', fontSize: '0.9rem' }}>
            練習タグがまだ記録されていません。右側の練習タグボタンを押してタグを追加してください。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ fontSize: '0.8rem', color: '#888' }}>※ 項目をクリックすると、記録された動画シーンのリストが展開されます。</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              {uniqueTags.map(tag => (
                <div key={tag} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    onClick={() => handlePracticeTagClick(tag)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: expandedPracticeTag === tag ? 'rgba(255, 107, 0, 0.1)' : 'rgba(255,255,255,0.02)',
                      border: '1px solid',
                      borderColor: expandedPracticeTag === tag ? 'var(--accent-color)' : 'var(--glass-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontWeight: 600,
                      transition: 'all 0.2s'
                    }}
                  >
                    <span>{tag}</span>
                    <span style={{
                      background: 'var(--bg-tertiary)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontSize: '0.8rem',
                      color: 'var(--accent-color)'
                    }}>
                      {tagCounts[tag]} クリップ
                    </span>
                  </button>

                  {/* 展開時のクリップリスト */}
                  {expandedPracticeTag === tag && (
                    <div className="animate-slide-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)' }}>
                      {currentTagClips.map((clip, idx) => (
                        <button
                          key={clip.id}
                          onClick={() => onJumpToTime(clip.timestamp)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            color: '#fff',
                            fontSize: '0.8rem',
                            textAlign: 'left',
                            transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{idx + 1}.</span>
                            <span style={{ color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                              <Play size={10} fill="var(--accent-color)" /> {formatTime(clip.timestamp)}
                            </span>
                          </div>
                          <span style={{ color: '#aaa', fontSize: '0.75rem', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {clip.notes ? `"${clip.notes}"` : 'メモなし'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- 試合モード時のビュー ---
  return (
    <>
    <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', overflowX: 'auto' }}>
      <style>{`
        .stats-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
          min-width: 800px;
        }
        .stats-table th {
          background: rgba(255,255,255,0.04);
          color: #888;
          font-weight: 600;
          padding: 8px 6px;
          border-bottom: 2px solid rgba(255, 107, 0, 0.2);
          text-align: center;
          white-space: nowrap;
        }
        .stats-table td {
          padding: 10px 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
          transition: all 0.15s;
        }
        .stats-table tbody tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.02);
        }
        .stats-table tbody tr:hover {
          background: rgba(255, 107, 0, 0.06) !important;
          box-shadow: inset 2px 0 0 rgba(255, 107, 0, 0.4);
        }
        .hover-cell:hover {
          background: rgba(255, 107, 0, 0.12) !important;
          color: #fff !important;
          transform: scale(1.05);
        }
        .clip-item:hover {
          background: rgba(255, 107, 0, 0.08) !important;
          border-color: var(--accent-color) !important;
        }

        /* タブボタンスタイル */
        .tab-btn {
          border: none;
          background: transparent;
          color: #888;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .tab-btn.active {
          background: var(--accent-color);
          color: #fff;
        }
        .tab-btn:hover:not(.active) {
          background: rgba(255,255,255,0.03);
          color: #fff;
        }
      `}</style>

      {/* タブ切り替えバー ＆ エクスポートコントロール */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--glass-border)',
        paddingBottom: '10px',
        marginBottom: '10px',
        flexWrap: 'wrap',
        gap: '10px'
      }} className="no-print">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('box-score')}
            className={`tab-btn ${activeTab === 'box-score' ? 'active' : ''}`}
          >
            <BarChart3 size={15} /> 個人成績 (Box Score)
          </button>
          <button
            onClick={() => setActiveTab('shot-chart')}
            className={`tab-btn ${activeTab === 'shot-chart' ? 'active' : ''}`}
          >
            <Target size={15} /> ショット分析 (Shot Chart)
          </button>
          <button
            onClick={() => setActiveTab('lineups')}
            className={`tab-btn ${activeTab === 'lineups' ? 'active' : ''}`}
          >
            <Users size={15} /> ラインナップ相性 (Lineups)
          </button>
          <button
            onClick={() => setActiveTab('ai-coach')}
            className={`tab-btn ${activeTab === 'ai-coach' ? 'active' : ''}`}
          >
            <Sparkles size={15} style={{ color: 'var(--accent-color)' }} /> AIコーチ (AI Assistant)
          </button>
        </div>
      </div>

      {activeTab === 'box-score' && (
        <>
          {/* --- 自チーム ボックススコア --- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} className="no-print">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={20} style={{ color: 'var(--accent-color)' }} />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>ボックススコア（自チーム個人成績）</h2>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#888' }}>※ オレンジの数字をクリックすると動画クリップが再生できます</span>
        </div>

        <table className="stats-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th style={{ textAlign: 'left', width: '120px' }}>選手</th>
              <th>MIN (出場時間)</th>
              <th>PTS</th>
              <th>eFG%</th>
              <th>TS%</th>
              <th>+/-</th>
              <th>AST</th>
              <th>REB</th>
              <th>OREB</th>
              <th>DREB</th>
              <th>STL</th>
              <th>BLK</th>
              <th>TO</th>
              <th>PF</th>
              <th>FG (成功-試投)</th>
              <th>FG%</th>
              <th>3P (成功-試投)</th>
              <th>3P%</th>
              <th>FT (成功-試投)</th>
              <th>FT%</th>
            </tr>
          </thead>
          <tbody>
            {homePlayerStats.map(stat => (
              <tr key={stat.playerId}>
                <td 
                  onClick={() => {
                    const allStatTypes: StatType[] = [
                      '3P_MADE', '3P_MISS', '2P_MADE', '2P_MISS', 
                      'FT_MADE', 'FT_MISS', 'AST', 'OREB', 'DREB', 
                      'STL', 'BLK', 'TO', 'PF'
                    ];
                    handleStatClick(stat.playerId, stat.name, allStatTypes, '全プレイ', 'home');
                  }}
                  style={{ 
                    textAlign: 'center', 
                    fontWeight: 700, 
                    color: 'var(--accent-color)', 
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                  title="クリックしてこの選手の全プレイ動画を表示"
                >
                  {stat.number}
                </td>
                <td 
                  onClick={() => setSelectedChartPlayerId(stat.playerId)}
                  style={{ 
                    fontWeight: 600, 
                    textAlign: 'left', 
                    cursor: 'pointer', 
                    color: selectedChartPlayerId === stat.playerId ? 'var(--accent-color)' : '#fff',
                    textDecoration: selectedChartPlayerId === stat.playerId ? 'underline' : 'none'
                  }}
                  title="クリックしてこの選手のショットチャートを表示"
                >
                  {stat.name}
                </td>
                
                {/* MIN */}
                <td style={{ textAlign: 'center', color: '#ccc', fontWeight: 500 }}>{formatTime(stat.playingTime)}</td>
                
                {/* PTS */}
                {renderClickableCell(stat.pts, stat.playerId, stat.name, ['2P_MADE', '3P_MADE', 'FT_MADE'], '得点', 'home')}
                
                {/* eFG% */}
                <td style={{ textAlign: 'center', color: '#ccc' }}>
                  {stat.fga > 0 ? `${stat.efgPercent.toFixed(1)}%` : '-'}
                </td>
                
                {/* TS% */}
                <td style={{ textAlign: 'center', color: '#ccc' }}>
                  {stat.fga + stat.fta > 0 ? `${stat.tsPercent.toFixed(1)}%` : '-'}
                </td>
                
                {/* +/- */}
                <td style={{ 
                  textAlign: 'center', 
                  fontWeight: 700, 
                  color: stat.plusMinus > 0 ? 'var(--color-success)' : stat.plusMinus < 0 ? 'var(--color-danger)' : '#ccc' 
                }}>
                  {stat.plusMinus > 0 ? `+${stat.plusMinus}` : stat.plusMinus}
                </td>

                {/* AST */}
                {renderClickableCell(stat.ast, stat.playerId, stat.name, ['AST'], 'アシスト', 'home')}
                {/* REB */}
                {renderClickableCell(stat.reb, stat.playerId, stat.name, ['OREB', 'DREB'], 'リバウンド', 'home')}
                {/* OREB */}
                {renderClickableCell(stat.oreb, stat.playerId, stat.name, ['OREB'], 'オフェンスリバウンド', 'home')}
                {/* DREB */}
                {renderClickableCell(stat.dreb, stat.playerId, stat.name, ['DREB'], 'ディフェンスリバウンド', 'home')}
                {/* STL */}
                {renderClickableCell(stat.stl, stat.playerId, stat.name, ['STL'], 'スティール', 'home')}
                {/* BLK */}
                {renderClickableCell(stat.blk, stat.playerId, stat.name, ['BLK'], 'ブロック', 'home')}
                {/* TO */}
                {renderClickableCell(stat.to, stat.playerId, stat.name, ['TO'], 'ターンオーバー', 'home')}
                {/* PF */}
                {renderClickableCell(stat.pf, stat.playerId, stat.name, ['PF'], 'ファウル', 'home')}

                {/* FG */}
                {renderClickableCell(
                  stat.fga,
                  stat.playerId,
                  stat.name,
                  ['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'],
                  'FGシュート',
                  'home',
                  `${stat.fgm}-${stat.fga}`
                )}
                <td style={{ textAlign: 'center', color: '#ccc' }}>{stat.fgPercent}%</td>

                {/* 3P */}
                {renderClickableCell(
                  stat.tpa,
                  stat.playerId,
                  stat.name,
                  ['3P_MADE', '3P_MISS'],
                  '3Pシュート',
                  'home',
                  `${stat.tpm}-${stat.tpa}`
                )}
                <td style={{ textAlign: 'center', color: '#ccc' }}>{stat.tpPercent}%</td>

                {/* FT */}
                {renderClickableCell(
                  stat.fta,
                  stat.playerId,
                  stat.name,
                  ['FT_MADE', 'FT_MISS'],
                  'フリースロー',
                  'home',
                  `${stat.ftm}-${stat.fta}`
                )}
                <td style={{ textAlign: 'center', color: '#ccc' }}>{stat.ftPercent}%</td>
              </tr>
            ))}

            {/* 自チーム合計 */}
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderTop: '2px solid var(--glass-border)', fontWeight: 'bold' }}>
              <td style={{ textAlign: 'center' }}>-</td>
              <td style={{ textAlign: 'left' }}>自チーム合計</td>
              <td style={{ textAlign: 'center' }}>-</td>
              {renderClickableCell(homeTeamStats.pts, null, 'チーム全体', ['2P_MADE', '3P_MADE', 'FT_MADE'], '得点', 'home')}
              
              {/* eFG% */}
              <td style={{ textAlign: 'center', color: '#fff' }}>
                {homeTeamStats.fga > 0 ? `${homeTeamStats.efgPercent.toFixed(1)}%` : '-'}
              </td>
              
              {/* TS% */}
              <td style={{ textAlign: 'center', color: '#fff' }}>
                {homeTeamStats.fga + homeTeamStats.fta > 0 ? `${homeTeamStats.tsPercent.toFixed(1)}%` : '-'}
              </td>
              
              {/* +/- */}
              {(() => {
                const totalPM = homeTeamStats.pts - awayTeamStats.pts;
                return (
                  <td style={{ 
                    textAlign: 'center', 
                    color: totalPM > 0 ? 'var(--color-success)' : totalPM < 0 ? 'var(--color-danger)' : '#fff' 
                  }}>
                    {totalPM > 0 ? `+${totalPM}` : totalPM}
                  </td>
                );
              })()}

              {renderClickableCell(homeTeamStats.ast, null, 'チーム全体', ['AST'], 'アシスト', 'home')}
              {renderClickableCell(homeTeamStats.reb, null, 'チーム全体', ['OREB', 'DREB'], 'リバウンド', 'home')}
              {renderClickableCell(homeTeamStats.oreb, null, 'チーム全体', ['OREB'], 'オフェンスリバウンド', 'home')}
              {renderClickableCell(homeTeamStats.dreb, null, 'チーム全体', ['DREB'], 'ディフェンスリバウンド', 'home')}
              {renderClickableCell(homeTeamStats.stl, null, 'チーム全体', ['STL'], 'スティール', 'home')}
              {renderClickableCell(homeTeamStats.blk, null, 'チーム全体', ['BLK'], 'ブロック', 'home')}
              {renderClickableCell(homeTeamStats.to, null, 'チーム全体', ['TO'], 'ターンオーバー', 'home')}
              {renderClickableCell(homeTeamStats.pf, null, 'チーム全体', ['PF'], 'ファウル', 'home')}
              <td style={{ textAlign: 'center' }}>{homeTeamStats.fgm}-{homeTeamStats.fga}</td>
              <td style={{ textAlign: 'center' }}>{homeTeamStats.fgPercent}%</td>
              <td style={{ textAlign: 'center' }}>{homeTeamStats.tpm}-{homeTeamStats.tpa}</td>
              <td style={{ textAlign: 'center' }}>{homeTeamStats.tpPercent}%</td>
              <td style={{ textAlign: 'center' }}>{homeTeamStats.ftm}-{homeTeamStats.fta}</td>
              <td style={{ textAlign: 'center' }}>{homeTeamStats.ftPercent}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* --- 相手チーム ボックススコア (スカウティングモード時のみ個人成績を表示、オフ時はチーム合計のみ) --- */}
      {scoutingMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }} className="no-print">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={20} style={{ color: 'var(--color-danger)' }} />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>ボックススコア（相手チーム個人成績 / スカウティング）</h2>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>※ 赤色の数字をクリックすると動画クリップが再生できます</span>
          </div>

          <table className="stats-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th style={{ textAlign: 'left', width: '120px' }}>選手</th>
                <th>PTS</th>
                <th>eFG%</th>
                <th>TS%</th>
                <th>+/-</th>
                <th>AST</th>
                <th>REB</th>
                <th>OREB</th>
                <th>DREB</th>
                <th>STL</th>
                <th>BLK</th>
                <th>TO</th>
                <th>PF</th>
                <th>FG (成功-試投)</th>
                <th>FG%</th>
                <th>3P (成功-試投)</th>
                <th>3P%</th>
                <th>FT (成功-試投)</th>
                <th>FT%</th>
              </tr>
            </thead>
            <tbody>
              {awayPlayerStats.map(stat => (
                <tr key={stat.playerId}>
                  <td 
                    onClick={() => {
                      const allStatTypes: StatType[] = [
                        '3P_MADE', '3P_MISS', '2P_MADE', '2P_MISS', 
                        'FT_MADE', 'FT_MISS', 'AST', 'OREB', 'DREB', 
                        'STL', 'BLK', 'TO', 'PF'
                      ];
                      handleStatClick(stat.playerId, stat.name, allStatTypes, '全プレイ', 'away');
                    }}
                    style={{ 
                      textAlign: 'center', 
                      fontWeight: 700, 
                      color: 'var(--color-danger)', 
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                    title="クリックしてこの選手の全プレイ動画を表示"
                  >
                    {stat.number}
                  </td>
                  <td 
                    onClick={() => setSelectedChartPlayerId(stat.playerId)}
                    style={{ 
                      fontWeight: 600, 
                      textAlign: 'left', 
                      cursor: 'pointer', 
                      color: selectedChartPlayerId === stat.playerId ? 'var(--color-danger)' : '#fff',
                      textDecoration: selectedChartPlayerId === stat.playerId ? 'underline' : 'none'
                    }}
                    title="クリックしてこの選手のショットチャートを表示"
                  >
                    {stat.name}
                  </td>
                  
                  {/* PTS */}
                  {renderClickableCell(stat.pts, stat.playerId, stat.name, ['2P_MADE', '3P_MADE', 'FT_MADE'], '得点', 'away')}
                  
                  {/* eFG% */}
                  <td style={{ textAlign: 'center', color: '#ccc' }}>
                    {stat.fga > 0 ? `${stat.efgPercent.toFixed(1)}%` : '-'}
                  </td>
                  
                  {/* TS% */}
                  <td style={{ textAlign: 'center', color: '#ccc' }}>
                    {stat.fga + stat.fta > 0 ? `${stat.tsPercent.toFixed(1)}%` : '-'}
                  </td>
                  
                  {/* +/- */}
                  <td style={{ textAlign: 'center', color: '#666' }}>-</td>

                  {/* AST */}
                  {renderClickableCell(stat.ast, stat.playerId, stat.name, ['AST'], 'アシスト', 'away')}
                  {/* REB */}
                  {renderClickableCell(stat.reb, stat.playerId, stat.name, ['OREB', 'DREB'], 'リバウンド', 'away')}
                  {/* OREB */}
                  {renderClickableCell(stat.oreb, stat.playerId, stat.name, ['OREB'], 'オフェンスリバウンド', 'away')}
                  {/* DREB */}
                  {renderClickableCell(stat.dreb, stat.playerId, stat.name, ['DREB'], 'ディフェンスリバウンド', 'away')}
                  {/* STL */}
                  {renderClickableCell(stat.stl, stat.playerId, stat.name, ['STL'], 'スティール', 'away')}
                  {/* BLK */}
                  {renderClickableCell(stat.blk, stat.playerId, stat.name, ['BLK'], 'ブロック', 'away')}
                  {/* TO */}
                  {renderClickableCell(stat.to, stat.playerId, stat.name, ['TO'], 'ターンオーバー', 'away')}
                  {/* PF */}
                  {renderClickableCell(stat.pf, stat.playerId, stat.name, ['PF'], 'ファウル', 'away')}

                  {/* FG */}
                  {renderClickableCell(
                    stat.fga,
                    stat.playerId,
                    stat.name,
                    ['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'],
                    'FGシュート',
                    'away',
                    `${stat.fgm}-${stat.fga}`
                  )}
                  <td style={{ textAlign: 'center', color: '#ccc' }}>{stat.fgPercent}%</td>

                  {/* 3P */}
                  {renderClickableCell(
                    stat.tpa,
                    stat.playerId,
                    stat.name,
                    ['3P_MADE', '3P_MISS'],
                    '3Pシュート',
                    'away',
                    `${stat.tpm}-${stat.tpa}`
                  )}
                  <td style={{ textAlign: 'center', color: '#ccc' }}>{stat.tpPercent}%</td>

                  {/* FT */}
                  {renderClickableCell(
                    stat.fta,
                    stat.playerId,
                    stat.name,
                    ['FT_MADE', 'FT_MISS'],
                    'フリースロー',
                    'away',
                    `${stat.ftm}-${stat.fta}`
                  )}
                  <td style={{ textAlign: 'center', color: '#ccc' }}>{stat.ftPercent}%</td>
                </tr>
              ))}

              {/* 相手チーム合計 */}
              <tr style={{ background: 'rgba(239,68,68,0.02)', borderTop: '2px solid rgba(239,68,68,0.2)', fontWeight: 'bold' }}>
                <td style={{ textAlign: 'center' }}>-</td>
                <td style={{ textAlign: 'left', color: 'var(--color-danger)' }}>相手チーム合計</td>
                {renderClickableCell(awayTeamStats.pts, null, '相手全体', ['2P_MADE', '3P_MADE', 'FT_MADE'], '得点', 'away')}
                
                {/* eFG% */}
                <td style={{ textAlign: 'center', color: '#fff' }}>
                  {awayTeamStats.fga > 0 ? `${awayTeamStats.efgPercent.toFixed(1)}%` : '-'}
                </td>
                
                {/* TS% */}
                <td style={{ textAlign: 'center', color: '#fff' }}>
                  {awayTeamStats.fga + awayTeamStats.fta > 0 ? `${awayTeamStats.tsPercent.toFixed(1)}%` : '-'}
                </td>
                
                {/* +/- */}
                {(() => {
                  const totalPM = awayTeamStats.pts - homeTeamStats.pts;
                  return (
                    <td style={{ 
                      textAlign: 'center', 
                      color: totalPM > 0 ? 'var(--color-success)' : totalPM < 0 ? 'var(--color-danger)' : '#fff' 
                    }}>
                      {totalPM > 0 ? `+${totalPM}` : totalPM}
                    </td>
                  );
                })()}

                {renderClickableCell(awayTeamStats.ast, null, '相手全体', ['AST'], 'アシスト', 'away')}
                {renderClickableCell(awayTeamStats.reb, null, '相手全体', ['OREB', 'DREB'], 'リバウンド', 'away')}
                {renderClickableCell(awayTeamStats.oreb, null, '相手全体', ['OREB'], 'オフェンスリバウンド', 'away')}
                {renderClickableCell(awayTeamStats.dreb, null, '相手全体', ['DREB'], 'ディフェンスリバウンド', 'away')}
                {renderClickableCell(awayTeamStats.stl, null, '相手全体', ['STL'], 'スティール', 'away')}
                {renderClickableCell(awayTeamStats.blk, null, '相手全体', ['BLK'], 'ブロック', 'away')}
                {renderClickableCell(awayTeamStats.to, null, '相手全体', ['TO'], 'ターンオーバー', 'away')}
                {renderClickableCell(awayTeamStats.pf, null, '相手全体', ['PF'], 'ファウル', 'away')}
                <td style={{ textAlign: 'center' }}>{awayTeamStats.fgm}-{awayTeamStats.fga}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.fgPercent}%</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.tpm}-{awayTeamStats.tpa}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.tpPercent}%</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.ftm}-{awayTeamStats.fta}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.ftPercent}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        /* 通常の相手チーム合計表示 (スカウティングオフ時) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} className="no-print">
          <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-danger)' }}>相手チーム合計成績</span>
          </div>
          <table className="stats-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>チーム</th>
                <th>PTS (得点)</th>
                <th>eFG%</th>
                <th>TS%</th>
                <th>+/-</th>
                <th>TO (ターンオーバー)</th>
                <th>PF (ファウル)</th>
                <th>FG (成功-試投)</th>
                <th>FG%</th>
                <th>3P (成功-試投)</th>
                <th>3P%</th>
                <th>FT (成功-試投)</th>
                <th>FT%</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'rgba(239,68,68,0.02)', fontWeight: 'bold' }}>
                <td style={{ textAlign: 'left', color: 'var(--color-danger)' }}>相手チーム合計</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.pts}</td>
                
                {/* eFG% */}
                <td style={{ textAlign: 'center', color: '#fff' }}>
                  {awayTeamStats.fga > 0 ? `${awayTeamStats.efgPercent.toFixed(1)}%` : '-'}
                </td>
                
                {/* TS% */}
                <td style={{ textAlign: 'center', color: '#fff' }}>
                  {awayTeamStats.fga + awayTeamStats.fta > 0 ? `${awayTeamStats.tsPercent.toFixed(1)}%` : '-'}
                </td>
                
                {/* +/- */}
                {(() => {
                  const totalPM = awayTeamStats.pts - homeTeamStats.pts;
                  return (
                    <td style={{ 
                      textAlign: 'center', 
                      color: totalPM > 0 ? 'var(--color-success)' : totalPM < 0 ? 'var(--color-danger)' : '#fff' 
                    }}>
                      {totalPM > 0 ? `+${totalPM}` : totalPM}
                    </td>
                  );
                })()}

                <td style={{ textAlign: 'center' }}>{awayTeamStats.to}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.pf}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.fgm}-{awayTeamStats.fga}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.fgPercent}%</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.tpm}-{awayTeamStats.tpa}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.tpPercent}%</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.ftm}-{awayTeamStats.fta}</td>
                <td style={{ textAlign: 'center' }}>{awayTeamStats.ftPercent}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      {/* --- ビジュアル・ショット分析セクション --- */}
      {activeTab === 'shot-chart' && (() => {
        // ショットイベントの取得 & フィルタリング
        const chartShots = events.filter(e => {
          if (!['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'].includes(e.type)) return false;
          if (selectedChartPlayerId === 'all-home') return e.team === 'home';
          if (selectedChartPlayerId === 'all-away') return e.team === 'away';
          return e.playerId === selectedChartPlayerId;
        });

        const chartFgm = chartShots.filter(e => e.type === '2P_MADE' || e.type === '3P_MADE').length;
        const chartFga = chartShots.length;
        const chartFgPercent = chartFga > 0 ? ((chartFgm / chartFga) * 100).toFixed(1) : '0.0';

        const chartTpm = chartShots.filter(e => e.type === '3P_MADE').length;
        const chartTpa = chartShots.filter(e => e.type === '3P_MADE' || e.type === '3P_MISS').length;
        const chartTpPercent = chartTpa > 0 ? ((chartTpm / chartTpa) * 100).toFixed(1) : '0.0';

        const chart2pm = chartShots.filter(e => e.type === '2P_MADE').length;
        const chart2pa = chartShots.filter(e => e.type === '2P_MADE' || e.type === '2P_MISS').length;
        const chart2pPercent = chart2pa > 0 ? ((chart2pm / chart2pa) * 100).toFixed(1) : '0.0';

        const selectedChartPlayer = players.find(p => p.id === selectedChartPlayerId);
        const selectedChartPlayerName = selectedChartPlayerId === 'all-home'
          ? '自チーム全体'
          : selectedChartPlayerId === 'all-away'
            ? '相手チーム全体'
            : selectedChartPlayer
              ? `#${selectedChartPlayer.number} ${selectedChartPlayer.name}`
              : '選択された選手';

        return (
          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }} className="no-print">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Target size={20} style={{ color: 'var(--accent-color)' }} />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>ビジュアル・ショット分析 (選手名選択で個別表示)</h2>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: '#888' }}>分析対象:</span>
                <select
                  value={selectedChartPlayerId}
                  onChange={(e) => setSelectedChartPlayerId(e.target.value)}
                  className="input-field"
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    background: 'rgba(0,0,0,0.3)',
                    borderColor: 'var(--glass-border)',
                    color: '#fff',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all-home">自チーム全体</option>
                  <option value="all-away">相手チーム全体</option>
                  <optgroup label="自チーム選手">
                    {players.filter(p => p.team === 'home').map(p => (
                      <option key={p.id} value={p.id}>#{p.number} {p.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="相手チーム選手">
                    {players.filter(p => p.team === 'away').map(p => (
                      <option key={p.id} value={p.id}>#{p.number} {p.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '24px',
              alignItems: 'start'
            }}>
              {/* 左カラム: ショットチャートSVG */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ 
                  position: 'relative', 
                  width: '100%', 
                  maxWidth: '320px', 
                  background: 'rgba(0,0,0,0.4)', 
                  borderRadius: 'var(--radius-md)', 
                  border: '1px solid var(--glass-border)',
                  overflow: 'hidden'
                }}>
                  <svg
                    viewBox="0 0 100 95"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  >
                    {/* コート背景 */}
                    <rect x="0" y="0" width="100" height="95" fill="rgba(0, 0, 0, 0.3)" />
                    
                    {/* 外枠 */}
                    <rect x="0" y="0" width="100" height="95" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                    
                    {/* ペイント（制限区域） */}
                    <rect x="33.6" y="0" width="32.8" height="41.4" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                    
                    {/* フリースローサークル（トップ） */}
                    <path d="M 33.6 41.4 A 16.4 16.4 0 0 0 66.4 41.4" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                    <path d="M 66.4 41.4 A 16.4 16.4 0 0 0 33.6 41.4" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2,2" />
                    
                    {/* 3ポイントライン */}
                    <path d="M 6 0 L 6 21.3 A 44 48.2 0 0 0 94 21.3 L 94 0" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                    
                    {/* センターサークル */}
                    <path d="M 38 95 A 12 12 0 0 1 62 95" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                    
                    {/* バックボード & リング */}
                    <line x1="44" y1="8.6" x2="56" y2="8.6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                    <line x1="50" y1="8.6" x2="50" y2="10" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                    <circle cx="50" cy="11.25" r="2.25" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />

                    {/* ノーチャージセミサークル */}
                    <path d="M 41.7 11.25 A 8.3 8.3 0 0 0 58.3 11.25" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />

                    {/* プロットされたシュート位置 */}
                    {chartShots.filter(e => e.location).map(e => {
                      const isMade = e.type === '2P_MADE' || e.type === '3P_MADE';
                      const p = players.find(player => player.id === e.playerId);
                      const pName = p ? p.name : (e.team === 'home' ? '自チーム' : '相手チーム');
                      const desc = `${e.quarter} ${formatTime(e.timestamp)} - #${p?.number || ''} ${pName} (${isMade ? '成功' : '失敗'})`;

                      if (isMade) {
                        return (
                          <circle
                            key={e.id}
                            cx={e.location!.x}
                            cy={e.location!.y}
                            r="3"
                            fill="var(--color-success)"
                            stroke="#fff"
                            strokeWidth="0.5"
                            onClick={() => onJumpToTime(e.timestamp)}
                            style={{ cursor: 'pointer', transition: 'transform 0.1s' }}
                          >
                            <title>{desc} &#10;クリックしてこの動画シーンを再生</title>
                          </circle>
                        );
                      } else {
                        const size = 2.5;
                        return (
                          <g
                            key={e.id}
                            onClick={() => onJumpToTime(e.timestamp)}
                            style={{ cursor: 'pointer' }}
                          >
                            <title>{desc} &#10;クリックしてこの動画シーンを再生</title>
                            <line x1={e.location!.x - size} y1={e.location!.y - size} x2={e.location!.x + size} y2={e.location!.y + size} stroke="var(--color-danger)" strokeWidth="1.5" />
                            <line x1={e.location!.x + size} y1={e.location!.y - size} x2={e.location!.x - size} y2={e.location!.y + size} stroke="var(--color-danger)" strokeWidth="1.5" />
                          </g>
                        );
                      }
                    })}
                  </svg>
                </div>
                
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem', color: '#aaa', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-success)' }}></span>
                    成功 (IN)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ color: 'var(--color-danger)', fontWeight: 'bold' }}>✖</span>
                    失敗 (OUT)
                  </div>
                  <span style={{ color: '#666' }}>※プロットをクリックで動画ジャンプ</span>
                </div>
              </div>

              {/* 右カラム: スタッツ要約 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', padding: '14px', borderRadius: 'var(--radius-sm)' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--accent-color)', fontWeight: 700, marginBottom: '10px' }}>
                    {selectedChartPlayerName} ショット成功率
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* FG% */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 600 }}>フィールドゴール (FG)</span>
                        <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>{chartFgm}/{chartFga} ({chartFgPercent}%)</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${chartFgPercent}%`, height: '100%', background: 'var(--color-success)', borderRadius: '3px', transition: 'width 0.3s ease-out' }}></div>
                      </div>
                    </div>

                    {/* 2P% */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 600 }}>2点シュート (2P)</span>
                        <span style={{ fontWeight: 700, color: '#ccc' }}>{chart2pm}/{chart2pa} ({chart2pPercent}%)</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${chart2pPercent}%`, height: '100%', background: '#bbb', borderRadius: '3px', transition: 'width 0.3s ease-out' }}></div>
                      </div>
                    </div>

                    {/* 3P% */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 600 }}>3点シュート (3P)</span>
                        <span style={{ fontWeight: 700, color: 'var(--accent-color)' }}>{chartTpm}/{chartTpa} ({chartTpPercent}%)</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${chartTpPercent}%`, height: '100%', background: 'var(--accent-color)', borderRadius: '3px', transition: 'width 0.3s ease-out' }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ショット履歴リスト */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 600 }}>シュート履歴 (時間順)：</span>
                  {chartShots.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: '#666', textAlign: 'center', padding: '15px 0' }}>シュート記録がありません。</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
                      {chartShots.sort((a,b) => a.timestamp - b.timestamp).map((e) => {
                        const isMade = e.type === '2P_MADE' || e.type === '3P_MADE';
                        const p = players.find(player => player.id === e.playerId);
                        const pName = p ? p.name.split(' ')[0] : (e.team === 'home' ? '自チーム' : '相手チーム');
                        const hasLoc = !!e.location;
                        return (
                          <button
                            key={e.id}
                            onClick={() => onJumpToTime(e.timestamp)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              background: 'rgba(255,255,255,0.01)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              color: '#fff',
                              fontSize: '0.75rem',
                              textAlign: 'left',
                              transition: 'all 0.15s'
                            }}
                            className="clip-item"
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ 
                                display: 'inline-block', 
                                width: '6px', 
                                height: '6px', 
                                borderRadius: '50%', 
                                background: isMade ? 'var(--color-success)' : 'var(--color-danger)' 
                              }}></span>
                              <span style={{ fontWeight: 600 }}>{e.quarter} {formatTime(e.timestamp)}</span>
                              <span style={{ color: '#ccc' }}>#{p?.number || ''} {pName}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ 
                                color: isMade ? 'var(--color-success)' : 'var(--color-danger)', 
                                fontWeight: 'bold' 
                              }}>
                                {e.type.split('_')[0]} {isMade ? '成功' : '失敗'}
                              </span>
                              {!hasLoc && <span style={{ fontSize: '0.65rem', color: '#555' }}>(位置なし)</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* --- ラインナップ分析タブの描画 --- */}
      {activeTab === 'lineups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', textAlign: 'left' }} className="no-print">
          
          {/* 5人ラインナップ別リスト */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={20} style={{ color: 'var(--accent-color)' }} />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>5人ラインナップ別 貢献度統計</h2>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#888' }}>
                ※ 出場時間をクリックすると、そのメンバーの出場開始シーンにジャンプします
              </span>
            </div>

            {lineups.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#666', padding: '40px 0', fontSize: '0.9rem' }}>
                ラインナップの出場データがありません。選手交代（SUB）を記録してください。
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="stats-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', width: '260px' }}>オンコートメンバー (5人)</th>
                      <th 
                        onClick={() => {
                          setLineupSortField('duration');
                          setLineupSortAsc(prev => lineupSortField === 'duration' ? !prev : false);
                        }}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        MIN (出場時間) {lineupSortField === 'duration' ? (lineupSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th>PTS (得点)</th>
                      <th>OPP PTS (失点)</th>
                      <th 
                        onClick={() => {
                          setLineupSortField('plusMinus');
                          setLineupSortAsc(prev => lineupSortField === 'plusMinus' ? !prev : false);
                        }}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        得失点差 (+/-) {lineupSortField === 'plusMinus' ? (lineupSortAsc ? '▲' : '▼') : ''}
                      </th>
                      <th 
                        onClick={() => {
                          setLineupSortField('ppm');
                          setLineupSortAsc(prev => lineupSortField === 'ppm' ? !prev : false);
                        }}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        PPM (得失点率 / 分) {lineupSortField === 'ppm' ? (lineupSortAsc ? '▲' : '▼') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineups
                      .sort((a, b) => {
                        let valA = a[lineupSortField];
                        let valB = b[lineupSortField];
                        return lineupSortAsc ? (valA - valB) : (valB - valA);
                      })
                      .map((lineup, index) => {
                        const lineupPlayers = lineup.playerIds.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
                        
                        // 得失点差によって色を変える
                        let pmColor = '#fff';
                        let pmBg = 'transparent';
                        if (lineup.plusMinus > 0) {
                          pmColor = '#4ade80'; // 薄い緑
                          pmBg = 'rgba(74, 222, 128, 0.05)';
                        } else if (lineup.plusMinus < 0) {
                          pmColor = '#f87171'; // 薄い赤
                          pmBg = 'rgba(248, 113, 113, 0.05)';
                        }

                        // 出場セグメントの最初の開始時間にシーク
                        const firstSegment = lineup.segments[0];

                        return (
                          <tr key={index} style={{ background: pmBg }}>
                            {/* メンバー表示 */}
                            <td style={{ textAlign: 'left', padding: '10px 8px' }}>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                                {lineupPlayers.map(p => (
                                  <span
                                    key={p.id}
                                    style={{
                                      background: 'rgba(255, 107, 0, 0.1)',
                                      border: '1px solid var(--accent-color)',
                                      borderRadius: '4px',
                                      padding: '2px 6px',
                                      fontSize: '0.75rem',
                                      color: '#fff',
                                      fontWeight: 600,
                                      display: 'inline-block'
                                    }}
                                    title={p.name}
                                  >
                                    #{p.number} {p.name.split(' ')[0]}
                                  </span>
                                ))}
                                {lineupPlayers.length !== 5 && (
                                  <span style={{ color: 'var(--color-warning)', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                    ⚠️ {lineupPlayers.length}人構成
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 出場時間（動画ジャンプ付き） */}
                            <td
                              style={{ textAlign: 'center', fontWeight: 600, cursor: 'pointer', color: 'var(--accent-color)' }}
                              onClick={() => firstSegment && onJumpToTime(firstSegment.start)}
                              title="クリックしてこのラインナップの出場シーンへ動画ジャンプ"
                              className="hover-cell"
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <Play size={10} fill="var(--accent-color)" /> {formatTime(lineup.duration)}
                              </div>
                            </td>

                            {/* PTS */}
                            <td style={{ textAlign: 'center', color: '#ccc' }}>{lineup.ptsFor}</td>

                            {/* OPP PTS */}
                            <td style={{ textAlign: 'center', color: '#ccc' }}>{lineup.ptsAgainst}</td>

                            {/* +/- */}
                            <td style={{ textAlign: 'center', fontWeight: 700, color: pmColor }}>
                              {lineup.plusMinus > 0 ? `+${lineup.plusMinus}` : lineup.plusMinus}
                            </td>

                            {/* PPM */}
                            <td style={{ textAlign: 'center', fontWeight: 600, color: pmColor }}>
                              {lineup.plusMinus > 0 ? `+${lineup.ppm.toFixed(2)}` : lineup.ppm.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 相棒デュオケミストリー分析 */}
          <div style={{
            borderTop: '1px solid var(--glass-border)',
            paddingTop: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={20} style={{ color: 'var(--accent-color)' }} />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>相棒（Duo）ケミストリー相性分析</h2>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: '#888' }}>分析対象選手:</span>
                <select
                  value={selectedDuoPlayerId}
                  onChange={(e) => setSelectedDuoPlayerId(e.target.value)}
                  className="input-field"
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    background: 'rgba(0,0,0,0.3)',
                    borderColor: 'var(--glass-border)',
                    color: '#fff',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer'
                  }}
                >
                  {homePlayersOnly.map(p => (
                    <option key={p.id} value={p.id}>#{p.number} {p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {duoChemistryList.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#666', padding: '20px 0', fontSize: '0.9rem' }}>
                同時出場の相性データがありません。スタッツを記録するか、選手を追加してください。
              </p>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px'
              }}>
                {duoChemistryList
                  .filter(duo => duo.duration > 0)
                  .sort((a, b) => b.ppm - a.ppm)
                  .map((duo, index) => {
                    const isPositive = duo.plusMinus > 0;
                    const pmText = isPositive ? `+${duo.plusMinus}` : `${duo.plusMinus}`;
                    const ppmText = isPositive ? `+${duo.ppm.toFixed(2)}` : `${duo.ppm.toFixed(2)}`;
                    
                    const maxPpm = Math.max(...duoChemistryList.map(d => Math.abs(d.ppm)));
                    const relativeBarWidth = maxPpm > 0 ? (Math.min(100, (Math.abs(duo.ppm) / maxPpm) * 100)) : 0;
                    
                    let chemistryColor = 'rgba(255,255,255,0.05)';
                    let barBg = '#888';
                    let statusLabel = 'ニュートラル';

                    if (duo.ppm > 0.5) {
                      chemistryColor = 'rgba(74, 222, 128, 0.03)';
                      barBg = 'linear-gradient(90deg, var(--color-success), #4ade80)';
                      statusLabel = '相性抜群 (ケミストリー高)';
                    } else if (duo.ppm < -0.5) {
                      chemistryColor = 'rgba(239, 68, 68, 0.03)';
                      barBg = 'linear-gradient(90deg, var(--color-danger), #f87171)';
                      statusLabel = '相性注意 (ケミストリー低)';
                    }

                    return (
                      <div
                        key={duo.partnerId}
                        style={{
                          background: chemistryColor,
                          border: '1px solid var(--glass-border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <div style={{
                          position: 'absolute',
                          top: '10px',
                          right: '12px',
                          fontSize: '1.2rem',
                          fontWeight: 800,
                          color: duo.ppm > 0.5 ? 'rgba(74,222,128,0.2)' : (duo.ppm < -0.5 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)')
                        }}>
                          #{index + 1}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            background: 'var(--accent-color)',
                            color: '#fff',
                            fontWeight: 'bold',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '0.75rem'
                          }}>
                            #{duo.partnerNumber}
                          </span>
                          <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{duo.partnerName}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#aaa' }}>
                          <span>同時出場: <strong>{formatTime(duo.duration)}</strong></span>
                          <span>差: <strong style={{ color: duo.plusMinus > 0 ? '#4ade80' : (duo.plusMinus < 0 ? '#f87171' : '#ccc') }}>{pmText} ({ppmText}/分)</strong></span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                          <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${relativeBarWidth}%`,
                              height: '100%',
                              background: barBg,
                              borderRadius: '4px',
                              marginLeft: duo.ppm < 0 ? 'auto' : '0',
                              transition: 'width 0.3s ease-out'
                            }}></div>
                          </div>
                          <span style={{
                            fontSize: '0.65rem',
                            color: duo.ppm > 0.5 ? '#4ade80' : (duo.ppm < -0.5 ? '#f87171' : '#888'),
                            fontWeight: 600
                          }}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* --- AIコーチアシスタント（NotebookLM風）タブの描画 --- */}
      {activeTab === 'ai-coach' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }} className="no-print animate-slide-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={20} style={{ color: 'var(--accent-color)' }} />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Game Analytics AI Assistant (AIコーチ)</h2>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>
              ※ 試合データとイベント履歴を基にした高度な戦術コーチングを提供します
            </span>
          </div>

          {/* AI Settings Header bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '4px',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bot size={20} style={{ color: 'var(--accent-color)' }} />
              <div>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', margin: 0 }}>AIコーチ設定</h3>
                <p style={{ fontSize: '0.7rem', color: '#888', margin: 0 }}>
                  {isDemoMode ? 'デモモード動作中 (ローカルダミー応答)' : 'Gemini API接続モード (実データ解析)'}
                </p>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Mode Toggle Button */}
              <button
                onClick={() => {
                  const nextMode = !isDemoMode;
                  setIsDemoMode(nextMode);
                  localStorage.setItem('courtvision_ai_demo_mode', nextMode ? 'true' : 'false');
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  fontSize: '0.75rem',
                  background: isDemoMode ? 'rgba(255, 107, 0, 0.1)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isDemoMode ? 'var(--accent-color)' : 'var(--glass-border)'}`,
                  borderRadius: '6px',
                  color: isDemoMode ? 'var(--accent-color)' : '#aaa',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.2s'
                }}
              >
                <Sparkles size={12} /> {isDemoMode ? 'デモモード: ON' : 'デモモード: OFF'}
              </button>

              {/* Model Selector Dropdown */}
              <select
                value={modelName}
                onChange={(e) => {
                  const val = e.target.value;
                  setModelName(val);
                  localStorage.setItem('courtvision_gemini_model_name', val);
                }}
                style={{
                  padding: '6px 8px',
                  fontSize: '0.75rem',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '6px',
                  color: '#fff',
                  outline: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'border-color 0.2s'
                }}
                title="APIで使用するGeminiモデルを選択します"
              >
                <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              </select>

              {/* API Key input and save */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Key size={12} style={{ position: 'absolute', left: '8px', color: '#888' }} />
                  <input
                    type="password"
                    placeholder="Gemini API Key"
                    value={apiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setApiKey(val);
                      localStorage.setItem('courtvision_gemini_api_key', val);
                    }}
                    style={{
                      padding: '6px 8px 6px 26px',
                      fontSize: '0.75rem',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '6px',
                      color: '#fff',
                      width: '180px',
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                  />
                </div>
                {apiKey && (
                  <button
                    onClick={() => {
                      setApiKey('');
                      localStorage.removeItem('courtvision_gemini_api_key');
                    }}
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.75rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    消去
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Chat Interface Container */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '550px',
            background: 'rgba(18, 20, 28, 0.4)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden'
          }}>
            {/* Messages Area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              {chatMessages.map((msg, index) => {
                const isAI = msg.sender === 'ai';
                return (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      flexDirection: isAI ? 'row' : 'row-reverse',
                      alignItems: 'flex-start',
                      maxWidth: '85%',
                      alignSelf: isAI ? 'flex-start' : 'flex-end'
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: isAI ? 'rgba(255, 107, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)',
                      border: `1px solid ${isAI ? 'var(--accent-color)' : 'rgba(255,255,255,0.2)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isAI ? 'var(--accent-color)' : '#fff',
                      flexShrink: 0
                    }}>
                      {isAI ? <Bot size={16} /> : <Users size={16} />}
                    </div>

                    {/* Speech Bubble */}
                    <div style={{
                      background: isAI ? 'rgba(255, 255, 255, 0.03)' : 'var(--accent-color)',
                      border: `1px solid ${isAI ? 'var(--glass-border)' : 'transparent'}`,
                      borderRadius: isAI ? '0 12px 12px 12px' : '12px 0 12px 12px',
                      padding: '12px 16px',
                      color: '#fff',
                      fontSize: '0.9rem',
                      lineHeight: 1.6,
                      textAlign: 'left',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {renderChatMessageText(msg.text)}
                      
                      <div style={{
                        fontSize: '0.65rem',
                        color: isAI ? '#666' : 'rgba(255,255,255,0.7)',
                        marginTop: '6px',
                        textAlign: isAI ? 'left' : 'right'
                      }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {isChatLoading && (
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  alignSelf: 'flex-start'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'rgba(255, 107, 0, 0.1)',
                    border: '1px solid var(--accent-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-color)'
                  }}>
                    <Bot size={16} />
                  </div>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '0 12px 12px 12px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '0.85rem', color: '#aaa' }}>AIコーチが思考中</span>
                    <span className="dot-flashing" style={{ display: 'inline-flex', gap: '3px' }}>
                      <span style={{ width: '4px', height: '4px', background: '#aaa', borderRadius: '50%' }}></span>
                      <span style={{ width: '4px', height: '4px', background: '#aaa', borderRadius: '50%' }}></span>
                      <span style={{ width: '4px', height: '4px', background: '#aaa', borderRadius: '50%' }}></span>
                    </span>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            {/* Quick Suggestion Chips */}
            <div style={{
              padding: '8px 16px',
              background: 'rgba(0, 0, 0, 0.15)',
              borderTop: '1px solid var(--glass-border)',
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'none'
            }} className="no-scrollbar">
              {[
                { text: '試合の戦術サマリー', icon: <FileText size={12} /> },
                { text: 'ターンオーバーのシーン一覧', icon: <X size={12} /> },
                { text: 'ラインナップの相性評価', icon: <Users size={12} /> },
                { text: '得点効率の高い選手分析', icon: <Activity size={12} /> }
              ].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendChatMessage(q.text)}
                  disabled={isChatLoading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '16px',
                    color: '#fff',
                    cursor: isChatLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0
                  }}
                  className="quick-question-btn"
                >
                  {q.icon}
                  {q.text}
                </button>
              ))}
            </div>

            {/* Text Input area */}
            <div style={{
              padding: '12px 16px',
              background: 'rgba(0, 0, 0, 0.25)',
              borderTop: '1px solid var(--glass-border)',
              display: 'flex',
              gap: '10px'
            }}>
              <input
                type="text"
                placeholder="AIコーチに質問する... (例: 相手チームの対策は？)"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChatMessage();
                  }
                }}
                disabled={isChatLoading}
                style={{
                  flex: 1,
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
              <button
                onClick={() => handleSendChatMessage()}
                disabled={isChatLoading || !chatInput.trim()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: chatInput.trim() && !isChatLoading ? 'var(--accent-color)' : 'rgba(255,255,255,0.05)',
                  color: chatInput.trim() && !isChatLoading ? '#fff' : '#666',
                  border: 'none',
                  cursor: chatInput.trim() && !isChatLoading ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s'
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* クリック時のリプレイポップアップ */}
      {selectedClips && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '340px',
          background: 'rgba(18, 20, 28, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--accent-color)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }} className="animate-slide-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>プレイ動画リプレイ</p>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
                {selectedClips.playerName} <span style={{ color: 'var(--accent-color)' }}>{selectedClips.statLabel}</span>
              </h3>
            </div>
            <button
              onClick={() => setSelectedClips(null)}
              style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', paddingRight: '2px' }}>
            {selectedClips.filteredEvents.map((e, idx) => {
              const isCurrentPlaying = isPlaylistPlaying && playlist.length > 0 && playlist[0].id === selectedClips.filteredEvents[0].id && idx === currentPlayIndex;
              return (
                <button
                  key={e.id}
                  onClick={() => onJumpToTime(e.timestamp)}
                  className={`clip-item ${isCurrentPlaying ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: isCurrentPlaying ? 'rgba(255, 107, 0, 0.15)' : 'rgba(255,255,255,0.02)',
                    border: isCurrentPlaying ? '1px solid var(--accent-color)' : '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: '#fff',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    transition: 'all 0.15s',
                    boxShadow: isCurrentPlaying ? '0 0 10px rgba(255, 107, 0, 0.2)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: isCurrentPlaying ? 'var(--accent-color)' : 'rgba(255, 107, 0, 0.1)',
                      color: isCurrentPlaying ? '#fff' : 'var(--accent-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.7rem',
                      fontWeight: 700
                    }}>
                      {idx + 1}
                    </span>
                    <span style={{ fontWeight: 600, color: isCurrentPlaying ? '#fff' : 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Play size={10} fill={isCurrentPlaying ? '#fff' : 'var(--accent-color)'} /> 
                      {formatTime(e.timestamp)}
                      <span style={{
                        fontSize: '0.65rem',
                        background: e.type.includes('MADE') ? 'rgba(16, 185, 129, 0.15)' : e.type.includes('MISS') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                        color: e.type.includes('MADE') ? 'var(--color-success)' : e.type.includes('MISS') ? 'var(--color-danger)' : '#ccc',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        fontWeight: 700,
                        marginLeft: '2px',
                        border: '1px solid',
                        borderColor: e.type.includes('MADE') ? 'rgba(16, 185, 129, 0.3)' : e.type.includes('MISS') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.15)'
                      }}>
                        {getCompactEventLabel(e.type)}
                      </span>
                    </span>
                  </div>
                  
                  <span style={{ fontSize: '0.75rem', color: isCurrentPlaying ? '#eee' : '#888', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isCurrentPlaying ? '🎥 再生中...' : (e.notes ? `"${e.notes}"` : 'メモなし')}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 連続再生コントロール */}
          <div style={{ marginTop: '4px', borderTop: '1px solid var(--glass-border)', paddingTop: '10px' }}>
            {isPlaylistPlaying && playlist.length > 0 && selectedClips.filteredEvents.length > 0 && playlist[0].id === selectedClips.filteredEvents[0].id ? (
              <button
                onClick={onStopPlaylist}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  borderRadius: 'var(--radius-sm)',
                  color: '#ef4444',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                <span className="playlist-pulse-dot" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
                連続再生を停止
              </button>
            ) : (
              <button
                onClick={() => onStartPlaylist(selectedClips.filteredEvents)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--accent-color)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                <Play size={12} fill="#fff" />
                このリストを連続再生 ({selectedClips.filteredEvents.length}件)
              </button>
            )}
          </div>
        </div>
      )}
    </div>

    {/* ======================================================== */}
    {/* 印刷・PDF用レポートレイアウト (Print & PDF Layout) */}
    {/* ======================================================== */}
    <div className="print-report-container" style={{ display: 'none' }}>
      {/* レポートヘッダー */}
      <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '2px solid #000', paddingBottom: '15px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 5px 0', color: '#000', fontFamily: 'Outfit, sans-serif' }}>CourtVision Basketball Stats Report</h1>
        <p style={{ fontSize: '14px', color: '#555', margin: '0' }}>試合スタッツ分析・ビジュアルレポート</p>
      </div>

      {/* 試合基本情報 */}
      <div style={{ marginBottom: '25px', background: '#f8f9fa', padding: '15px', borderRadius: '6px', border: '1px solid #ddd' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#000' }}>
          <tbody>
            <tr>
              <td style={{ padding: '6px 0', fontWeight: 'bold', width: '120px' }}>対戦カード:</td>
              <td style={{ padding: '6px 0', fontSize: '16px', fontWeight: 600 }}>
                自チーム vs {players.some(p => p.team === 'away') ? '相手チーム' : '対戦相手'}
              </td>
              <td style={{ padding: '6px 0', fontWeight: 'bold', width: '100px' }}>出力日時:</td>
              <td style={{ padding: '6px 0' }}>{new Date().toLocaleDateString('ja-JP')}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0', fontWeight: 'bold' }}>最終スコア:</td>
              <td style={{ padding: '6px 0', fontSize: '20px', fontWeight: 'bold', color: '#ff6b00' }}>
                自チーム {homeTeamStats.pts} - {awayTeamStats.pts} 相手チーム
              </td>
              <td style={{ padding: '6px 0', fontWeight: 'bold' }}>総プレイ数:</td>
              <td style={{ padding: '6px 0' }}>{events.length} アクション記録</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 1. 自チーム ボックススコア */}
      <div style={{ marginBottom: '35px', pageBreakInside: 'avoid' }}>
        <h2 style={{ fontSize: '18px', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '12px', color: '#000', fontWeight: 700 }}>
          1. 自チーム ボックススコア (Home Box Score)
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#000' }} className="print-table">
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>#</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'left' }}>選手</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>MIN</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>PTS</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>eFG%</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>TS%</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>+/-</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>AST</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>REB</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>OREB</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>DREB</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>STL</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>BLK</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>TO</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>PF</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>FG (M-A)</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>3P (M-A)</th>
              <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>FT (M-A)</th>
            </tr>
          </thead>
          <tbody>
            {homePlayerStats.map(s => (
              <tr key={s.playerId}>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{s.number}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'left', fontWeight: 600 }}>{s.name}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{formatTime(s.playingTime)}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{s.pts}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.fga > 0 ? `${s.efgPercent.toFixed(1)}%` : '-'}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.fga + s.fta > 0 ? `${s.tsPercent.toFixed(1)}%` : '-'}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.ast}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.reb}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.oreb}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.dreb}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.stl}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.blk}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.to}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.pf}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.fgm}-{s.fga} ({s.fgPercent}%)</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.tpm}-{s.tpa} ({s.tpPercent}%)</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.ftm}-{s.fta} ({s.ftPercent}%)</td>
              </tr>
            ))}
            <tr style={{ background: '#f5f5f5', fontWeight: 'bold' }}>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>-</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'left' }}>自チーム 合計</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>-</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.pts}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.fga > 0 ? `${homeTeamStats.efgPercent.toFixed(1)}%` : '-'}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.fga + homeTeamStats.fta > 0 ? `${homeTeamStats.tsPercent.toFixed(1)}%` : '-'}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>
                {(() => {
                  const totalPM = homeTeamStats.pts - awayTeamStats.pts;
                  return totalPM > 0 ? `+${totalPM}` : totalPM;
                })()}
              </td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.ast}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.reb}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.oreb}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.dreb}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.stl}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.blk}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.to}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.pf}</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.fgm}-{homeTeamStats.fga} ({homeTeamStats.fgPercent}%)</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.tpm}-{homeTeamStats.tpa} ({homeTeamStats.tpPercent}%)</td>
              <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{homeTeamStats.ftm}-{homeTeamStats.fta} ({homeTeamStats.ftPercent}%)</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 2. 相手チーム ボックススコア */}
      <div style={{ marginBottom: '35px', pageBreakInside: 'avoid' }}>
        <h2 style={{ fontSize: '18px', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '12px', color: '#000', fontWeight: 700 }}>
          2. 相手チーム ボックススコア (Away Box Score)
        </h2>
        {scoutingMode ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#000' }} className="print-table">
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>#</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'left' }}>選手</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>PTS</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>eFG%</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>TS%</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>+/-</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>AST</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>REB</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>OREB</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>DREB</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>STL</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>BLK</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>TO</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>PF</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>FG (M-A)</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>3P (M-A)</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>FT (M-A)</th>
              </tr>
            </thead>
            <tbody>
              {awayPlayerStats.map(s => (
                <tr key={s.playerId}>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{s.number}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'left', fontWeight: 600 }}>{s.name}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{s.pts}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.fga > 0 ? `${s.efgPercent.toFixed(1)}%` : '-'}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.fga + s.fta > 0 ? `${s.tsPercent.toFixed(1)}%` : '-'}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', color: '#666' }}>-</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.ast}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.reb}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.oreb}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.dreb}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.stl}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.blk}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.to}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.pf}</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.fgm}-{s.fga} ({s.fgPercent}%)</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.tpm}-{s.tpa} ({s.tpPercent}%)</td>
                  <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{s.ftm}-{s.fta} ({s.ftPercent}%)</td>
                </tr>
              ))}
              <tr style={{ background: '#f5f5f5', fontWeight: 'bold' }}>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>-</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'left' }}>相手チーム 合計</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.pts}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.fga > 0 ? `${awayTeamStats.efgPercent.toFixed(1)}%` : '-'}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.fga + awayTeamStats.fta > 0 ? `${awayTeamStats.tsPercent.toFixed(1)}%` : '-'}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>
                  {(() => {
                    const totalPM = awayTeamStats.pts - homeTeamStats.pts;
                    return totalPM > 0 ? `+${totalPM}` : totalPM;
                  })()}
                </td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.ast}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.reb}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.oreb}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.dreb}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.stl}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.blk}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.to}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.pf}</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.fgm}-{awayTeamStats.fga} ({awayTeamStats.fgPercent}%)</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.tpm}-{awayTeamStats.tpa} ({awayTeamStats.tpPercent}%)</td>
                <td style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>{awayTeamStats.ftm}-{awayTeamStats.fta} ({awayTeamStats.ftPercent}%)</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#000' }} className="print-table">
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'left' }}>チーム</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>PTS</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>eFG%</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>TS%</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>+/-</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>TO</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>PF</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>FG (M-A)</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>3P (M-A)</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center' }}>FT (M-A)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #aaa', padding: '5px', fontWeight: 'bold' }}>相手チーム</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{awayTeamStats.pts}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.fga > 0 ? `${awayTeamStats.efgPercent.toFixed(1)}%` : '-'}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.fga + awayTeamStats.fta > 0 ? `${awayTeamStats.tsPercent.toFixed(1)}%` : '-'}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>
                  {(() => {
                    const totalPM = awayTeamStats.pts - homeTeamStats.pts;
                    return totalPM > 0 ? `+${totalPM}` : totalPM;
                  })()}
                </td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.to}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.pf}</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.fgm}-{awayTeamStats.fga} ({awayTeamStats.fgPercent}%)</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.tpm}-{awayTeamStats.tpa} ({awayTeamStats.tpPercent}%)</td>
                <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{awayTeamStats.ftm}-{awayTeamStats.fta} ({awayTeamStats.ftPercent}%)</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* 3. シュート分析チャート */}
      <div style={{ marginBottom: '35px', pageBreakInside: 'avoid' }}>
        <h2 style={{ fontSize: '18px', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '20px', color: '#000', fontWeight: 700 }}>
          3. シュートビジュアル分析 (Shot Charts)
        </h2>
        
        <div style={{ display: 'flex', gap: '30px', justifyContent: 'center' }}>
          {/* 自チームシュートチャート */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '45%' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#000' }}>自チーム (Home Team)</h3>
            <div style={{ border: '2px solid #333', width: '100%', maxWidth: '280px', background: '#fff' }}>
              <svg viewBox="0 0 100 95" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <rect x="0" y="0" width="100" height="95" fill="#fff" stroke="#333" strokeWidth="1" />
                <rect x="33.6" y="0" width="32.8" height="41.4" fill="none" stroke="#333" strokeWidth="1" />
                <path d="M 33.6 41.4 A 16.4 16.4 0 0 0 66.4 41.4" fill="none" stroke="#333" strokeWidth="1" />
                <path d="M 66.4 41.4 A 16.4 16.4 0 0 0 33.6 41.4" fill="none" stroke="#333" strokeWidth="1" strokeDasharray="1,1" />
                <path d="M 6 0 L 6 21.3 A 44 48.2 0 0 0 94 21.3 L 94 0" fill="none" stroke="#333" strokeWidth="1" />
                <path d="M 38 95 A 12 12 0 0 1 62 95" fill="none" stroke="#333" strokeWidth="1" />
                <line x1="44" y1="8.6" x2="56" y2="8.6" stroke="#333" strokeWidth="1.5" />
                <circle cx="50" cy="11.25" r="2.25" fill="none" stroke="#333" strokeWidth="1.5" />
                
                {events.filter(e => e.team === 'home' && ['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'].includes(e.type) && e.location).map(e => {
                  const isMade = e.type === '2P_MADE' || e.type === '3P_MADE';
                  return isMade ? (
                    <circle key={e.id} cx={e.location!.x} cy={e.location!.y} r="3" fill="#10b981" stroke="#fff" strokeWidth="0.5" />
                  ) : (
                    <g key={e.id}>
                      <line x1={e.location!.x - 2.5} y1={e.location!.y - 2.5} x2={e.location!.x + 2.5} y2={e.location!.y + 2.5} stroke="#ef4444" strokeWidth="1.5" />
                      <line x1={e.location!.x + 2.5} y1={e.location!.y - 2.5} x2={e.location!.x - 2.5} y2={e.location!.y + 2.5} stroke="#ef4444" strokeWidth="1.5" />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div style={{ fontSize: '11px', color: '#333', fontWeight: 600 }}>
              成功率: {homeTeamStats.fgm}/{homeTeamStats.fga} ({homeTeamStats.fgPercent}%)
            </div>
          </div>

          {/* 相手チームシュートチャート */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '45%' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#000' }}>相手チーム (Away Team)</h3>
            <div style={{ border: '2px solid #333', width: '100%', maxWidth: '280px', background: '#fff' }}>
              <svg viewBox="0 0 100 95" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <rect x="0" y="0" width="100" height="95" fill="#fff" stroke="#333" strokeWidth="1" />
                <rect x="33.6" y="0" width="32.8" height="41.4" fill="none" stroke="#333" strokeWidth="1" />
                <path d="M 33.6 41.4 A 16.4 16.4 0 0 0 66.4 41.4" fill="none" stroke="#333" strokeWidth="1" />
                <path d="M 66.4 41.4 A 16.4 16.4 0 0 0 33.6 41.4" fill="none" stroke="#333" strokeWidth="1" strokeDasharray="1,1" />
                <path d="M 6 0 L 6 21.3 A 44 48.2 0 0 0 94 21.3 L 94 0" fill="none" stroke="#333" strokeWidth="1" />
                <path d="M 38 95 A 12 12 0 0 1 62 95" fill="none" stroke="#333" strokeWidth="1" />
                <line x1="44" y1="8.6" x2="56" y2="8.6" stroke="#333" strokeWidth="1.5" />
                <circle cx="50" cy="11.25" r="2.25" fill="none" stroke="#333" strokeWidth="1.5" />
                
                {events.filter(e => e.team === 'away' && ['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'].includes(e.type) && e.location).map(e => {
                  const isMade = e.type === '2P_MADE' || e.type === '3P_MADE';
                  return isMade ? (
                    <circle key={e.id} cx={e.location!.x} cy={e.location!.y} r="3" fill="#10b981" stroke="#fff" strokeWidth="0.5" />
                  ) : (
                    <g key={e.id}>
                      <line x1={e.location!.x - 2.5} y1={e.location!.y - 2.5} x2={e.location!.x + 2.5} y2={e.location!.y + 2.5} stroke="#ef4444" strokeWidth="1.5" />
                      <line x1={e.location!.x + 2.5} y1={e.location!.y - 2.5} x2={e.location!.x - 2.5} y2={e.location!.y + 2.5} stroke="#ef4444" strokeWidth="1.5" />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div style={{ fontSize: '11px', color: '#333', fontWeight: 600 }}>
              成功率: {awayTeamStats.fgm}/{awayTeamStats.fga} ({awayTeamStats.fgPercent}%)
            </div>
          </div>
        </div>
      </div>

      {/* 4. 主要ラインナップ */}
      {lineups.length > 0 && (
        <div style={{ marginTop: '30px', pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '18px', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '15px', color: '#000', fontWeight: 700 }}>
            4. 主要ラインナップ分析 (Home Lineups - Top 5)
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#000' }} className="print-table">
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'left' }}>ラインナップ（選手）</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center', width: '80px' }}>出場時間</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center', width: '60px' }}>PTS得</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center', width: '60px' }}>PTS失</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center', width: '60px' }}>+/-</th>
                <th style={{ border: '1px solid #aaa', padding: '6px', textAlign: 'center', width: '80px' }}>得失/分</th>
              </tr>
            </thead>
            <tbody>
              {lineups.slice(0, 5).map((l, index) => {
                const playerNames = l.playerIds.map(pid => {
                  const p = players.find(player => player.id === pid);
                  return p ? `#${p.number} ${p.name.split(' ')[0]}` : pid;
                }).join(', ');
                
                return (
                  <tr key={index}>
                    <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'left' }}>{playerNames}</td>
                    <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{formatTime(l.duration)}</td>
                    <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{l.ptsFor}</td>
                    <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{l.ptsAgainst}</td>
                    <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>{l.plusMinus > 0 ? `+${l.plusMinus}` : l.plusMinus}</td>
                    <td style={{ border: '1px solid #aaa', padding: '5px', textAlign: 'center' }}>{l.ppm.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  );
};
