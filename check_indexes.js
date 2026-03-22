const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function checkIndexes() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const vetColl = collections.find(c => c.name === 'veterinarians');

    if (vetColl) {
      const indexes = await db.collection('veterinarians').indexes();
      console.log('Indexes on veterinarians collection:');
      console.log(JSON.stringify(indexes, null, 2));

      // Specifically check veterinaryId index
      const vetIdIndex = indexes.find(idx => idx.name === 'veterinaryId_1');
      if (vetIdIndex) {
        console.log('\nveterinaryId_1 index found:');
        console.log('Unique:', vetIdIndex.unique);
        console.log('Sparse:', vetIdIndex.sparse);
      } else {
        console.log('\nveterinaryId_1 index NOT found');
      }
    } else {
      console.log('veterinarians collection not found');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkIndexes();
