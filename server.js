// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const {
  playerDB,
  projectsDB,
  settingsDB,
  initProjects,
  initSettings
} = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize projects & settings
(async function init() {
  await initProjects();
  await initSettings();
})();

// Admin routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Return all projects
app.get('/admin/listPlayers', async (req, res) => {
  try {
    // Assuming playerDB is your NeDB or DB instance
    const players = await playerDB.find({});
    return res.json(players);
  } catch (err) {
    console.error("Error listing players:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.get('/admin/getPlayer', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    const player = await playerDB.findOne({ userId });
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }
    return res.json(player);
  } catch (err) {
    console.error("Error fetching player:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.post('/admin/updatePlayer', async (req, res) => {
  try {
    const { userId, name, currency, clicks, multiplier, prestigeCount } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    // Perform an update in the DB
    const updated = await playerDB.update({ userId }, {
      $set: {
        name, 
        currency, 
        clicks, 
        multiplier, 
        prestigeCount
      }
    }, { returnUpdatedDocs: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error updating player:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.post('/admin/resetPlayer', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    // e.g. reset clicks, currency, multiplier, etc. but keep name
    const player = await playerDB.findOne({ userId });
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }
    await playerDB.update(
      { userId },
      { $set: { clicks: 0, currency: 0, multiplier: 1, prestigeCount: 0 } }
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("Error resetting player:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.post('/admin/banUser', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    // For example, mark them as banned in DB or remove them entirely
    await playerDB.update({ userId }, { $set: { banned: true } });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error banning user:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

// Projects
app.get('/admin/getProjects', async (req, res) => {
  try {
    const projects = await projectsDB.find({});
    return res.json(projects);
  } catch (err) {
    console.error("Error fetching projects:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.get('/admin/getProject', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) {
      return res.status(400).json({ error: "Missing project key" });
    }
    const project = await projectsDB.findOne({ key });
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    return res.json(project);
  } catch (err) {
    console.error("Error fetching project:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.post('/admin/addOrUpdateProject', async (req, res) => {
  try {
    const data = req.body;  // { key, name, type, baseCost, costGrowth, ... }
    if (!data.key) {
      return res.status(400).json({ error: "Project key is required" });
    }
    let existing = await projectsDB.findOne({ key: data.key });
    if (!existing) {
      // Insert new
      await projectsDB.insert(data);
    } else {
      // Merge with existing
      await projectsDB.update({ key: data.key }, { $set: data });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Error add/update project:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

// (Optional) Settings
app.get('/admin/getSettings', async (req, res) => {
  try {
    const settings = await settingsDB.findOne({ key: 'globalSettings' });
    if (!settings) {
      return res.json({ basePrestigeCost: 2000, prestigeIncrement: 500 });
    }
    return res.json(settings);
  } catch (err) {
    console.error("Error fetching settings:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.post('/admin/saveSettings', async (req, res) => {
  try {
    const { basePrestigeCost, prestigeIncrement } = req.body;
    await settingsDB.update(
      { key: 'globalSettings' },
      { $set: { basePrestigeCost, prestigeIncrement } },
      { upsert: true }
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("Error saving settings:", err);
    return res.status(500).json({ error: err.toString() });
  }
});


// In-memory chat
let messages = [];

// socket->user
let socketToUserId = {};

async function getGlobalSettings() {
  let doc = await settingsDB.findOne({ key: 'globalSettings' });
  if (!doc) {
    // fallback defaults if something weird
    doc = { basePrestigeCost: 2000, prestigeIncrement: 500 };
  }
  return doc;
}

// Idle Gains: each second
//  - Personal Upgrades: same as before
//  - Community Projects: each project can have "communityRate"
//    totalRate = sum of (communityRate * level)
setInterval(async () => {
  const players = await playerDB.find({});
  const allProjects = await projectsDB.find({});
  const personalProjects = allProjects.filter((p) => p.type === 'personal');
  const communityProjects = allProjects.filter((p) => p.type === 'community');

  // Calculate total community idle for each project
  // For example, if a project has communityRate=0.5, level=10 => 5 currency/sec to everyone
  let totalCommunityRate = 0;
  communityProjects.forEach((cp) => {
    if (cp.communityRate && cp.level > 0) {
      totalCommunityRate += cp.communityRate * cp.level;
    }
  });

  for (const pl of players) {
    // personal upgrades
    let personalRate = 0;
    if (pl.upgrades) {
      for (const [key, count] of Object.entries(pl.upgrades)) {
        const def = personalProjects.find((p) => p.key === key);
        if (def && count > 0) {
          personalRate += def.baseRate * count;
        }
      }
    }
    personalRate *= (pl.multiplier || 1);

    // add community rate too
    // the entire community rate also gets multiplied by player's multiplier, or not?
    // You can decide. Let's assume we do *not* multiply it by the player's multiplier
    // to keep it truly "community" based:
    const totalRateForPlayer = personalRate + totalCommunityRate;

    if (totalRateForPlayer > 0) {
      pl.currency += totalRateForPlayer;
      await playerDB.update({ userId: pl.userId }, { $set: { currency: pl.currency } });
    }
  }
  
  // Then check disco ball level:
  const discoProj = communityProjects.find(p => p.key === 'discoBall');
  if (discoProj && discoProj.level >= 10) {
    // broadcast an event once every minute
    if (!lastDiscoBroadcast || (Date.now() - lastDiscoBroadcast) > 60000) {
      lastDiscoBroadcast = Date.now();
      io.emit('discoParty', { trackUrl: 'https://example.com/disco.mp3' });
    }
  }

  broadcastGameState();
}, 1000);

// Utility: array -> object keyed by userId
function playersToObject(players) {
  const out = {};
  players.forEach((p) => { out[p.userId] = p; });
  return out;
}
// Build cosmetics: changes for Disco Ball, Rainbow Cursor, Neon Sign
// But now Neon Sign won't recolor everything; we'll do a new flag "hasNeonSignGif"
function buildCosmeticFlags(communityProjects) {
  const flags = {
    hasDiscoBall: false,
    hasRainbowCursor: 0, // store the level for dynamic cursors
    hasNeonSignGif: false
  };
  communityProjects.forEach((cp) => {
    if (cp.key === 'discoBall' && cp.level >= 1) {
      flags.hasDiscoBall = true;
    }
    if (cp.key === 'rainbowCursor' && cp.level > 0) {
      // store the entire level so the client can pick a random cursor
      flags.hasRainbowCursor = cp.level;
    }
    if (cp.key === 'neonSign' && cp.level >= 1) {
      flags.hasNeonSignGif = true;
    }
  });
  return flags;
}

async function broadcastGameState() {
  const allPlayers = await playerDB.find({});
  const allProjects = await projectsDB.find({});

  const communityProjects = allProjects.filter((p) => p.type === 'community');
  const personalProjects = allProjects.filter((p) => p.type === 'personal');

  const cosmetics = buildCosmeticFlags(communityProjects);
  io.emit('gameState', {
    players: arrayToObject(allPlayers),
    communityProjects,
    personalProjects,
    cosmetics
  });
}

function arrayToObject(arr) {
  const obj = {};
  arr.forEach((x) => { obj[x.userId] = x; });
  return obj;
}

// Chat
function broadcastChat() {
  io.emit('chatUpdate', messages);
}


function defaultPlayer(name, userId) {
  return {
    userId,
    name,
    clicks: 0,
    currency: 0,
    multiplier: 1,
    upgrades: {}
  };
}

// Chat Helpers
function embedGifIfNeeded(text) {
  // If message starts with "gif:" + URL
  if (text.startsWith('gif:')) {
    const url = text.slice(4).trim();
    if (url.startsWith('http') &&
       (url.endsWith('.gif') || url.endsWith('.png') || url.endsWith('.jpg'))) {
      return `<img src="${url}" style="max-height:100px;">`;
    }
  }
  return text;
}
function applyEmojiReplacements(text) {
  const replacements = {
    ':hamster:': '<img src="https://media.giphy.com/media/VbnUQpnihPSIgIXuZv/giphy.gif" style="height:20px;">',
    ':banana:': '<img src="https://media.giphy.com/media/yidUzriaAGJbsxt58k/giphy.gif" style="height:20px;">'
  };
  for (const [key, val] of Object.entries(replacements)) {
    text = text.replaceAll(key, val);
  }
  return text;
}

// Register/Click/Buy/Chat logic...
// ... only showing Prestige changes:

io.on('connection', (socket) => {
  socket.on('registerUser', async ({ userId, name }) => {
    if (!userId) {
      userId = uuidv4();
      const p = defaultPlayer(name || 'Anonymous', userId);
      await playerDB.insert(p);
    } else {
      let existing = await playerDB.findOne({ userId });
      if (!existing) {
        existing = defaultPlayer(name || 'Anonymous', userId);
        await playerDB.insert(existing);
      } else {
        // update name
        if (name && name !== existing.name) {
          await playerDB.update({ userId }, { $set: { name } });
        }
      }
    }
    socketToUserId[socket.id] = userId;
    const pDoc = await playerDB.findOne({ userId });
    socket.emit('registered', { userId, player: pDoc });
    broadcastGameState();
    broadcastChat();
  });

  socket.on('playerClicked', async () => {
    const userId = socketToUserId[socket.id];
    if (!userId) return;
    const p = await playerDB.findOne({ userId });
    p.clicks++;
    p.currency += (1 * p.multiplier);
    await playerDB.update({ userId }, { $set: { clicks: p.clicks, currency: p.currency } });
    broadcastGameState();
  });

  socket.on('buyUpgrade', async ({ cost, upgradeKey }) => {
    const userId = socketToUserId[socket.id];
    if (!userId) return;

    // Validate upgrade is personal
    const projDef = await projectsDB.findOne({ key: upgradeKey, type: 'personal' });
    if (!projDef) return;

    const p = await playerDB.findOne({ userId });
    if (p.currency >= cost) {
      // Deduct
      p.currency -= cost;
      p.upgrades[upgradeKey] = (p.upgrades[upgradeKey] || 0) + 1;
      await playerDB.update({ userId }, {
        $set: {
          currency: p.currency,
          upgrades: p.upgrades
        }
      });
      broadcastGameState();
    }
  });

  socket.on('buyGlobalUpgrade', async (projectKey) => {
    const userId = socketToUserId[socket.id];
    if (!userId) return;
    const p = await playerDB.findOne({ userId });

    // Fetch the project from DB
    const proj = await projectsDB.findOne({ key: projectKey, type: 'community' });
    if (!proj) return;

    // Check tier unlocking
    if (proj.requires) {
      // ensure that required project is level >= 1
      const reqProj = await projectsDB.findOne({ key: proj.requires });
      if (!reqProj || reqProj.level < 1) {
        // not unlocked yet
        return; // do nothing
      }
    }

    if (p.currency >= proj.cost) {
      p.currency -= proj.cost;
      // Increase project level
      proj.level = (proj.level || 0) + 1;
      // Increase cost
      proj.cost = Math.floor(proj.cost * proj.costGrowth);

      // Update DB
      await playerDB.update({ userId }, { $set: { currency: p.currency } });
      await projectsDB.update({ _id: proj._id }, { $set: { level: proj.level, cost: proj.cost } });
      broadcastGameState();
    }
  });

  // Chat
  socket.on('chatMessage', async (msg) => {
    const userId = socketToUserId[socket.id];
    if (!userId) return;
    const p = await playerDB.findOne({ userId });
    let text = msg.slice(0, 300);
    text = embedGifIfNeeded(text);
    text = applyEmojiReplacements(text);
    const chatObj = {
      sender: p.name,
      text,
      timestamp: new Date().toLocaleTimeString()
    };
    messages.push(chatObj);
    if (messages.length > 50) {
      messages.shift();
    }
    broadcastChat();
  });

  socket.on('prestige', async () => {
    const userId = socketToUserId[socket.id];
    if (!userId) return;
    const p = await playerDB.findOne({ userId });
    if (!p) return;

    // fetch global settings
    const settings = await getGlobalSettings();
    // requiredCost = base + increment * p.prestigeCount
    const requiredCost = settings.basePrestigeCost + (settings.prestigeIncrement * (p.prestigeCount || 0));
    if (p.currency >= requiredCost) {
      // do the prestige
      p.multiplier++;
      p.clicks = 0;
      p.currency = 0;
      p.upgrades = {};
      p.prestigeCount = (p.prestigeCount || 0) + 1;

      await playerDB.update({ userId }, {
        $set: {
          multiplier: p.multiplier,
          clicks: 0,
          currency: 0,
          upgrades: {},
          prestigeCount: p.prestigeCount
        }
      });
      broadcastGameState();
    }
  });

  socket.on('disconnect', () => {
    delete socketToUserId[socket.id];
    broadcastGameState();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
