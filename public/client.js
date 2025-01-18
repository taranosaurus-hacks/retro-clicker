// public/client.js

const socket = io();

let userId = localStorage.getItem('retroClickerUserId');

// DOM references
const playerNameInput = document.getElementById('player-name');
const saveNameBtn = document.getElementById('save-name-btn');
const connectedPlayersEl = document.getElementById('connected-players');
const playerPrestigeEl = document.getElementById('player-prestige');
const playerClicksEl = document.getElementById('player-clicks');
const playerCurrencyEl = document.getElementById('player-currency');
const playerMultiplierEl = document.getElementById('player-multiplier');

const bigClickButton = document.getElementById('big-click-button');
const clickSoundEl = document.getElementById('click-sound');
const bgMusicEl = document.getElementById('bg-music');
const musicToggleBtn = document.getElementById('music-toggle-btn');

const prestigeBtn = document.getElementById('prestige-btn');
const leaderboardList = document.getElementById('leaderboard-list');

const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

// Disco ball
const discoBallContainer = document.getElementById('disco-ball-container');
const discoBallGifEl = document.getElementById('disco-ball-gif');

// Container for personal & community upgrades
const personalUpgradesDiv = document.getElementById('personal-upgrades');
const personalUpgradeDisplay = document.getElementById('personal-upgrade-display');
const communityProjectsDiv = document.getElementById('community-projects');

// We'll store the latest gameState data in a global variable so we can reference
// our own currency or upgrade counts easily in the client side.
let latestGameState = null;
let localPlayer = null;

function registerWithServer() {
  const storedName = localStorage.getItem('retroClickerUserName') || '';
  if (storedName) {
    playerNameInput.value = storedName;
  }
  socket.emit('registerUser', {
    userId,
    name: playerNameInput.value || 'Anonymous'
  });
}

socket.on('registered', (data) => {
  const { userId: newUserId, player } = data;
  if (!userId) {
    localStorage.setItem('retroClickerUserId', newUserId);
    userId = newUserId;
  }
  playerNameInput.value = player.name;
  localStorage.setItem('retroClickerUserName', player.name);
});

saveNameBtn.addEventListener('click', () => {
  const newName = playerNameInput.value.trim();
  localStorage.setItem('retroClickerUserName', newName);
  socket.emit('registerUser', { userId, name: newName });
});

bigClickButton.addEventListener('click', () => {
  if (confettiEnabled) {
    confetti({
      particleCount: 30,
      spread: 60
    });
  }
  socket.emit('playerClicked');
  if (clickSoundEl) {
    clickSoundEl.currentTime = 0;
    clickSoundEl.play().catch(() => {});
  }
});

// Toggle music
musicToggleBtn.addEventListener('click', () => {
  if (bgMusicEl.paused) {
    bgMusicEl.play().catch(() => {});
  } else {
    bgMusicEl.pause();
  }
});

// Prestige
prestigeBtn.addEventListener('click', () => {
  socket.emit('prestige');
});

// Chat
chatSendBtn.addEventListener('click', () => {
  const msg = chatInputEl.value.trim();
  if (msg) {
    socket.emit('chatMessage', msg);
    chatInputEl.value = '';
  }
});
chatInputEl.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    chatSendBtn.click();
  }
});

// --- RENDERING FUNCTIONS ---

// Render personal upgrades from the server's data. For each upgrade:
// cost = baseCost * (costGrowth ^ ownedCount)
function renderPersonalUpgrades(personalProjects) {
  personalUpgradesDiv.innerHTML = '';

  if (!localPlayer) return;

  personalProjects.forEach((proj) => {
    const ownedCount = localPlayer.upgrades?.[proj.key] || 0;
    // Recalculate cost
    const cost = Math.floor(proj.baseCost * Math.pow(proj.costGrowth, ownedCount));

    const btn = document.createElement('button');
    btn.className = 'personal-upgrade-btn';
    btn.textContent = `${proj.name} (+${proj.baseRate}/sec) Cost: ${cost}`;

    btn.addEventListener('click', () => {
      // Optional: local check to see if player can afford it
      if (localPlayer.currency < cost) {
        alert("Not enough currency!");
        return;
      }
      // Send buy request to server
      socket.emit('buyUpgrade', { cost, upgradeKey: proj.key });
      // We do NOT locally change the cost. We wait for the server to broadcast the
      // updated state. If the purchase was successful, the server will reflect it.
    });

    personalUpgradesDiv.appendChild(btn);
  });
}

