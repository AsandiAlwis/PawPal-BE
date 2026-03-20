const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function listCollections() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const admin = mongoose.connection.db.admin();
  const dbs = await admin.listDatabases();
  console.log('Databases:', dbs.databases.map(d => d.name));
  process.exit(0);
}
listCollections();
