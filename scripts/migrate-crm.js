/**
 * One-off CRM backfill: creates a Client per distinct quote clientName and wraps
 * every quote without a project into its own project.
 *
 * The same migration also runs automatically (idempotently) at server startup,
 * so this script is only needed to run it manually: node scripts/migrate-crm.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LumetryMedia';

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to', mongoose.connection.db.databaseName);

  const savedQuoteSchema = new mongoose.Schema({
    name: String,
    quoteData: Object,
    clientName: String,
    booked: Boolean,
    archived: Boolean,
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmProject', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }, { timestamps: true, strict: false });
  const SavedQuote = mongoose.model('SavedQuote', savedQuoteSchema, 'savedQuotes');

  const { runCrmMigration, seedContractTemplates } = require('../lib/crm-models');
  await seedContractTemplates();
  const result = await runCrmMigration(SavedQuote);
  console.log('Done:', result);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