function renderCommunityProjects(communityProjects) {
  communityProjectsDiv.innerHTML = '';
  const maxLevel = 20
  communityProjects.forEach((proj) => {
    const fillPct = Math.min(100, (proj.level / maxLevel) * 100);
    const div = document.createElement('div');
    div.style.margin = '10px';
    div.style.padding = '10px';
    div.style.border = '2px solid #ff0';

    div.innerHTML = `
      <strong>${proj.name}</strong><br>
      Level: ${proj.level || 0} | Cost: ${proj.cost} <br>
      <div class="progress-bar">
        <div class="progress-fill" style="width:0%"></div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'community-upgrade-btn';
    btn.textContent = `Upgrade ${proj.name}`;
    btn.addEventListener('click', () => {
      socket.emit('buyGlobalUpgrade', proj.key);
    });
    div.appendChild(btn);

    communityProjectsDiv.appendChild(div);
  });
}

// public/client.js
let rainbowCursorLevel = 0; // last known level
const cursorPool = [
  'https://cur.cursors-4u.net/cursors/cur-2/cur145.cur', // random
  'https://cur.cursors-4u.net/cursors/cur-10/cur946.cur', 
  'https://cur.cursors-4u.net/cursors/cur-4/cur318.cur'
];

function applyRainbowCursor(level) {
  const bodyEl = document.body;
  if (level <= 0) {
    bodyEl.style.cursor = 'auto';
    return;
  }
  // pick a random from the pool
  const chosen = cursorPool[Math.floor(Math.random() * cursorPool.length)];
  bodyEl.style.cursor = `url('${chosen}'), auto`;
}

// Listen for the main gameState from server
let confettiEnabled = false;

socket.on('gameState', (gameState) => {
  const rainbow = gameState.communityProjects.find(p => p.key === 'rainbowCursor');
  if (rainbow && rainbow.level >= 10) {
    confettiEnabled = true;
  } else {
    confettiEnabled = false;
  }
  latestGameState = gameState;
  const { players, communityProjects, personalProjects, cosmetics } = gameState;
  
  if (!players || !players[userId]) return; // not recognized yet
  localPlayer = players[userId];

  
  const me = gameState.players[userId];
  if (me) {
    playerPrestigeEl.textContent = me.prestigeCount || 0;
  }


  // Update basic stats
  const pIds = Object.keys(players);
  connectedPlayersEl.textContent = pIds.length;
  playerClicksEl.textContent = localPlayer.clicks;
  playerCurrencyEl.textContent = Math.floor(localPlayer.currency);
  playerMultiplierEl.textContent = localPlayer.multiplier;
  if (localPlayer.currency >= 2000) {
    prestigeBtn.style.display = 'inline-block';
  } else {
    prestigeBtn.style.display = 'none';
  }

  // Render personal upgrades (with correct cost formula)
  renderPersonalUpgrades(personalProjects);

  // Show owned personal upgrades as GIFs
  personalUpgradeDisplay.innerHTML = '';
  if (localPlayer.upgrades) {
    for (const [key, count] of Object.entries(localPlayer.upgrades)) {
      const projDef = personalProjects.find((p) => p.key === key);
      if (projDef && count > 0) {
        for (let i = 0; i < count; i++) {
          const img = document.createElement('img');
          img.src = projDef.gif;
          personalUpgradeDisplay.appendChild(img);
        }
      }
    }
  }

  // Render community projects
  renderCommunityProjects(communityProjects);

  // Leaderboard
  const sorted = Object.values(players).sort((a, b) => b.currency - a.currency);
  leaderboardList.innerHTML = '';
  sorted.forEach((pl) => {
    const li = document.createElement('li');
    li.textContent = `${pl.name} - C: ${Math.floor(pl.currency)} - Mx: ${pl.multiplier} - Clicks: ${pl.clicks}`;
    leaderboardList.appendChild(li);
  });

  // Cosmetic flags
  const bodyEl = document.body;
  // Disco Ball
  if (cosmetics.hasDiscoBall) {
    discoBallContainer.style.display = 'block';
    // The discoBall GIF is stored in the server's project definition
    const dbProj = communityProjects.find(p => p.key === 'discoBall');
    discoBallGifEl.src = dbProj?.gif || '';
  } else {
    discoBallContainer.style.display = 'none';
  }
  // Rainbow Cursor
  if (cosmetics.hasRainbowCursor > 0) {
    // if the level changed, pick a new one
    if (rainbowCursorLevel !== cosmetics.hasRainbowCursor) {
      rainbowCursorLevel = cosmetics.hasRainbowCursor;
      applyRainbowCursor(rainbowCursorLevel);
    }
  } else {
    // reset if it was previously set
    if (rainbowCursorLevel > 0) {
      rainbowCursorLevel = 0;
      applyRainbowCursor(0);
    }
  }

  // Neon Sign container
  const neonSignContainer = document.getElementById('neon-sign-container');
  const neonSignImg = document.getElementById('neon-sign-img');
  if (cosmetics.hasNeonSignGif) {
    neonSignContainer.style.display = 'block';
    // We might store the neon sign gif in the server's project def:
    const neonProject = gameState.communityProjects.find(p => p.key === 'neonSign');
    if (neonProject && neonProject.gif) {
      neonSignImg.src = neonProject.gif;
    } else {
      // fallback
      neonSignImg.src = 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExZnR0d3V6c3U4Nzk5dmRtM3NmbTVxZnZmcDY2a2FnMXY3cHpkbDgwdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26BRObY948obnZmz6/giphy.gif';
    }
  } else {
    neonSignContainer.style.display = 'none';
  }
});

// Disco party
socket.on('discoParty', (data) => {
  // maybe have an <audio> element or create one on the fly
  const discoAudio = new Audio(data.trackUrl);
  discoAudio.play().catch(err => console.log(err));
  // Or do something more elaborate: show flashing lights, etc.
});

// Chat
socket.on('chatUpdate', (chatLog) => {
  chatMessagesEl.innerHTML = '';
  chatLog.forEach((msgObj) => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>[${msgObj.timestamp}] ${msgObj.sender}:</strong> ${msgObj.text}`;
    chatMessagesEl.appendChild(p);
  });
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
});

// On load
window.addEventListener('load', () => {
  registerWithServer();
});
