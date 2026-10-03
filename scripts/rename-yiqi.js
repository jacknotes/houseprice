'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));
const r = db.prepare("UPDATE communities SET name = '新凯家园一期' WHERE name = '新凯家园(一期)'").run();
console.log('renamed:', r.changes);
