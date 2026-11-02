import mongoose from 'mongoose';

const billingSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalPaise: { type: Number, required: true, min: 1, max: 10_000_000_000, validate: Number.isSafeInteger },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  invoiceNumber: { type: String, default: null, trim: true },
  status: { type: String, enum: ['Unpaid', 'Paid', 'Void'], default: 'Unpaid' },
  paidAt: { type: Date, default: null },
}, { timestamps: true });

billingSchema.index(
  { invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } },
);

export default mongoose.models.Billing || mongoose.model('Billing', billingSchema);
