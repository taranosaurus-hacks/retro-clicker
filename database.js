// database.js
const Datastore = require('nedb-promises');

// Players DB
const playerDB = Datastore.create({
  filename: 'players.db',
  autoload: true
});

// Projects DB
const projectsDB = Datastore.create({
  filename: 'projects.db',
  autoload: true
});

// Global settings DB
const settingsDB = Datastore.create({
  filename: 'settings.db',
  autoload: true
});

// Insert default settings if not present
async function initSettings() {
  const existing = await settingsDB.findOne({ key: 'globalSettings' });
  if (!existing) {
    // store defaults
    await settingsDB.insert({
      key: 'globalSettings',
      basePrestigeCost: 2000,
      prestigeIncrement: 500
    });
  }
}

// initProjects function remains same
async function initProjects() {
  // ...
}

module.exports = {
  playerDB,
  projectsDB,
  settingsDB,
  initProjects,
  initSettings
};
