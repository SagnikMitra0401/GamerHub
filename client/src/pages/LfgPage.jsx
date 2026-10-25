import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import CreatePartyModal from '../components/lfg/CreatePartyModal';
import useCursorGlow from '../hooks/useCursorGlow';

const userName = (value) => value?.username || 'deleted user';
const userId = (value) => value?._id || value;

function timeLeft(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.round(ms / 60_000))}m left`;
}

const SlotDots = ({ taken, max }) => (
  <span className="lfg-slots" aria-label={`${taken} of ${max} slots filled`}>
    {Array.from({ length: max }).map((_, idx) => (
      <span key={idx} className={`lfg-slot${idx < taken ? ' filled' : ''}`} />
    ))}
    <span className="lfg-slot-count">{taken}/{max}</span>
  </span>
);

const PartyCard = ({ party, onJoin, onRespond, onClose, joining, joinMessage, setJoinMessage }) => {
  const members = party.members || [];
  const isLeader = party.viewerMembership === 'leader';
  const canJoin = party.viewerMembership === 'none' && party.openSlots > 0 && party.status === 'open';

  return (
    <article className={`lfg-card glow-card${isLeader ? ' mine' : ''}`}>
      <div className="lfg-card-top">
        {party.gameThumbnail ? (
          <img className="lfg-thumb" src={party.gameThumbnail} alt="" loading="lazy" />
        ) : (
          <div className="lfg-thumb lfg-thumb-fallback" aria-hidden="true">LFG</div>
        )}
        <div className="lfg-card-head">
          <h3 className="lfg-game">{party.gameTitle}</h3>
          <p className="lfg-activity">{party.activity || 'Any activity'}</p>
          <div className="lfg-tags">
            <SlotDots taken={members.length} max={party.maxSlots} />
            {party.requirements?.micRequired && <span className="lfg-tag">Mic required</span>}
            {party.requirements?.minRank && <span className="lfg-tag">{party.requirements.minRank}</span>}
            {isLeader && <span className="lfg-tag lfg-tag-lead">Your squad</span>}
          </div>
        </div>
        <span className="lfg-expiry">{party.status === 'open' ? timeLeft(party.expiresAt) : party.status}</span>
      </div>

      <div className="lfg-members">
        {members.map(member => (
          <span key={userId(member.user)} className="lfg-member" title={userName(member.user)}>
            <span className="lfg-avatar">{userName(member.user).slice(0, 1).toUpperCase()}</span>
            {userName(member.user)}
            {member.role === 'leader' && <span className="lfg-leader-tag">Leader</span>}
          </span>
        ))}
      </div>

      {isLeader && (party.requests || []).length > 0 && (
        <div className="lfg-requests">
          <h4>Pending requests ({party.requests.length})</h4>
          {party.requests.map(request => (
            <div key={userId(request.user)} className="lfg-request">
              <span className="lfg-request-name">
                @{userName(request.user)}
                {request.message && <em className="lfg-request-msg">“{request.message}”</em>}
              </span>
              <span className="lfg-request-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={joining === `${party._id}:${userId(request.user)}`}
                  onClick={() => onRespond(party, userId(request.user), 'accept')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRespond(party, userId(request.user), 'reject')}
                >
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {canJoin && (
        <div className="lfg-join">
          <input
            className="form-input lfg-join-input"
            value={joinMessage[party._id] || ''}
            maxLength={200}
            placeholder="Optional message to the leader"
            onChange={e => setJoinMessage(prev => ({ ...prev, [party._id]: e.target.value }))}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={joining === party._id}
            onClick={() => onJoin(party)}
          >
            {joining === party._id ? 'Sending…' : 'Request to join'}
          </button>
        </div>
      )}

      {party.viewerMembership === 'pending' && (
        <p className="lfg-note">Request sent — waiting for the leader.</p>
      )}
      {party.viewerMembership === 'member' && (
        <p className="lfg-note">You are in this squad.</p>
      )}

      {isLeader && (
        <div className="lfg-card-footer">
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onClose(party)}>
            Close squad
          </button>
        </div>
      )}
    </article>
  );
};

const LfgPage = () => {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ game: '', mic: false, openSlots: false });
  const [parties, setParties] = useState([]);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [joining, setJoining] = useState(null);
  const [joinMessage, setJoinMessage] = useState({});
  const reloadTimer = useRef(null);
  const glowRef = useCursorGlow();

  const load = useCallback(async (currentFilters = filters) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (currentFilters.game.trim()) params.set('game', currentFilters.game.trim());
      if (currentFilters.mic) params.set('mic', '1');
      if (currentFilters.openSlots) params.set('openSlots', '1');

      const { data } = await axiosInstance.get(`/lfg?${params.toString()}`);
      setParties(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError('Could not load the LFG board.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMine = useCallback(async () => {
    if (!user) { setMine([]); return; }
    try {
      const { data } = await axiosInstance.get('/lfg/mine');
      setMine(Array.isArray(data.items) ? data.items : []);
    } catch {
      setMine([]);
    }
  }, [user?._id]);

  useEffect(() => { load(filters); }, [filters.mic, filters.openSlots]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMine(); }, [loadMine]);

  // Live board: any slot change anywhere re-reads the list (debounced).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const scheduleReload = () => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => {
        load(filters);
        loadMine();
      }, 350);
    };
    const onRequest = (payload) => {
      setToast(`${payload?.requester?.username || 'A player'} wants to join your ${payload?.gameTitle || 'squad'}.`);
      scheduleReload();
    };

    socket.on('lfg_slot_updated', scheduleReload);
    socket.on('lfg_join_request', onRequest);
    return () => {
      clearTimeout(reloadTimer.current);
      socket.off('lfg_slot_updated', scheduleReload);
      socket.off('lfg_join_request', onRequest);
    };
  }, [load, loadMine, filters.game, filters.mic, filters.openSlots]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const join = async (party) => {
    setJoining(party._id);
    setError('');
    try {
      await axiosInstance.post(`/lfg/${party._id}/request`, { message: joinMessage[party._id] || '' });
      setToast(`Request sent to @${userName(party.leader)}.`);
      setJoinMessage(prev => ({ ...prev, [party._id]: '' }));
      await load(filters);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send that request.');
    } finally {
      setJoining(null);
    }
  };

  const respond = async (party, applicantId, action) => {
    setJoining(`${party._id}:${applicantId}`);
    setError('');
    try {
      const { data } = await axiosInstance.patch(`/lfg/${party._id}/respond`, { userId: applicantId, action });
      setMine(prev => prev.map(p => (p._id === data.party._id ? data.party : p)));
      setToast(action === 'accept' ? 'Player added to your squad.' : 'Request declined.');
      load(filters);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update that request.');
    } finally {
      setJoining(null);
    }
  };

  const closeParty = async (party) => {
    if (!window.confirm(`Close your ${party.gameTitle} squad?`)) return;
    try {
      await axiosInstance.delete(`/lfg/${party._id}`);
      setMine(prev => prev.filter(p => p._id !== party._id));
      setToast('Squad closed.');
      load(filters);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not close that squad.');
    }
  };

  const submitFilters = (event) => {
    event.preventDefault();
    load(filters);
  };

  return (
    <main className="page" ref={glowRef}>
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">LFG Board</h1>
            <p className="page-subtitle">Find a squad, fill your slots, play together.</p>
          </div>
          {user ? (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create squad</button>
          ) : (
            <Link to="/login" className="btn btn-primary">Sign in to post</Link>
          )}
        </div>

        {toast && <div className="notice notice-success">{toast}</div>}
        {error && <div className="notice notice-error">{error}</div>}

        <form className="lfg-filters" onSubmit={submitFilters}>
          <input
            className="form-input"
            value={filters.game}
            placeholder="Filter by game…"
            aria-label="Filter by game"
            onChange={e => setFilters(prev => ({ ...prev, game: e.target.value }))}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.mic}
              onChange={e => setFilters(prev => ({ ...prev, mic: e.target.checked }))}
            />
            Mic only
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.openSlots}
              onChange={e => setFilters(prev => ({ ...prev, openSlots: e.target.checked }))}
            />
            Open slots
          </label>
          <button className="btn btn-ghost btn-sm" type="submit">Search</button>
        </form>

        {user && mine.length > 0 && (
          <section className="lfg-section">
            <h2 className="section-heading">Your squads</h2>
            <div className="lfg-grid">
              {mine.map(party => (
                <PartyCard
                  key={party._id}
                  party={party}
                  onJoin={join}
                  onRespond={respond}
                  onClose={closeParty}
                  joining={joining}
                  joinMessage={joinMessage}
                  setJoinMessage={setJoinMessage}
                />
              ))}
            </div>
          </section>
        )}

        <section className="lfg-section">
          <h2 className="section-heading">Open squads</h2>
          {loading ? (
            <div className="spinner" />
          ) : parties.length === 0 ? (
            <div className="post-list-empty">
              <h3>No squads recruiting</h3>
              <p>Be the first to post one — it takes ten seconds.</p>
            </div>
          ) : (
            <div className="lfg-grid">
              {parties.map(party => (
                <PartyCard
                  key={party._id}
                  party={party}
                  onJoin={join}
                  onRespond={respond}
                  onClose={closeParty}
                  joining={joining}
                  joinMessage={joinMessage}
                  setJoinMessage={setJoinMessage}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <CreatePartyModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(party) => {          setToast(`${party.gameTitle} squad is live.`);
          setMine(prev => [party, ...prev]);
          load(filters);
        }}
      />
    </main>
  );
};

export default LfgPage;
