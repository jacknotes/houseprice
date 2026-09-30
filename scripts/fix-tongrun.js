// Fix 同润山河小城 district -> 泗泾 and show current row
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));
const before = db.prepare("SELECT id, name, district FROM communities WHERE name = '同润山河小城'").all();
console.log('before:', JSON.stringify(before));
const r = db.prepare("UPDATE communities SET district = '泗泾' WHERE name = '同润山河小城'").run();
console.log('updated rows:', r.changes);
const after = db.prepare("SELECT id, name, district FROM communities WHERE name = '同润山河小城'").all();
console.log('after:', JSON.stringify(after));
