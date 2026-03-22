const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function fixIndex() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    
    console.log('Dropping index: veterinaryId_1');
    try {
      await db.collection('veterinarians').dropIndex('veterinaryId_1');
      console.log('Successfully dropped index');
    } catch (e) {
      console.log('Index did not exist or could not be dropped:', e.message);
    }

    console.log('Creating sparse unique index for veterinaryId');
    await db.collection('veterinarians').createIndex(
      { veterinaryId: 1 }, 
      { unique: true, sparse: true, name: 'veterinaryId_1' }
    );
    console.log('Successfully created index');

    await mongoose.disconnect();
    console.log('Disconnected');
  } catch (err) {
    console.error('Error during index fix:', err);
  }
}

fixIndex();
