import mongoose from 'mongoose';

const bedSchema = new mongoose.Schema({
  bedNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
  ward: {
    type: String,
    enum: ['ICU', 'Emergency', 'General Ward', 'Pediatrics'],
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

export default mongoose.models.Bed || mongoose.model('Bed', bedSchema);
