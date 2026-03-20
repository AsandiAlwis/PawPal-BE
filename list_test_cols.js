const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function listCollections() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('Collections in test DB:', collections.map(c => c.name));
  process.exit(0);
}
listCollections();
