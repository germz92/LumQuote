/**
 * CRM maintenance script:
 * - Ensures clients exist for quote client names
 * - Unlinks quotes from empty auto-wrapper projects (1 quote, no contracts/invoices)
 *
 * Also runs at server startup. Manual: node scripts/migrate-crm.js
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

  const {
    runCrmMigration,
    unlinkAutoWrappedProjects,
    seedContractTemplates
  } = require('../lib/crm-models');
  await seedContractTemplates();
  console.log('Clients:', await runCrmMigration(SavedQuote));
  console.log('Unlink wrappers:', await unlinkAutoWrappedProjects(SavedQuote));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
