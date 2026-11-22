import mongoose from 'mongoose';
import { paymentMethods } from '../../shared/constants.js';

const lineItemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true, maxlength: 250 },
  amountPaise: { type: Number, required: true, min: 1, max: 10_000_000_000, validate: Number.isSafeInteger },
}, { _id: false });

const billingSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalPaise: { type: Number, required: true, min: 1, max: 10_000_000_000, validate: Number.isSafeInteger },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  lineItems: { type: [lineItemSchema], default: [] },
  discountPaise: { type: Number, default: 0, min: 0, max: 10_000_000_000, validate: Number.isSafeInteger },
  notes: { type: String, trim: true, default: '', maxlength: 1000 },
  invoiceNumber: { type: String, default: null, trim: true },
  status: { type: String, enum: ['Unpaid', 'Paid', 'Void'], default: 'Unpaid' },
  paymentMethod: { type: String, enum: ['', ...paymentMethods], default: '' },
  paymentReference: { type: String, trim: true, default: '', maxlength: 200 },
  paidAt: { type: Date, default: null },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

billingSchema.index(
  { invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } },
);

export default mongoose.models.Billing || mongoose.model('Billing', billingSchema);
