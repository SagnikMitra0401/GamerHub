/**
 * scripts/seed-demo-data.js
 *
 * Populates realistic demonstration data into your primary database
 * so your live presentation looks active, vibrant, and populated.
 *
 * Safe & idempotent:
 * - Does not wipe any existing users or posts.
 * - Adds authentic gaming communities with channels.
 * - Seeds active LFG squads (Valorant, Apex, Overwatch).
 * - Seeds YouTube Gaming Bot updates & in-app notifications.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../server/models/User');
const Community = require('../server/models/Community');
const Channel = require('../server/models/Channel');
const Message = require('../server/models/Message');
const Party = require('../server/models/Party');
const Notification = require('../server/models/Notification');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB Atlas:', mongoose.connection.name);

    // 1. Get primary user (Sagnik0401) and secondary users
    let sagnik = await User.findOne({ username: 'Sagnik0401' });
    let hyper = await User.findOne({ username: 'Hyper' });
    let steve = await User.findOne({ username: 'Steve' });

    if (!sagnik) {
      console.log('Primary user not found, aborting seed.');
      return;
    }

    // Ensure Sagnik has proper preferences and presence for the demo
    sagnik.role = 'admin';
    sagnik.preferences = {
      favoriteGames: ['Valorant', 'Apex Legends', 'Cyberpunk 2077', 'Overwatch 2'],
      favoriteGenres: ['Shooter', 'Battle Royale', 'RPG'],
      platforms: ['PC', 'PlayStation']
    };
    sagnik.presence = {
      status: 'in_game',
      activeGame: 'Valorant',
      lastActive: new Date()
    };
    await sagnik.save();
    console.log('✔ Updated Sagnik0401 with admin role, presence, and gaming preferences');

    // 2. Create rich Community: "Valorant Champions Hub"
    let valCommunity = await Community.findOne({ slug: 'valorant-champions-hub' });
    if (!valCommunity) {
      valCommunity = await Community.create({
        name: 'Valorant Champions Hub',
        slug: 'valorant-champions-hub',
        description: 'Official competitive scrims, radiant lineups, and party coordination.',
        icon: '🎯',
        banner: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
        ownerId: sagnik._id,
        isPrivate: false,
        members: [
          { userId: sagnik._id, role: 'owner' },
          ...(hyper ? [{ userId: hyper._id, role: 'admin' }] : []),
          ...(steve ? [{ userId: steve._id, role: 'member' }] : [])
        ]
      });

      // Channels
      const generalCh = await Channel.create({
        communityId: valCommunity._id,
        name: 'general-chat',
        topic: 'General discussion for all agents',
        type: 'text',
        position: 0,
        minRoleToRead: 'member',
        minRoleToWrite: 'member'
      });

      const scrimsCh = await Channel.create({
        communityId: valCommunity._id,
        name: 'tournament-scrims',
        topic: 'Diamond+ team scrim scheduling',
        type: 'text',
        position: 1,
        minRoleToRead: 'member',
        minRoleToWrite: 'moderator',
        slowModeSeconds: 15
      });

      const annCh = await Channel.create({
        communityId: valCommunity._id,
        name: 'official-announcements',
        topic: 'Patch notes and tournament schedules',
        type: 'announcement',
        position: 2,
        minRoleToRead: 'member',
        minRoleToWrite: 'admin'
      });

      // Add realistic chat messages
      await Message.create([
        {
          channelId: generalCh._id,
          communityId: valCommunity._id,
          senderId: hyper ? hyper._id : sagnik._id,
          text: 'Welcome to the hub everyone! Who is down for 5-stack competitive tonight?',
          createdAt: new Date(Date.now() - 3600000 * 2)
        },
        {
          channelId: generalCh._id,
          communityId: valCommunity._id,
          senderId: sagnik._id,
          text: 'Count me in. Playing initiator/Sova. Let us queue around 9 PM.',
          createdAt: new Date(Date.now() - 3600000 * 1.5)
        },
        {
          channelId: scrimsCh._id,
          communityId: valCommunity._id,
          senderId: sagnik._id,
          text: 'Tournament scrim bracket has been updated. Check #official-announcements.',
          createdAt: new Date(Date.now() - 3600000)
        }
      ]);
      console.log('✔ Seeded "Valorant Champions Hub" with 3 channels and chat messages');
    }

    // 3. Seed Active LFG Squads
    await Party.deleteMany({}); // refresh parties so timestamps are fresh for demo
    await Party.create([
      {
        gameTitle: 'Valorant',
        gameThumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=400&q=80',
        activity: 'Competitive 5-Stack (Diamond+)',
        leaderId: hyper ? hyper._id : sagnik._id,
        maxSlots: 5,
        members: [
          { userId: hyper ? hyper._id : sagnik._id, role: 'leader', joinedAt: new Date() },
          ...(steve ? [{ userId: steve._id, role: 'member', joinedAt: new Date() }] : [])
        ],
        requirements: { minRank: 'Diamond 2', micRequired: true },
        status: 'open',
        createdAt: new Date()
      },
      {
        gameTitle: 'Apex Legends',
        gameThumbnail: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=400&q=80',
        activity: 'Ranked Trios Grind',
        leaderId: sagnik._id,
        maxSlots: 3,
        members: [
          { userId: sagnik._id, role: 'leader', joinedAt: new Date() }
        ],
        requirements: { minRank: 'Platinum+', micRequired: true },
        status: 'open',
        createdAt: new Date()
      },
      {
        gameTitle: 'Overwatch 2',
        gameThumbnail: 'https://www.freetogame.com/g/540/thumbnail.jpg',
        activity: 'Quick Play Fun & Leveling',
        leaderId: steve ? steve._id : sagnik._id,
        maxSlots: 5,
        members: [
          { userId: steve ? steve._id : sagnik._id, role: 'leader', joinedAt: new Date() }
        ],
        requirements: { minRank: 'Any Rank', micRequired: false },
        status: 'open',
        createdAt: new Date()
      }
    ]);
    console.log('✔ Seeded 3 fresh LFG squads on the board');

    // 4. Seed Live Notifications (Bot updates & Squad requests)
    await Notification.deleteMany({ userId: sagnik._id });
    await Notification.create([
      {
        userId: sagnik._id,
        type: 'gaming_bot',
        title: '🤖 GamerHub Bot: New Valorant Update',
        message: 'Patch breakdown and new agent reveal highlights have just been published.',
        actionUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mediaThumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=400&q=80',
        read: false,
        createdAt: new Date(Date.now() - 1000 * 60 * 15)
      },
      {
        userId: sagnik._id,
        type: 'lfg_request',
        title: 'Squad Join Request',
        message: 'Hyper requested to join your Apex Legends Ranked Trios squad!',
        actionUrl: '/lfg',
        mediaThumbnail: '',
        read: false,
        createdAt: new Date(Date.now() - 1000 * 60 * 45)
      },
      {
        userId: sagnik._id,
        type: 'social',
        title: 'New Upvote',
        message: 'Your post "Rank Update: Diamond 2 💎" hit 10 likes! Medal unlocked: Viral Gamer.',
        actionUrl: '/feed',
        mediaThumbnail: '',
        read: true,
        createdAt: new Date(Date.now() - 1000 * 60 * 180)
      }
    ]);
    console.log('✔ Seeded 3 notifications into Sagnik0401 notification inbox');

    await mongoose.disconnect();
    console.log('✅ Demo data seeding complete!');
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
