import mongoose from 'mongoose';
import { wards } from '../../shared/constants.js';

const bedSchema = new mongoose.Schema({
  bedNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
  ward: {
    type: String,
    enum: wards,
    required: true,
  },
  status: {
    type: String,
    enum: ['Available', 'Occupied', 'Maintenance'],
    default: 'Available',
    index: true,
  },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

bedSchema.index(
  { patientId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'Occupied', patientId: { $type: 'objectId' } },
  },
);

export default mongoose.models.Bed || mongoose.model('Bed', bedSchema);
