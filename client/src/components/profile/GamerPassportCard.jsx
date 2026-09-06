import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

const DEVICE_ICONS = {
  PC: '🖥️',
  Laptop: '💻',
  Mobile: '📱',
  Console: '🎮',
  Handheld: '🕹️'
};

const PLATFORM_ICONS = {
  PC: '🖥️',
  PlayStation: '🎮',
  Xbox: '🟢',
  Switch: '🔴',
  Mobile: '📱',
  Other: '🎯'
};

const GamerPassportCard = ({ passport, username, isOwnProfile, onEditClick }) => {
  const [copiedKey, setCopiedKey] = useState(null);
  const [selectedRigIdx, setSelectedRigIdx] = useState(0);
  const [expandedRig, setExpandedRig] = useState(null);

  // Close expanded modal on Escape
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') setExpandedRig(null); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const copyToClipboard = (text, key) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const downloadSpecsTxt = (rig) => {
    if (!rig) return;
    const content = [
      '========================================',
      'GAMINGHUB - BATTLE STATION SPEC SHEET',
      '========================================',
      `Gamer:         ${username || 'Gamer'}`,
      `Setup Name:    ${rig.rigName}`,
      `Device Type:   ${rig.deviceType}`,
      `Primary Setup: ${rig.isPrimary ? 'Yes' : 'No'}`,
      '',
      '[HARDWARE SPECIFICATIONS]',
      `CPU:           ${rig.specs?.cpu || 'Not specified'}`,
      `GPU / Graphics:${rig.specs?.gpu || 'Not specified'}`,
      `RAM / Memory:  ${rig.specs?.ram || 'Not specified'}`,
      `Display:       ${rig.specs?.monitor || 'Not specified'}`,
      `Gear / Extras: ${rig.specs?.peripherals || 'Not specified'}`,
      '',
      '========================================',
      `Exported On:   ${new Date().toLocaleString()}`,
      'Generated via GamingHub Gamer Passport'
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${username || 'Gamer'}-${rig.rigName.replace(/[^a-zA-Z0-9_-]/g, '_')}-Specs.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const gameIds = passport?.gameIds || {};
  const activeGames = passport?.activeGames || [];
  const hardwareRigs = passport?.hardwareRigs || [];
  const customQuote = passport?.customQuote || '';

  const hasAnyIds = Object.values(gameIds).some(v => v && v.trim());
  const hasGames = activeGames.length > 0;
  const hasRigs = hardwareRigs.length > 0;
  const currentRig = hardwareRigs[selectedRigIdx] || hardwareRigs[0];

  return (
    <div className="card passport-card">
      <div className="passport-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🪪</span>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>Gamer Passport</h3>
        </div>
        {isOwnProfile && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onEditClick}
            title="Edit your Gamer Passport and Battle Station specs"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
          >
            ✏️ Edit
          </button>
        )}
      </div>

      {/* Signature Quote / Motto */}
      {customQuote && (
        <div className="passport-quote-box">
          <span className="quote-icon">“</span>
          <p className="quote-text">{customQuote}</p>
        </div>
      )}

      {/* In-Game Accounts / Gamer Tags */}
      <div className="passport-section">
        <h4 className="passport-section-title">🎯 In-Game Accounts</h4>
        {!hasAnyIds ? (
          <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
            {isOwnProfile ? 'No in-game IDs linked yet. Click Edit to add them!' : 'No in-game accounts listed.'}
          </p>
        ) : (
          <div className="game-ids-list">
            {gameIds.riotId && (
              <div className="id-badge-row">
                <span className="id-badge-label">🎯 Riot</span>
                <span className="id-badge-val" title={gameIds.riotId}>{gameIds.riotId}</span>
                <button
                  className={`copy-btn ${copiedKey === 'riot' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(gameIds.riotId, 'riot')}
                  title="Copy Riot ID"
                >
                  {copiedKey === 'riot' ? '✔️' : '📋'}
                </button>
              </div>
            )}

            {gameIds.steamId && (
              <div className="id-badge-row">
                <span className="id-badge-label">💨 Steam</span>
                <span className="id-badge-val" title={gameIds.steamId}>{gameIds.steamId}</span>
                <button
                  className={`copy-btn ${copiedKey === 'steam' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(gameIds.steamId, 'steam')}
                  title="Copy Steam ID"
                >
                  {copiedKey === 'steam' ? '✔️' : '📋'}
                </button>
              </div>
            )}

            {gameIds.psnTag && (
              <div className="id-badge-row">
                <span className="id-badge-label">🎮 PSN</span>
                <span className="id-badge-val" title={gameIds.psnTag}>{gameIds.psnTag}</span>
                <button
                  className={`copy-btn ${copiedKey === 'psn' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(gameIds.psnTag, 'psn')}
                  title="Copy PSN Tag"
                >
                  {copiedKey === 'psn' ? '✔️' : '📋'}
                </button>
              </div>
            )}

            {gameIds.xboxTag && (
              <div className="id-badge-row">
                <span className="id-badge-label">🟢 Xbox</span>
                <span className="id-badge-val" title={gameIds.xboxTag}>{gameIds.xboxTag}</span>
                <button
                  className={`copy-btn ${copiedKey === 'xbox' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(gameIds.xboxTag, 'xbox')}
                  title="Copy Xbox Tag"
                >
                  {copiedKey === 'xbox' ? '✔️' : '📋'}
                </button>
              </div>
            )}

            {gameIds.discordTag && (
              <div className="id-badge-row">
                <span className="id-badge-label">💬 Discord</span>
                <span className="id-badge-val" title={gameIds.discordTag}>{gameIds.discordTag}</span>
                <button
                  className={`copy-btn ${copiedKey === 'discord' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(gameIds.discordTag, 'discord')}
                  title="Copy Discord Tag"
                >
                  {copiedKey === 'discord' ? '✔️' : '📋'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Featured Games & Ranks */}
      <div className="passport-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
          <h4 className="passport-section-title" style={{ margin: 0 }}>🎮 Active Games</h4>
          <span className="self-report-label" title="Ranks self-reported by gamer">Self-Reported</span>
        </div>

        {!hasGames ? (
          <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
            {isOwnProfile ? 'No featured games added yet.' : 'No active games listed.'}
          </p>
        ) : (
          <div className="active-games-grid">
            {activeGames.map((game, i) => (
              <div key={i} className="active-game-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden' }}>
                  <span>{PLATFORM_ICONS[game.platform] || '🎮'}</span>
                  <span className="game-item-title" title={game.gameName}>{game.gameName}</span>
                </div>
                {game.rankOrLevel ? (
                  <span className="game-rank-badge" title={game.rankOrLevel}>
                    {game.rankOrLevel}
                  </span>
                ) : (
                  <span className="text-muted" style={{ fontSize: '0.72rem' }}>Playing</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Multi-Rig Battle Station Hardware */}
      <div className="passport-section" style={{ borderBottom: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
          <h4 className="passport-section-title" style={{ margin: 0 }}>🖥️ Battle Station</h4>
          <span className="self-report-label" title="Hardware specifications self-reported by gamer">Self-Reported</span>
        </div>

        {!hasRigs ? (
          <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
            {isOwnProfile ? 'No gaming rigs configured. Click Edit to showcase your setup!' : 'No hardware setups listed.'}
          </p>
        ) : (
          <div>
            {/* Rig Switcher Pills if > 1 device */}
            {hardwareRigs.length > 1 && (
              <div className="rig-tabs">
                {hardwareRigs.map((rig, idx) => (
                  <button
                    key={idx}
                    className={`rig-tab${selectedRigIdx === idx ? ' active' : ''}`}
                    onClick={() => setSelectedRigIdx(idx)}
                    title={rig.rigName}
                  >
                    {DEVICE_ICONS[rig.deviceType] || '🖥️'} {rig.rigName}
                    {rig.isPrimary && <span style={{ marginLeft: '2px' }}>⭐</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Current Selected Rig Spec Card */}
            {currentRig && (
              <div 
                className="rig-spec-card"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedRig(currentRig)}
                title="Click to expand full untruncated specs"
              >
                <div className="rig-spec-header">
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                    {DEVICE_ICONS[currentRig.deviceType] || '🖥️'} {currentRig.rigName}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    {currentRig.isPrimary && (
                      <span className="primary-rig-badge">Primary Setup</span>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '1px 5px', fontSize: '0.7rem', color: 'var(--accent)' }}
                      onClick={(e) => { e.stopPropagation(); setExpandedRig(currentRig); }}
                      title="Expand full specifications"
                    >
                      🔍 Expand
                    </button>
                  </div>
                </div>

                <div className="rig-specs-list">
                  {currentRig.specs?.cpu && (
                    <div className="spec-row">
                      <span className="spec-key">CPU</span>
                      <span className="spec-val" title={currentRig.specs.cpu}>{currentRig.specs.cpu}</span>
                    </div>
                  )}
                  {currentRig.specs?.gpu && (
                    <div className="spec-row">
                      <span className="spec-key">GPU</span>
                      <span className="spec-val" title={currentRig.specs.gpu}>{currentRig.specs.gpu}</span>
                    </div>
                  )}
                  {currentRig.specs?.ram && (
                    <div className="spec-row">
                      <span className="spec-key">RAM</span>
                      <span className="spec-val" title={currentRig.specs.ram}>{currentRig.specs.ram}</span>
                    </div>
                  )}
                  {currentRig.specs?.monitor && (
                    <div className="spec-row">
                      <span className="spec-key">Display</span>
                      <span className="spec-val" title={currentRig.specs.monitor}>{currentRig.specs.monitor}</span>
                    </div>
                  )}
                  {currentRig.specs?.peripherals && (
                    <div className="spec-row">
                      <span className="spec-key">Gear</span>
                      <span className="spec-val" title={currentRig.specs.peripherals}>{currentRig.specs.peripherals}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded Mini Window / Rig Detail Modal */}
      {expandedRig && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={() => setExpandedRig(null)} role="dialog" aria-modal="true">
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.3rem' }}>{DEVICE_ICONS[expandedRig.deviceType] || '🖥️'}</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>{expandedRig.rigName}</h3>
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {expandedRig.deviceType} Setup {expandedRig.isPrimary ? '• ⭐ Primary' : ''}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setExpandedRig(null)} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Untruncated Full Specs List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div className="card" style={{ background: 'var(--bg-elevated)', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>CPU / Processor</span>
                <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {expandedRig.specs?.cpu || 'Not specified'}
                </p>
              </div>

              <div className="card" style={{ background: 'var(--bg-elevated)', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>GPU / Graphics</span>
                <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {expandedRig.specs?.gpu || 'Not specified'}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="card" style={{ background: 'var(--bg-elevated)', padding: '0.75rem' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>RAM / Memory</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                    {expandedRig.specs?.ram || 'Not specified'}
                  </p>
                </div>

                <div className="card" style={{ background: 'var(--bg-elevated)', padding: '0.75rem' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Display / Monitor</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                    {expandedRig.specs?.monitor || 'Not specified'}
                  </p>
                </div>
              </div>

              {expandedRig.specs?.peripherals && (
                <div className="card" style={{ background: 'var(--bg-elevated)', padding: '0.75rem' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Gear & Peripherals</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                    {expandedRig.specs.peripherals}
                  </p>
                </div>
              )}
            </div>

            {/* Footer with Download Specs Button on the Lower Right Corner */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <button 
                type="button" 
                className="btn btn-ghost btn-sm" 
                onClick={() => setExpandedRig(null)}
              >
                Close
              </button>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => downloadSpecsTxt(expandedRig)}
                title="Download this rig's specifications as a .txt file"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                💾 Download Specs (.txt)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default GamerPassportCard;
