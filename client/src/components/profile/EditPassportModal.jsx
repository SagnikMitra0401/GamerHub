import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import axiosInstance from '../../api/axiosInstance';
import { detectCurrentDevice } from '../../utils/deviceDetector';

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile', 'Other'];
const DEVICE_TYPES = ['PC', 'Laptop', 'Mobile', 'Console', 'Handheld'];

const EditPassportModal = ({ isOpen, onClose, initialPassport, onSave }) => {
  const [activeTab, setActiveTab] = useState('ids');
  const [customQuote, setCustomQuote] = useState('');
  const [gameIds, setGameIds] = useState({
    riotId: '',
    steamId: '',
    psnTag: '',
    xboxTag: '',
    discordTag: ''
  });
  const [activeGames, setActiveGames] = useState([]);
  const [hardwareRigs, setHardwareRigs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      setCustomQuote(initialPassport?.customQuote || '');
      setGameIds({
        riotId:     initialPassport?.gameIds?.riotId || '',
        steamId:    initialPassport?.gameIds?.steamId || '',
        psnTag:     initialPassport?.gameIds?.psnTag || '',
        xboxTag:    initialPassport?.gameIds?.xboxTag || '',
        discordTag: initialPassport?.gameIds?.discordTag || ''
      });
      setActiveGames(Array.isArray(initialPassport?.activeGames) ? [...initialPassport.activeGames] : []);
      setHardwareRigs(Array.isArray(initialPassport?.hardwareRigs) ? [...initialPassport.hardwareRigs] : []);
    }
  }, [isOpen, initialPassport]);

  // Handle Escape
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!isOpen) return null;

  // Games handlers
  const addGame = () => {
    if (activeGames.length >= 10) return;
    setActiveGames(prev => [...prev, { gameName: '', platform: 'PC', rankOrLevel: '' }]);
  };

  const updateGame = (index, field, value) => {
    setActiveGames(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const removeGame = (index) => {
    setActiveGames(prev => prev.filter((_, i) => i !== index));
  };

  // Rigs handlers
  const addRig = () => {
    if (hardwareRigs.length >= 5) return;
    const isFirst = hardwareRigs.length === 0;
    setHardwareRigs(prev => [
      ...prev,
      {
        rigName: `Rig #${prev.length + 1}`,
        deviceType: 'PC',
        isPrimary: isFirst,
        specs: { cpu: '', gpu: '', ram: '', monitor: '', peripherals: '' }
      }
    ]);
  };

  const updateRig = (index, field, value) => {
    setHardwareRigs(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const updateRigSpec = (index, specField, value) => {
    setHardwareRigs(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        specs: { ...copy[index].specs, [specField]: value }
      };
      return copy;
    });
  };

  const setPrimaryRig = (index) => {
    setHardwareRigs(prev =>
      prev.map((r, i) => ({ ...r, isPrimary: i === index }))
    );
  };

  const removeRig = (index) => {
    setHardwareRigs(prev => {
      const filtered = prev.filter((_, i) => i !== index);
      // Ensure at least one primary if any remain
      if (filtered.length > 0 && !filtered.some(r => r.isPrimary)) {
        filtered[0].isPrimary = true;
      }
      return filtered;
    });
  };

  const handleAutoDetect = (rigIndex) => {
    const detected = detectCurrentDevice();

    // Check for duplicate / similar hardware in other existing rigs
    const similarRigs = hardwareRigs.filter((r, idx) => {
      if (idx === rigIndex) return false;
      const sameGpu = detected.specs.gpu && r.specs?.gpu && r.specs.gpu.toLowerCase() === detected.specs.gpu.toLowerCase();
      const sameMonitor = detected.specs.monitor && r.specs?.monitor && r.specs.monitor.toLowerCase() === detected.specs.monitor.toLowerCase();
      const sameCpu = detected.specs.cpu && r.specs?.cpu && r.specs.cpu.toLowerCase() === detected.specs.cpu.toLowerCase();
      return (sameGpu && sameMonitor) || sameGpu || (sameCpu && sameMonitor);
    });

    if (similarRigs.length > 0) {
      const matchNames = similarRigs.map(r => `"${r.rigName}"`).join(', ');
      const matchDetails = similarRigs.map(r => `• ${r.rigName} (GPU: ${r.specs?.gpu || 'N/A'}, Display: ${r.specs?.monitor || 'N/A'})`).join('\n');
      const proceed = window.confirm(
        `⚠️ Similar Device Detected!\n\n` +
        `The detected hardware specifications match existing setup(s):\n${matchDetails}\n\n` +
        `Hardware similarities found with: ${matchNames}.\n\n` +
        `Do you want to proceed and save this as a duplicate setup, or click Cancel to skip changes?`
      );
      if (!proceed) return; // Skip changes!
    }

    // Overwrite the present info in this specific rig with the newly detected specs
    setHardwareRigs(prev => {
      const copy = [...prev];
      const target = copy[rigIndex] || {};
      copy[rigIndex] = {
        ...target,
        deviceType: detected.deviceType,
        specs: {
          cpu:         detected.specs.cpu || '',
          gpu:         detected.specs.gpu || '',
          ram:         detected.specs.ram || '',
          monitor:     detected.specs.monitor || '',
          peripherals: target.specs?.peripherals || ''
        }
      };
      return copy;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        customQuote,
        gameIds,
        activeGames: activeGames.filter(g => g.gameName.trim()),
        hardwareRigs: hardwareRigs.filter(r => r.rigName.trim())
      };

      const { data } = await axiosInstance.put('/users/me/passport', payload);
      onSave(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save gamer passport');
    } finally {
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box passport-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🪪 Edit Gamer Passport
          </h2>
          <button className="search-clear" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {/* Tabs */}
        <div className="search-tabs" style={{ marginBottom: '1.25rem', padding: '0 0 0.5rem 0' }}>
          <button
            type="button"
            className={`search-tab${activeTab === 'ids' ? ' active' : ''}`}
            onClick={() => setActiveTab('ids')}
          >
            🏷️ In-Game IDs
          </button>
          <button
            type="button"
            className={`search-tab${activeTab === 'games' ? ' active' : ''}`}
            onClick={() => setActiveTab('games')}
          >
            🎮 Games & Ranks ({activeGames.length}/10)
          </button>
          <button
            type="button"
            className={`search-tab${activeTab === 'rigs' ? ' active' : ''}`}
            onClick={() => setActiveTab('rigs')}
          >
            🖥️ Battle Station ({hardwareRigs.length}/5)
          </button>
          <button
            type="button"
            className={`search-tab${activeTab === 'quote' ? ' active' : ''}`}
            onClick={() => setActiveTab('quote')}
          >
            💬 Motto / Quote
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
            {/* Tab 1: Game IDs */}
            {activeTab === 'ids' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                  Add your game handles and gamer tags so other gamers can connect and play with you.
                </p>

                <div className="form-group">
                  <label className="form-label">🎯 Riot ID (e.g. TenZ#NA1)</label>
                  <input
                    className="form-input"
                    placeholder="Username#TAG"
                    value={gameIds.riotId}
                    maxLength={40}
                    onChange={e => setGameIds({ ...gameIds, riotId: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">💨 Steam ID / Custom URL</label>
                  <input
                    className="form-input"
                    placeholder="e.g. 76561198... or CustomName"
                    value={gameIds.steamId}
                    maxLength={40}
                    onChange={e => setGameIds({ ...gameIds, steamId: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">🎮 PlayStation Network (PSN)</label>
                  <input
                    className="form-input"
                    placeholder="e.g. PSN_Gamer"
                    value={gameIds.psnTag}
                    maxLength={40}
                    onChange={e => setGameIds({ ...gameIds, psnTag: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">🟢 Xbox Gamertag</label>
                  <input
                    className="form-input"
                    placeholder="e.g. MasterChief#123"
                    value={gameIds.xboxTag}
                    maxLength={40}
                    onChange={e => setGameIds({ ...gameIds, xboxTag: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">💬 Discord Handle</label>
                  <input
                    className="form-input"
                    placeholder="e.g. gamer_tag"
                    value={gameIds.discordTag}
                    maxLength={40}
                    onChange={e => setGameIds({ ...gameIds, discordTag: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* Tab 2: Games & Ranks */}
            {activeTab === 'games' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                    Feature games you play and your current self-reported ranks/levels.
                  </p>
                  {activeGames.length < 10 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addGame}>
                      ➕ Add Game
                    </button>
                  )}
                </div>

                {activeGames.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No featured games added yet. Click "+ Add Game" to start.
                  </div>
                ) : (
                  activeGames.map((game, idx) => (
                    <div key={idx} className="card" style={{ padding: '0.75rem', background: 'var(--bg-elevated)' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                        <input
                          className="form-input"
                          style={{ flex: 2 }}
                          placeholder="Game Title (e.g. Valorant, Apex)"
                          value={game.gameName}
                          maxLength={40}
                          onChange={e => updateGame(idx, 'gameName', e.target.value)}
                          required
                        />
                        <select
                          className="form-input"
                          style={{ flex: 1.2 }}
                          value={game.platform}
                          onChange={e => updateGame(idx, 'platform', e.target.value)}
                        >
                          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => removeGame(idx)}
                          title="Remove Game"
                        >
                          🗑️
                        </button>
                      </div>
                      <input
                        className="form-input"
                        placeholder="Current Rank or Level (e.g. Diamond 2, AR 60, Master)"
                        value={game.rankOrLevel}
                        maxLength={40}
                        onChange={e => updateGame(idx, 'rankOrLevel', e.target.value)}
                      />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 3: Multi-Rig Battle Station */}
            {activeTab === 'rigs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                    Add up to 5 devices (Desktop PC, Laptop, Mobile, Consoles).
                  </p>
                  {hardwareRigs.length < 5 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addRig}>
                      ➕ Add Device
                    </button>
                  )}
                </div>

                {hardwareRigs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No gaming devices added yet. Click "+ Add Device" to set up your battle station!
                  </div>
                ) : (
                  hardwareRigs.map((rig, idx) => (
                    <div key={idx} className="card" style={{ padding: '0.85rem', background: 'var(--bg-elevated)', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                          <input
                            className="form-input"
                            style={{ fontWeight: 700, maxWidth: '180px' }}
                            placeholder="Rig / Setup Name"
                            value={rig.rigName}
                            maxLength={40}
                            onChange={e => updateRig(idx, 'rigName', e.target.value)}
                            required
                          />
                          <select
                            className="form-input"
                            style={{ maxWidth: '120px' }}
                            value={rig.deviceType}
                            onChange={e => updateRig(idx, 'deviceType', e.target.value)}
                          >
                            {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${rig.isPrimary ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setPrimaryRig(idx)}
                            title="Set as your primary gaming device"
                            style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
                          >
                            {rig.isPrimary ? '⭐ Primary' : 'Set Primary'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={() => removeRig(idx)}
                            title="Remove Device"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* Auto detect button for this rig */}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ width: '100%', marginBottom: '0.65rem', fontSize: '0.78rem', borderColor: 'var(--accent)' }}
                        onClick={() => handleAutoDetect(idx)}
                      >
                        ⚡ Auto-Detect This Device's Specs
                      </button>

                      {/* Specs Fields */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>CPU</label>
                          <input
                            className="form-input"
                            placeholder="e.g. Ryzen 7 7800X3D"
                            value={rig.specs?.cpu || ''}
                            maxLength={60}
                            onChange={e => updateRigSpec(idx, 'cpu', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>GPU / Graphics</label>
                          <input
                            className="form-input"
                            placeholder="e.g. RTX 4080 16GB"
                            value={rig.specs?.gpu || ''}
                            maxLength={60}
                            onChange={e => updateRigSpec(idx, 'gpu', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>RAM / Memory</label>
                          <input
                            className="form-input"
                            placeholder="e.g. 32GB DDR5"
                            value={rig.specs?.ram || ''}
                            maxLength={40}
                            onChange={e => updateRigSpec(idx, 'ram', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Monitor / Display</label>
                          <input
                            className="form-input"
                            placeholder="e.g. 27'' 240Hz OLED"
                            value={rig.specs?.monitor || ''}
                            maxLength={60}
                            onChange={e => updateRigSpec(idx, 'monitor', e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ marginTop: '0.5rem' }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Peripherals / Accessories</label>
                        <input
                          className="form-input"
                          placeholder="e.g. Wooting 60HE, Logitech Superlight, DualSense"
                          value={rig.specs?.peripherals || ''}
                          maxLength={120}
                          onChange={e => updateRigSpec(idx, 'peripherals', e.target.value)}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 4: Player Motto */}
            {activeTab === 'quote' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                  Personalize your profile with a signature gamer quote, motto, or playstyle statement.
                </p>
                <div className="form-group">
                  <label className="form-label">Signature Quote / Motto</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="e.g. 'Never back down, never what? GLHF!'"
                    value={customQuote}
                    maxLength={120}
                    onChange={e => setCustomQuote(e.target.value)}
                  />
                  <span className="text-muted" style={{ fontSize: '0.75rem', textAlign: 'right', display: 'block' }}>
                    {customQuote.length}/120
                  </span>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : '💾 Save Passport'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default EditPassportModal;
