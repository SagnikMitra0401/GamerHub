const bcrypt = require('bcrypt');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');

const SALT_ROUNDS = 10;

const register = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ username, email, passwordHash });

    const token = generateToken(res, user._id);

    res.status(201).json({
      user: { id: user._id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing credentials' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(res, user._id);

    res.status(200).json({
      user: { id: user._id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    next(err);
  }
};

const logout = (req, res) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    expires: new Date(0),
    path: '/'
  });
  res.status(200).json({ message: 'Logged out' });
};

// Returns full profile — refetch so bio/preferredPlatforms/createdAt are included
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const token = req.cookies.jwt;
    res.status(200).json({ user, token });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/auth/profile  — update bio and/or preferredPlatforms
const updateProfile = async (req, res, next) => {
  try {
    const ALLOWED_PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Switch'];
    const { bio, preferredPlatforms } = req.body;

    const updates = {};

    if (bio !== undefined) {
      if (typeof bio !== 'string') {
        return res.status(400).json({ message: 'Bio must be a string' });
      }
      updates.bio = bio.trim().slice(0, 300);
    }

    if (preferredPlatforms !== undefined) {
      if (!Array.isArray(preferredPlatforms)) {
        return res.status(400).json({ message: 'preferredPlatforms must be an array' });
      }
      const invalid = preferredPlatforms.filter(p => !ALLOWED_PLATFORMS.includes(p));
      if (invalid.length) {
        return res.status(400).json({
          message: `Invalid platform(s): ${invalid.join(', ')}. Allowed: ${ALLOWED_PLATFORMS.join(', ')}`
        });
      }
      updates.preferredPlatforms = [...new Set(preferredPlatforms)]; // deduplicate
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: 'No updatable fields provided' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash');

    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, logout, getMe, updateProfile };
